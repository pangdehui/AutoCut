import { getDb } from "../db";
import { videos, videoAnalysis } from "../../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import type { ProcessingTask } from "../../drizzle/schema";
import { registerTaskHandler } from "./taskService";
import { openai } from "../_core/openai";
import { ENV } from "../_core/env";
import { trimVideo, sliceAndMerge, changeSpeed, reverseVideo, concatVideos, adjustVolume, resizeVideo, addWatermark, outputPath } from "./editingService";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execAsync = promisify(exec);
const OUTPUT_DIR = path.resolve("uploads/output");

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
    .where(inArray(videoAnalysis.videoId, videoIds));

  const map = new Map<number, Record<string, unknown>>();
  for (const r of results) {
    const existing = map.get(r.videoId);
    // 取最新的分析
    if (!existing) {
      map.set(r.videoId, {
        scenes: r.sceneDescriptions || [],
        keywords: r.keywords || [],
        highlights: r.highlights || [],
        metadata: r.metadata || {},
      });
    }
  }
  return map;
}

function buildMultiVideoPrompt(
  analyses: Map<number, Record<string, unknown>>,
  videoPaths: Map<number, string>,
  userPrompt: string
): string {
  let videoBlocks = "";

  let idx = 1;
  for (const [videoId, analysis] of Array.from(analyses.entries())) {
    const scenes = (analysis.scenes as any[]) || [];
    const highlights = (analysis.highlights as any[]) || [];
    const keywords = (analysis.keywords as string[]) || [];
    const metadata = (analysis.metadata as Record<string, any>) || {};
    const name = path.basename(videoPaths.get(videoId) || `video_${videoId}`);

    const scenesText = scenes.map((s, i) =>
      `    ${i + 1}. [${s.timestamp}] ${s.description}`
    ).join("\n");

    const highlightsText = highlights.map((h, i) =>
      `    ${i + 1}. [${h.timestamp}] 评分${h.score}/10: ${h.description}`
    ).join("\n");

    videoBlocks += `
### 视频${idx}: ${name}
- 分类: ${metadata.category || "未知"}
- 摘要: ${metadata.summary || "无"}
- 关键词: ${keywords.join(", ")}
- 场景:
${scenesText || "    无"}
- 精彩片段:
${highlightsText || "    无"}
`;
    idx++;
  }

  return `你是一个专业的视频剪辑助手。现在有多个视频需要跨视频剪辑。根据每个视频的分析结果和用户的剪辑需求，生成精确的剪辑操作指令。

## 视频分析结果
${videoBlocks}

## 用户剪辑需求
${userPrompt}

## 输出要求
根据各视频的场景和精彩片段的时间信息，把用户需求转化为精确的剪辑指令。
时间格式使用 HH:MM:SS（如 00:01:30 表示1分30秒）。
对于跨视频剪辑，每个片段需要指定来源视频编号（sourceVideo: 1, 2, 3...对应上面的视频1、视频2、视频3）。

只返回 JSON，不要其他文字：

{
  "operation": "trim" | "slice" | "concat" | "speed" | "reverse" | "resize" | "watermark" | "volume",
  "explanation": "向用户解释你将如何剪辑（中文）",
  "params": {
    "mute": false,
    "trim": { "videoIndex": 1, "startTime": "00:00:30", "endTime": "00:02:15" },
    "slices": [
      { "videoIndex": 1, "start": "00:00:10", "end": "00:00:30" },
      { "videoIndex": 2, "start": "00:00:15", "end": "00:00:45" }
    ],
    "concat": { "videoOrder": [1, 2] },
    "speed": 1.5,
    "reverse": { "videoIndex": 1 },
    "resize": { "videoIndex": 1, "resolution": "1280:720" },
    "watermark": { "videoIndex": 1, "text": "文字内容", "position": "bottom-right" },
    "volume": { "videoIndex": 1, "level": 0.5 }
  }
}

操作说明：
- trim: 裁剪指定时间段
- slice: 从视频中提取多个片段并合并（可跨视频）
- concat: 将多个视频完整拼接在一起（按 videoOrder 顺序）
- speed: 加速/减速（0.5=半速, 1.0=原速, 2.0=两倍速）
- reverse: 倒放视频
- resize: 调整分辨率（1920:1080/1280:720/640:360）
- watermark: 添加文字水印（position: top-left/top-right/bottom-left/bottom-right/center）
- volume: 调整音量（0.0=静音, 0.5=一半, 1.0=原音量, 2.0=两倍）

注意：如果用户要求静音/去声音/不要音频，设置 "mute": true。`;
}

interface EditSlice {
  videoIndex: number;
  start: string;
  end: string;
}

interface EditPlan {
  operation: "trim" | "slice" | "concat" | "speed" | "reverse" | "resize" | "watermark" | "volume";
  explanation: string;
  params: Record<string, unknown>;
}

async function runAiEdit(
  task: ProcessingTask,
  updateProgress: (progress: number) => Promise<void>
): Promise<Record<string, unknown>> {
  await updateProgress(5);

  const params = (task.parameters || {}) as { prompt?: string; videoIds?: number[] };
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
  try {
    const promptText = buildMultiVideoPrompt(analysisMap, videoPathMap, params.prompt);

    const result = await openai.chat.completions.create({
      model: ENV.openaiChatModel,
      messages: [{ role: "user", content: promptText }],
      max_tokens: 1500,
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
  } catch (error) {
    throw new Error(`AI 编辑计划生成失败: ${String(error)}`);
  }

  await updateProgress(20);

  const output = outputPath(task.id, editPlan.operation);
  const { operation, params: editParams, explanation } = editPlan;
  const idList = [...validVideoIds]; // 保持索引顺序

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
          // 多源视频切片合并
          await multiSourceSliceAndMerge(videoPathMap, idList, slices, output);
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
        const order = (editParams.concat as { videoOrder: number[] })?.videoOrder || Array.from({ length: idList.length }, (_, i) => i + 1);
        const paths: string[] = [];
        for (const idx of order) {
          const videoId = idList[Math.min(idx - 1, idList.length - 1)];
          const p = videoPathMap.get(videoId);
          if (!p) throw new Error(`视频 ${idx} 不存在`);
          paths.push(p);
        }
        await concatVideos(paths, output);
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

  return {
    outputPath: output,
    fileSize: stats.size,
    operation,
    explanation,
    message: explanation || `${operation} 处理完成`,
  };
}

async function multiSourceSliceAndMerge(
  videoPathMap: Map<number, string>,
  idList: number[],
  slices: EditSlice[],
  outputPath: string
): Promise<void> {
  ensureOutputDir();
  const concatList = path.join(OUTPUT_DIR, `concat_${Date.now()}.txt`);
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
    fs.appendFileSync(concatList, `file '${segPath.replace(/\\/g, "/")}'\n`);
    tempFiles.push(segPath);
  }

  // 多源视频用重新编码确保兼容性
  await execAsync(
    `ffmpeg -f concat -safe 0 -i "${concatList}" -c:v libx264 -preset medium -crf 23 -c:a aac "${outputPath}" -y`
  );

  // 清理临时文件
  for (const f of tempFiles) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  if (fs.existsSync(concatList)) fs.unlinkSync(concatList);
}

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

registerTaskHandler("ai_edit", runAiEdit);

export { runAiEdit };
