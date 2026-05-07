import { getDb } from "../db";
import { videos, videoAnalysis } from "../../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import type { ProcessingTask } from "../../drizzle/schema";
import { registerTaskHandler } from "./taskService";
import { openai } from "../_core/openai";
import { ENV } from "../_core/env";
import { trimVideo, sliceAndMerge, changeSpeed, outputPath } from "./editingService";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execAsync = promisify(exec);
const OUTPUT_DIR = path.resolve("uploads/output");

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
  "operation": "trim" | "slice" | "speed",
  "explanation": "向用户解释你将如何剪辑（中文）",
  "params": {
    "trim": { "videoIndex": 1, "startTime": "00:00:30", "endTime": "00:02:15" },
    "slices": [
      { "videoIndex": 1, "start": "00:00:10", "end": "00:00:30" },
      { "videoIndex": 2, "start": "00:00:15", "end": "00:00:45" }
    ],
    "speed": 1.5
  }
}`;
}

interface EditSlice {
  videoIndex: number;
  start: string;
  end: string;
}

interface EditPlan {
  operation: "trim" | "slice" | "speed";
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
      default:
        throw new Error(`不支持的编辑操作: ${operation}`);
    }
  } catch (error) {
    throw new Error(`剪辑执行失败: ${String(error)}`);
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
    await execAsync(
      `ffmpeg -i "${srcPath}" -ss ${s.start} -to ${s.end} -c copy "${segPath}" -y`
    );
    fs.appendFileSync(concatList, `file '${segPath.replace(/\\/g, "/")}'\n`);
    tempFiles.push(segPath);
  }

  await execAsync(
    `ffmpeg -f concat -safe 0 -i "${concatList}" -c copy "${outputPath}" -y`
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
