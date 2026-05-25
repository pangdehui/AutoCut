import { getDb } from "../db";
import { videos, videoAnalysis } from "../../drizzle/schema";
import { desc, eq, inArray } from "drizzle-orm";
import type { ProcessingTask } from "../../drizzle/schema";
import { registerTaskHandler } from "./taskService";
import { openai } from "../_core/openai";
import { ENV } from "../_core/env";
import { trimVideo, sliceAndMerge, changeSpeed, reverseVideo, concatVideos, concatVideosWithTransitions, adjustVolume, resizeVideo, addWatermark, outputPath, getVideoDurationSec, type TransitionType, type SegmentTransition } from "./editingService";
import { injectStyleRules, applyHardConstraints, getEditStyleLabel } from "./editStyle";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execAsync = promisify(exec);
const OUTPUT_DIR = path.resolve("uploads/output");

interface PreviousEditResult {
  operation: string;
  explanation: string;
  slices?: Array<{ videoIndex: number; start: string; end: string }>;
  totalDuration?: number;
  segmentCount?: number;
}

function timeToSeconds(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function secondsToTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function durationBetween(start: string, end: string): string {
  return secondsToTime(timeToSeconds(end) - timeToSeconds(start));
}

async function getVideoPaths(ids: number[]): Promise<Map<number, string>> {
  const db = await getDb();
  if (!db) return new Map();

  const result = await db
    .select({ id: videos.id, filePath: videos.filePath })
    .from(videos)
    .where(inArray(videos.id, ids));

  return new Map(result.map((r) => [r.id, r.filePath]));
}

async function getAnalysisForVideos(videoIds: number[]): Promise<Map<number, Record<string, unknown>>> {
  const db = await getDb();
  if (!db) return new Map();

  const results = await db
    .select()
    .from(videoAnalysis)
    .where(inArray(videoAnalysis.videoId, videoIds))
    .orderBy(desc(videoAnalysis.createdAt));

  const map = new Map<number, Record<string, unknown>>();
  for (const r of results) {
    const existing = map.get(r.videoId);
    // 取最新的分析
    if (!existing) {
      const meta = (r.metadata as Record<string, unknown>) || {};
      map.set(r.videoId, {
        scenes: r.sceneDescriptions || [],
        keywords: r.keywords || [],
        highlights: r.highlights || [],
        wasteSegments: (meta.wasteSegments as unknown[]) || [],
        metadata: meta,
      });
    }
  }
  return map;
}

const TRANSITION_TYPES: TransitionType[] = [
  "cut", "fade", "fadeblack", "fadewhite", "dissolve",
  "slideleft", "slideright", "slideup", "slidedown",
  "wipeleft", "wiperight", "circleopen", "circleclose", "zoomin",
];

function buildMultiVideoPrompt(
  analyses: Map<number, Record<string, unknown>>,
  videoPaths: Map<number, string>,
  userPrompt: string,
  previousResult?: PreviousEditResult
): string {
  let videoBlocks = "";

  let idx = 1;
  for (const [videoId, analysis] of Array.from(analyses.entries())) {
    const scenes = (analysis.scenes as any[]) || [];
    const highlights = (analysis.highlights as any[]) || [];
    const wasteSegments = (analysis.wasteSegments as any[]) || [];
    const keywords = (analysis.keywords as string[]) || [];
    const metadata = (analysis.metadata as Record<string, any>) || {};
    const name = path.basename(videoPaths.get(videoId) || `video_${videoId}`);

    const scenesText = scenes.map((s, i) => {
      const start = secondsToTime(typeof s.startTime === "number" ? s.startTime : timeToSeconds(s.timestamp || "00:00:00"));
      const end = secondsToTime(typeof s.endTime === "number" ? s.endTime : timeToSeconds(s.timestamp || "00:00:00") + 3);
      return `    ${i + 1}. [${start}-${end}] [${s.quality || "可用"}] ${s.description}`;
    }).join("\n");

    const highlightsText = highlights.map((h, i) => {
      const start = secondsToTime(typeof h.startTime === "number" ? h.startTime : timeToSeconds(h.timestamp || "00:00:00"));
      const end = secondsToTime(typeof h.endTime === "number" ? h.endTime : timeToSeconds(h.timestamp || "00:00:00") + 2);
      return `    ${i + 1}. [${start}-${end}] 评分${h.score}/10: ${h.description}`;
    }).join("\n");

    const wasteText = wasteSegments.map((w, i) => {
      const start = secondsToTime(typeof w.startTime === "number" ? w.startTime : 0);
      const end = secondsToTime(typeof w.endTime === "number" ? w.endTime : 0);
      return `    ${i + 1}. [${start}-${end}] ${w.description} (${w.type})`;
    }).join("\n");

    videoBlocks += `
### 视频${idx}: ${name}
- 分类: ${metadata.category || "未知"}
- 摘要: ${metadata.summary || "无"}
- 关键词: ${keywords.join(", ")}
- 场景:
${scenesText || "    无"}
- 精彩片段:
${highlightsText || "    无"}
- 废片（必须跳过，不得出现在输出中，含重复帧）:
${wasteText || "    无废片"}
`;
    idx++;
  }

  const prevCtx = previousResult
    ? `
## Previous Edit Result (for iterative refinement)
- Operation: ${previousResult.operation}
- Previous explanation: ${previousResult.explanation}
${previousResult.segmentCount != null ? `- Segment count: ${previousResult.segmentCount}` : ""}
${previousResult.totalDuration != null ? `- Total duration: ${previousResult.totalDuration.toFixed(1)}s` : ""}
${
  previousResult.slices && previousResult.slices.length > 0
    ? `- Previous segments:\n${previousResult.slices.map((s, i) => `    ${i + 1}. Video${s.videoIndex} [${s.start}-${s.end}]`).join("\n")}`
    : ""
}
The user's current instruction is a refinement of the previous result. Modify based on the previous output (e.g. "too long" → fewer/shorter segments, "change the opening" → replace first segment with a different hook, "faster pace" → more cut transitions + shorter segment durations).
`
    : "";

  return `You are a professional short-video editor skilled in TikTok/Douyin/Reels viral editing. Based on video analysis results and the user's request, generate precise editing instructions.

## Core Editing Principles

### 1. Clip Selection Scoring
For each candidate clip, mentally score it across 3 dimensions (each 1–5):
- **Information value**: Does this shot communicate something essential? (5 = key message, 1 = filler)
- **Visual impact**: Is it visually arresting? (5 = stunning, 1 = flat/unremarkable)
- **Emotional pull**: Does it make the viewer feel something? (5 = strong emotion, 1 = neutral)

Select clips that score ≥10 combined. Reject anything below 7.

Quality tier selection:
- "优质"(premium): Prioritize for hooks, climaxes, money shots — crisp, stable, well-composed
- "可用"(usable): Use for context, transitions, B-roll support — acceptable but not show-stopping
- "一般"(average): Only use if absolutely necessary, max 2 clips, keep under 2s each
- wasteSegments: ZERO tolerance — skip entirely, not a single frame

Highlights vs scenes: prefer highlights (AI has already identified these as standout moments). Use regular scenes to fill gaps between highlights.

### 2. Segment Architecture
**Hook (first 1–3 segments)**: The most visually arresting or emotionally magnetic clips. First segment must grab attention within 0.5s — no slow build-ups. Duration: 1.0–2.5s each.

**Body (middle 60–70% of segments)**:
- Mix clip durations to create rhythm: short-short-LONG-short-short-LONG
- Alternate between information-heavy clips and visual palate-cleansers
- Include at least one detail/close-up shot for every 4 clips
- Vary source videos — never 3 clips from the same source in a row

**Climax (peak moment, ~70–85% position)**: The single best clip — highest highlight score, longest allowed duration (3–6s), the emotional or informational peak.

**Resolution (final 1–2 segments)**: Clean landing — CTA, emotional closure, or summary. 2–3s. Don't end abruptly mid-thought.

### 3. Duration Calculator
- Target not specified → default 30–60s total
- User specifies "X seconds" → total must be X ±5% (e.g. "60s" → 57–63s)
- Per-segment guardrails:
  · Hook: 1.0–2.5s | Fast info: 1.5–3.0s | Standard: 2.5–4.0s | Slow/emotional: 3.5–6.0s
  · Never exceed 8s for any single segment
- Segment count formula: targetDuration / 3.5 → aim for this many clips (±20%)

### 4. Visual Continuity Rules
- Never place two extreme close-ups back-to-back
- Never place two wide shots back-to-back without a detail shot between
- When switching source videos, the first clip from the new source should establish context
- Alternate motion intensity: static → moving → static → moving
- Consecutive clips from the same source video MUST use "cut" transition (not a fancy transition)

### 5. Transition Selection Guide
Default: "cut" (>60% of transitions). Only use others when justified:
- **cut**: Same-topic flow, fast-paced sequences, consecutive same-source clips. (no duration needed)
- **dissolve** (0.2–0.3s): Smooth topic shift within same section, visual mood continuity
- **fade** (0.3–0.5s): Gentle section transition, time passing
- **fadeblack** (0.4–0.6s): Major section break, emotional reset, before/after contrast (max 2 per video)
- **slideleft/slideright** (0.25–0.4s): Energetic montage, youthful/trendy content
- **zoomin** (0.2–0.3s): Product reveal, emphasis moment, "wow" beat
- Never use the same non-cut transition twice consecutively

### 6. Emotional Arc Ordering
Do NOT arrange clips in raw chronological order. Arrange them by emotional/intensity curve:
Hook (peak intensity) → Brief drop → Build → Build → CLIMAX → Cool-down → Resolution

Within the body section, group clips by theme or visual mood rather than by source video.

## Video Analysis Results
${videoBlocks}
${prevCtx}
## User Editing Request
${userPrompt}

## Output
Time format: HH:MM:SS. Cross-video clips must specify videoIndex (1-based: 1=Video 1, 2=Video 2...).
When generating slices, verify NO overlap with wasteSegments above.
If user request implies mute/remove audio, set "mute": true.

Return ONLY valid JSON:

{
  "operation": "trim" | "slice" | "concat" | "speed" | "reverse" | "resize" | "watermark" | "volume" | "clean",
  "explanation": "Chinese explanation of your editing decisions — clip selection strategy, arc design, transition choices",
  "params": {
    "mute": false,
    "videoIndex": 1,
    "trim": { "videoIndex": 1, "startTime": "00:00:30", "endTime": "00:02:15" },
    "slices": [
      { "videoIndex": 1, "start": "00:00:10", "end": "00:00:30" },
      { "videoIndex": 2, "start": "00:00:15", "end": "00:00:45", "transition": "fadeblack", "transitionDuration": 0.5 }
    ],
    "concat": { "videoOrder": [1, 2], "transitions": [{ "type": "fade", "duration": 0.4 }] },
    "speed": 1.5,
    "reverse": { "videoIndex": 1 },
    "resize": { "videoIndex": 1, "resolution": "1280:720" },
    "watermark": { "videoIndex": 1, "text": "text", "position": "bottom-right" },
    "volume": { "videoIndex": 1, "level": 0.5 }
  }
}

Operations:
- slice: Extract segments from one or more videos and merge with transitions. This is the DEFAULT for any multi-clip request.
- clean: Auto-remove all waste segments and merge remaining usable clips. Use when user asks to remove waste/trash segments.
- trim: Cut a single time range from one video.
- concat: Merge full videos end-to-end (with optional transitions).
- speed/volume/reverse/resize/watermark: Single-video adjustments.`;
}

interface EditSlice {
  videoIndex: number;
  start: string;
  end: string;
  /** 进入此切片时的转场（首切片忽略） */
  transition?: TransitionType;
  /** 转场时长（秒），默认 0.4 */
  transitionDuration?: number;
}

interface EditPlan {
  operation: "trim" | "slice" | "concat" | "speed" | "reverse" | "resize" | "watermark" | "volume" | "clean";
  explanation: string;
  params: Record<string, unknown>;
}

function buildCleanSlices(
  wasteSegs: Array<{ startTime: number; endTime: number }>,
  totalDuration: number
): Array<{ start: string; end: string }> {
  const MIN_SLICE = 0.5;
  const sorted = [...wasteSegs].sort((a, b) => a.startTime - b.startTime);
  const slices: Array<{ start: string; end: string }> = [];
  let cursor = 0;

  for (const w of sorted) {
    const wasteStart = Math.max(0, w.startTime);
    const wasteEnd = Math.min(totalDuration, w.endTime);
    if (wasteStart > cursor + MIN_SLICE) {
      slices.push({ start: secondsToTime(cursor), end: secondsToTime(wasteStart) });
    }
    cursor = Math.max(cursor, wasteEnd);
  }

  if (totalDuration - cursor > MIN_SLICE) {
    slices.push({ start: secondsToTime(cursor), end: secondsToTime(totalDuration) });
  }

  return slices;
}

async function runAiEdit(
  task: ProcessingTask,
  updateProgress: (progress: number) => Promise<void>
): Promise<Record<string, unknown>> {
  await updateProgress(5);

  const params = (task.parameters || {}) as {
    prompt?: string;
    videoIds?: number[];
    previousResult?: PreviousEditResult;
    style?: string;
  };
  const editStyle = params.style;
  if (!params.prompt) {
    throw new Error("请提供剪辑指令");
  }

  // 确定要剪辑的视频列表
  const videoIds = params.videoIds && params.videoIds.length > 0
    ? params.videoIds
    : [task.videoId];

  await updateProgress(8);

  // 获取所有视频路径
  const videoPathMap = await getVideoPaths(videoIds);
  const validVideoIds = videoIds.filter((id) => {
    const p = videoPathMap.get(id);
    return p && fs.existsSync(p);
  });

  if (validVideoIds.length === 0) {
    throw new Error("没有可用的视频文件");
  }

  await updateProgress(10);

  // 获取所有视频的分析结果
  const analysisMap = await getAnalysisForVideos(validVideoIds);
  const analyzedIds = validVideoIds.filter((id) => {
    const a = analysisMap.get(id);
    return a && ((a.scenes as any[])?.length > 0);
  });

  if (analyzedIds.length === 0) {
    throw new Error("所选视频均未完成内容分析，请先分析视频");
  }

  await updateProgress(15);

  // 发送给 AI 生成编辑计划
  let editPlan: EditPlan;
  let styleModified = false;
  let styleConstraints: string[] = [];
  try {
    let promptText = buildMultiVideoPrompt(analysisMap, videoPathMap, params.prompt, params.previousResult);
    promptText = injectStyleRules(promptText, editStyle);

    const result = await openai.chat.completions.create({
      model: ENV.openaiChatModel,
      messages: [{ role: "user", content: promptText }],
      max_tokens: 2500,
    });

    const content = result.choices[0]?.message?.content;
    if (!content) throw new Error("AI 未返回结果");

    const text = typeof content === "string" ? content : JSON.stringify(content);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("无法解析 AI 返回的编辑计划");

    editPlan = JSON.parse(jsonMatch[0]);
    if (!editPlan.operation || !editPlan.params) {
      throw new Error("AI 返回的编辑计划格式不完整");
    }
    console.log(`[aiEdit] 操作=${editPlan.operation} 说明=${editPlan.explanation}`);
    if (editPlan.operation === "slice") {
      const slices = (editPlan.params.slices as any[]) || [];
      console.log(`[aiEdit] 切片数=${slices.length} 总时长≈${slices.reduce((acc: number, s: any) => {
        const dur = timeToSeconds(s.end || "00:00:00") - timeToSeconds(s.start || "00:00:00");
        return acc + (dur > 0 ? dur : 0);
      }, 0).toFixed(1)}s`);
      for (const s of slices) {
        console.log(`  -> 视频${s.videoIndex||1} [${s.start}-${s.end}] 转场=${s.transition||"cut"}`);
      }
    }

    // 风格模板后处理：执行硬约束
    const hc = applyHardConstraints(editPlan, editStyle);
    styleModified = hc.modified;
    styleConstraints = hc.constraints;
    if (styleModified) {
      console.log(`[aiEdit] 风格约束已应用 (${styleConstraints.length} 条):`);
      for (const c of styleConstraints) {
        console.log(`  - ${c}`);
      }
    }
  } catch (error) {
    throw new Error(`AI 编辑计划生成失败: ${String(error)}`);
  }

  await updateProgress(20);

  const output = outputPath(task.id, editPlan.operation);
  const { operation, params: editParams, explanation } = editPlan;
  const idList = [...validVideoIds];

  try {
    switch (operation) {
      case "trim": {
        const t = editParams.trim as { videoIndex?: number; startTime: string; endTime: string };
        if (!t?.startTime || !t?.endTime) throw new Error("缺少裁剪时间参数");
        const srcIdx = (t.videoIndex || 1) - 1;
        const srcPath = videoPathMap.get(idList[Math.min(srcIdx, idList.length - 1)]);
        if (!srcPath) throw new Error("源视频不存在");
        await trimVideo(srcPath, output, t.startTime, t.endTime);
        break;
      }
      case "slice": {
        const slices = editParams.slices as EditSlice[];
        if (!slices || slices.length === 0) throw new Error("缺少切片参数");

        if (slices.length === 1 && (!slices[0].videoIndex || slices[0].videoIndex === 1)) {
          // 单视频切片，用原有函数
          const singleSlices = slices.map((s) => ({ start: s.start, end: s.end }));
          const srcPath = videoPathMap.get(validVideoIds[0]);
          if (!srcPath) throw new Error("源视频不存在");
          await sliceAndMerge(srcPath, output, singleSlices);
        } else {
          // 多源视频切片合并（支持转场）
          const transitions: SegmentTransition[] = [];
          for (let i = 1; i < slices.length; i++) {
            transitions.push({
              type: (slices[i].transition || "fade") as TransitionType,
              duration: slices[i].transitionDuration,
            });
          }
          await multiSourceSliceAndMerge(videoPathMap, idList, slices, transitions, output);
        }
        break;
      }
      case "speed": {
        const sp = editParams.speed as number;
        const videoIdx = (editParams.videoIndex as number) || 1;
        const srcPath = videoPathMap.get(idList[Math.min(videoIdx - 1, idList.length - 1)]);
        if (!sp || sp <= 0) throw new Error("缺少有效速度参数");
        if (!srcPath) throw new Error("源视频不存在");
        await changeSpeed(srcPath, output, sp);
        break;
      }
      case "concat": {
        const concatCfg = editParams.concat as {
          videoOrder?: number[];
          transitions?: { type: TransitionType; duration?: number }[];
        } | undefined;
        const order = concatCfg?.videoOrder || Array.from({ length: idList.length }, (_, i) => i + 1);
        const paths: string[] = [];
        for (const idx of order) {
          const videoId = idList[Math.min(idx - 1, idList.length - 1)];
          const p = videoPathMap.get(videoId);
          if (!p) throw new Error(`视频 ${idx} 不存在`);
          paths.push(p);
        }
        const transitions: SegmentTransition[] = (concatCfg?.transitions || []).slice(0, paths.length - 1)
          .map((t) => ({ type: t?.type || "fade", duration: t?.duration }));
        // 不足时补 fade 默认
        while (transitions.length < paths.length - 1) {
          transitions.push({ type: "fade", duration: 0.4 });
        }
        const hasReal = transitions.some((t) => t.type !== "cut");
        if (hasReal) {
          await concatVideosWithTransitions(paths, output, transitions);
        } else {
          await concatVideos(paths, output);
        }
        break;
      }
      case "reverse": {
        const revIdx = (editParams.reverse as { videoIndex?: number })?.videoIndex || 1;
        const srcPath = videoPathMap.get(idList[Math.min(revIdx - 1, idList.length - 1)]);
        if (!srcPath) throw new Error("源视频不存在");
        await reverseVideo(srcPath, output);
        break;
      }
      case "resize": {
        const rz = editParams.resize as { videoIndex?: number; resolution: string };
        if (!rz?.resolution) throw new Error("缺少分辨率参数");
        const rzIdx = rz.videoIndex || 1;
        const srcPath = videoPathMap.get(idList[Math.min(rzIdx - 1, idList.length - 1)]);
        if (!srcPath) throw new Error("源视频不存在");
        await resizeVideo(srcPath, output, rz.resolution);
        break;
      }
      case "watermark": {
        const wm = editParams.watermark as { videoIndex?: number; text: string; position: string };
        if (!wm?.text) throw new Error("缺少水印文字");
        const wmIdx = wm.videoIndex || 1;
        const srcPath = videoPathMap.get(idList[Math.min(wmIdx - 1, idList.length - 1)]);
        if (!srcPath) throw new Error("源视频不存在");
        await addWatermark(srcPath, output, wm.text, wm.position || "bottom-right");
        break;
      }
      case "volume": {
        const vol = editParams.volume as { videoIndex?: number; level: number };
        if (vol?.level === undefined || vol.level < 0) throw new Error("缺少有效音量参数");
        const volIdx = vol.videoIndex || 1;
        const srcPath = videoPathMap.get(idList[Math.min(volIdx - 1, idList.length - 1)]);
        if (!srcPath) throw new Error("源视频不存在");
        await adjustVolume(srcPath, output, vol.level);
        break;
      }
      case "clean": {
        const cleanIdx = ((editParams.videoIndex as number) || 1) - 1;
        const srcVideoId = idList[Math.min(cleanIdx, idList.length - 1)];
        const srcPath = videoPathMap.get(srcVideoId);
        if (!srcPath) throw new Error("源视频不存在");
        const wasteSegs = ((analysisMap.get(srcVideoId) as any)?.wasteSegments || []) as Array<{ startTime: number; endTime: number }>;
        const duration = await getVideoDurationSec(srcPath);
        const cleanSlices = buildCleanSlices(wasteSegs, duration);
        if (cleanSlices.length === 0) {
          throw new Error("清理后没有可用片段");
        }
        if (cleanSlices.length === 1 && timeToSeconds(cleanSlices[0].start) < 0.5 && Math.abs(timeToSeconds(cleanSlices[0].end) - duration) < 1) {
          fs.copyFileSync(srcPath, output);
        } else {
          await sliceAndMerge(srcPath, output, cleanSlices);
        }
        editPlan.explanation = editPlan.explanation || `已识别 ${wasteSegs.length} 处废片，清理后保留 ${cleanSlices.length} 个可用片段`;
        break;
      }
      default:
        throw new Error(`不支持的编辑操作: ${operation}`);
    }
  } catch (error) {
    throw new Error(`剪辑执行失败: ${String(error)}`);
  }

  // 处理静音：移除音频轨道
  if (editParams.mute) {
    await updateProgress(85);
    const mutedOutput = outputPath(task.id, `${editPlan.operation}_muted`);
    await execAsync(
      `ffmpeg -i "${output}" -c:v copy -an "${mutedOutput}" -y`
    );
    fs.unlinkSync(output);
    fs.renameSync(mutedOutput, output);
  }

  await updateProgress(90);

  const stats = fs.statSync(output);

  await updateProgress(100);

  // 收集转场用于回显
  const usedTransitions: { type: string; duration: number }[] = [];
  if (operation === "slice") {
    const slices = (editParams.slices as EditSlice[]) || [];
    for (let i = 1; i < slices.length; i++) {
      usedTransitions.push({
        type: slices[i].transition || "fade",
        duration: slices[i].transitionDuration ?? 0.4,
      });
    }
  } else if (operation === "concat") {
    const concatCfg = editParams.concat as { transitions?: { type: string; duration?: number }[] } | undefined;
    for (const t of concatCfg?.transitions || []) {
      usedTransitions.push({ type: t.type, duration: t.duration ?? 0.4 });
    }
  }

  return {
    outputPath: output,
    fileSize: stats.size,
    operation,
    explanation,
    message: explanation || `${operation} 处理完成`,
    editStyle: editStyle || "auto",
    editStyleLabel: getEditStyleLabel(editStyle),
    styleConstraints: styleModified ? styleConstraints : undefined,
    transitions: usedTransitions.length > 0 ? usedTransitions : undefined,
    previousResult: {
      operation,
      explanation: explanation || `${operation} 处理完成`,
      slices: operation === "slice"
        ? (editParams.slices as EditSlice[] || []).map((s) => ({
            videoIndex: s.videoIndex || 1,
            start: s.start,
            end: s.end,
          }))
        : undefined,
      segmentCount: operation === "slice"
        ? (editParams.slices as EditSlice[] || []).length
        : undefined,
      totalDuration: operation === "slice"
        ? (editParams.slices as EditSlice[] || []).reduce((acc, s) => {
            return acc + timeToSeconds(s.end) - timeToSeconds(s.start);
          }, 0)
        : undefined,
    } satisfies PreviousEditResult,
  };
}

async function multiSourceSliceAndMerge(
  videoPathMap: Map<number, string>,
  idList: number[],
  slices: EditSlice[],
  transitions: SegmentTransition[],
  outputPath: string
): Promise<void> {
  ensureOutputDir();
  const tempFiles: string[] = [];

  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const srcIdx = Math.min((s.videoIndex || 1) - 1, idList.length - 1);
    const srcVideoId = idList[srcIdx];
    const srcPath = videoPathMap.get(srcVideoId);
    if (!srcPath) throw new Error(`切片 ${i + 1} 的源视频不存在`);

    const segPath = path.join(OUTPUT_DIR, `seg_${Date.now()}_${i}.mp4`);
    const dur = durationBetween(s.start, s.end);
    await execAsync(
      `ffmpeg -ss ${s.start} -i "${srcPath}" -to ${dur} -c copy -avoid_negative_ts make_zero "${segPath}" -y`
    );
    tempFiles.push(segPath);
  }

  const hasReal = transitions.some((t) => t.type !== "cut");
  if (hasReal) {
    await concatVideosWithTransitions(tempFiles, outputPath, transitions);
  } else {
    await concatVideos(tempFiles, outputPath);
  }

  // 清理临时文件
  for (const f of tempFiles) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

registerTaskHandler("ai_edit", runAiEdit);

export { runAiEdit };
