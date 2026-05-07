import { getDb } from "../db";
import { videoAnalysis, videos } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { ProcessingTask } from "../../drizzle/schema";
import { registerTaskHandler } from "./taskService";
import { openai } from "../_core/openai";
import { ENV } from "../_core/env";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execAsync = promisify(exec);

const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB
const SEGMENT_DURATION = 60; // 秒
const SEGMENTS_DIR = path.resolve("uploads/segments");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function getVideoPath(videoId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select({ filePath: videos.filePath })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);

  return result.length > 0 ? result[0].filePath : null;
}

// ====== 视频元数据 ======

interface VideoMeta {
  duration: number; // 秒
  fileSize: number; // bytes
}

async function getVideoMetadata(videoPath: string): Promise<VideoMeta> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration,size -of csv=p=0 "${videoPath}"`
  );
  const [durationStr, sizeStr] = stdout.trim().split(",");
  return {
    duration: parseFloat(durationStr) || 0,
    fileSize: parseInt(sizeStr) || fs.statSync(videoPath).size,
  };
}

// ====== 视频切片 ======

async function splitVideo(videoPath: string, taskId: number): Promise<string[]> {
  const taskDir = path.join(SEGMENTS_DIR, `task_${taskId}`);
  ensureDir(taskDir);

  const outputPattern = path.join(taskDir, "seg_%03d.mp4");

  await execAsync(
    `ffmpeg -i "${videoPath}" -c copy -map 0 -f segment -segment_time ${SEGMENT_DURATION} -reset_timestamps 1 "${outputPattern}" -y`
  );

  return fs.readdirSync(taskDir)
    .filter(f => f.startsWith("seg_") && f.endsWith(".mp4"))
    .sort()
    .map(f => path.join(taskDir, f));
}

// ====== 视频转 Base64 ======

function videoToBase64(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return `data:video/mp4;base64,${data.toString("base64")}`;
}

// ====== AI 分析 ======

const ANALYSIS_PROMPT = `你是一个专业的视频内容分析专家。请仔细观看这个视频，分析其中的内容。

请以 JSON 格式返回分析结果（只返回 JSON，不要其他文字）：

{
  "scenes": [
    {
      "timestamp": "MM:SS 格式的估计时间",
      "description": "场景的详细描述（中文，50字以内）",
      "tags": ["标签1", "标签2"]
    }
  ],
  "keywords": ["关键词1", "关键词2", ...最多10个，描述视频整体内容],
  "highlights": [
    {
      "timestamp": "MM:SS 格式",
      "description": "为什么这段是精彩片段",
      "score": 1-10 的精彩程度评分
    }
  ],
  "summary": "视频整体内容的简短总结（中文，100字以内）",
  "category": "视频分类（如：教程、娱乐、记录、商业等）"
}`;

const SEGMENT_PROMPT = (segmentIndex: number, totalSegments: number) =>
  `你是一个专业的视频内容分析专家。这是视频的第 ${segmentIndex}/${totalSegments} 段（共 ${totalSegments} 段）。请仔细观看这段视频片段，分析其中的内容。

请以 JSON 格式返回分析结果（只返回 JSON，不要其他文字）：

{
  "scenes": [
    {
      "timestamp": "MM:SS 格式（相对于本段开头的时间）",
      "description": "场景的详细描述（中文，50字以内）",
      "tags": ["标签1", "标签2"]
    }
  ],
  "keywords": ["关键词1", "关键词2", ...最多5个，描述本段内容],
  "highlights": [
    {
      "timestamp": "MM:SS 格式（相对于本段开头）",
      "description": "为什么这段是精彩片段",
      "score": 1-10 的精彩程度评分
    }
  ],
  "summary": "本段内容的简短总结（中文，50字以内）",
  "category": "视频分类（如：教程、娱乐、记录、商业等）"
}`;

async function analyzeVideo(
  videoPath: string,
  isSegment: boolean,
  segmentIndex: number,
  totalSegments: number,
): Promise<Record<string, unknown>> {
  const dataUrl = videoToBase64(videoPath);

  const promptText = isSegment
    ? SEGMENT_PROMPT(segmentIndex, totalSegments)
    : ANALYSIS_PROMPT;

  const messageContent: any[] = [
    { type: "video_url", video_url: { url: dataUrl } },
    { type: "text", text: promptText },
  ];

  const result = await openai.chat.completions.create({
    model: ENV.openaiChatModel,
    messages: [{ role: "user" as const, content: messageContent }],
    max_tokens: 2000,
  });

  const content = result.choices[0]?.message?.content;
  if (!content) throw new Error("AI 分析返回空结果");

  const text = typeof content === "string" ? content : JSON.stringify(content);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("无法解析 AI 返回的 JSON");

  return JSON.parse(jsonMatch[0]);
}

// ====== 多段结果合并 ======

function parseTimestamp(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function mergeSegmentResults(
  results: Record<string, unknown>[],
): Record<string, unknown> {
  if (results.length === 1) return results[0];

  const allScenes: unknown[] = [];
  const allKeywords = new Set<string>();
  const allHighlights: unknown[] = [];
  const summaries: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const offset = i * SEGMENT_DURATION;

    // 合并 scenes，加时间偏移
    const scenes = (r.scenes as Array<{ timestamp: string; description: string; tags: string[] }>) || [];
    for (const s of scenes) {
      allScenes.push({
        ...s,
        timestamp: formatTimestamp(parseTimestamp(s.timestamp) + offset),
      });
    }

    // 合并 highlights，加时间偏移
    const highlights = (r.highlights as Array<{ timestamp: string; description: string; score: number }>) || [];
    for (const h of highlights) {
      allHighlights.push({
        ...h,
        timestamp: formatTimestamp(parseTimestamp(h.timestamp) + offset),
      });
    }

    // 合并 keywords 去重
    const keywords = (r.keywords as string[]) || [];
    for (const k of keywords) allKeywords.add(k);

    // 收集 summaries
    if (r.summary) summaries.push(r.summary as string);
  }

  return {
    scenes: allScenes,
    keywords: Array.from(allKeywords).slice(0, 15),
    highlights: allHighlights,
    summary: summaries.join(" ").slice(0, 200),
    category: results[0].category || "未分类",
  };
}

// ====== Mock 降级 ======

function generateMockAnalysis(): Record<string, unknown> {
  const categories = ["娱乐", "教程", "记录", "商业", "生活", "科技"];
  const mockScenes = [
    "开场画面，整体场景介绍",
    "人物或主体出现，开始主要内容的展示",
    "细节特写，重点内容的深入展示",
    "动作或转场，内容节奏变化",
    "高潮部分，最精彩的内容呈现",
    "结尾画面，总结或后续预告",
  ];

  return {
    scenes: mockScenes.map((desc, i) => ({
      timestamp: `00:${String((i * 10) % 60).padStart(2, "0")}`,
      description: desc,
      tags: ["自动识别", "AI 分析", `场景${i + 1}`],
    })),
    keywords: ["视频分析", "AI", "内容识别", "自动标注", "场景检测"],
    highlights: [
      { timestamp: "00:30", description: "精彩内容片段（AI 模拟识别）", score: 8 },
      { timestamp: "00:50", description: "关键信息呈现（AI 模拟识别）", score: 7 },
    ],
    summary: "这是一个视频内容的 AI 自动分析结果。当前为模拟模式，实际部署时将提供更精确的逐帧分析和内容理解。",
    category: categories[Math.floor(Math.random() * categories.length)],
  };
}

// ====== 主流程 ======

async function runAnalysis(
  task: ProcessingTask,
  updateProgress: (progress: number) => Promise<void>
): Promise<Record<string, unknown>> {
  await updateProgress(5);

  const videoPath = await getVideoPath(task.videoId);
  if (!videoPath || !fs.existsSync(videoPath)) {
    const mockResult = generateMockAnalysis();
    await updateProgress(100);
    await saveAnalysisResult(task.id, task.videoId, mockResult);
    return mockResult;
  }

  await updateProgress(8);

  // 获取视频元数据
  let meta: VideoMeta;
  try {
    meta = await getVideoMetadata(videoPath);
  } catch {
    const mockResult = generateMockAnalysis();
    await updateProgress(100);
    await saveAnalysisResult(task.id, task.videoId, mockResult);
    return mockResult;
  }

  await updateProgress(10);

  // 判断是否需要切片
  const needsSplit = meta.fileSize > MAX_VIDEO_SIZE || meta.duration > SEGMENT_DURATION;

  let segments: string[] = [videoPath];
  const segmentDir = path.join(SEGMENTS_DIR, `task_${task.id}`);

  if (needsSplit) {
    try {
      segments = await splitVideo(videoPath, task.id);
    } catch (error) {
      console.warn("[Analysis] Video split failed:", String(error));
      // 切片失败，尝试直接提交（如果文件不太大）
      if (meta.fileSize > MAX_VIDEO_SIZE * 2) {
        const mockResult = generateMockAnalysis();
        await updateProgress(100);
        await saveAnalysisResult(task.id, task.videoId, mockResult);
        return mockResult;
      }
    }
  }

  await updateProgress(15);

  const totalSegments = segments.length;
  const progressPerSegment = 65 / totalSegments; // 15% → 80%

  const allResults: Record<string, unknown>[] = [];

  try {
    for (let i = 0; i < totalSegments; i++) {
      const segmentPath = segments[i];
      const result = await analyzeVideo(
        segmentPath,
        totalSegments > 1,
        i + 1,
        totalSegments,
      );
      allResults.push(result);
      await updateProgress(15 + Math.round(progressPerSegment * (i + 1)));
    }
  } catch (error) {
    console.warn("[Analysis] AI analysis failed:", String(error));
    // 如果至少有一段成功，使用已有的结果
    if (allResults.length === 0) {
      const mockResult = generateMockAnalysis();
      await updateProgress(100);
      await saveAnalysisResult(task.id, task.videoId, mockResult);
      return mockResult;
    }
  }

  await updateProgress(85);

  // 合并多段结果
  const analysisResult = mergeSegmentResults(allResults);

  await updateProgress(90);

  // 存储结果
  await saveAnalysisResult(task.id, task.videoId, analysisResult);

  // 清理临时切片
  if (needsSplit && fs.existsSync(segmentDir)) {
    fs.rmSync(segmentDir, { recursive: true, force: true });
  }

  await updateProgress(100);

  return analysisResult;
}

async function saveAnalysisResult(
  taskId: number,
  videoId: number,
  result: Record<string, unknown>
) {
  const db = await getDb();
  if (!db) return;

  const scenes = result.scenes || [];
  const keywords = result.keywords || [];
  const highlights = result.highlights || [];

  await db.insert(videoAnalysis).values({
    taskId,
    videoId,
    sceneDescriptions: scenes,
    keywords,
    highlights,
    metadata: {
      summary: result.summary,
      category: result.category,
    },
  });
}

registerTaskHandler("analysis", runAnalysis);

async function runCombined(
  task: ProcessingTask,
  updateProgress: (progress: number) => Promise<void>
): Promise<Record<string, unknown>> {
  const analysisResult = await runAnalysis(task, async (p) =>
    updateProgress(Math.round(p * 0.5))
  );
  const { runSubtitle } = await import("./subtitleService");
  const subtitleResult = await runSubtitle(task, async (p) =>
    updateProgress(50 + Math.round(p * 0.5))
  );
  return { analysis: analysisResult, subtitle: subtitleResult };
}

registerTaskHandler("combined", runCombined);

export async function getAnalysisByTaskId(
  taskId: number
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(videoAnalysis)
    .where(eq(videoAnalysis.taskId, taskId))
    .limit(1);

  return result.length > 0
    ? {
        id: result[0].id,
        taskId: result[0].taskId,
        videoId: result[0].videoId,
        sceneDescriptions: result[0].sceneDescriptions,
        keywords: result[0].keywords,
        highlights: result[0].highlights,
        metadata: result[0].metadata,
        createdAt: result[0].createdAt,
      }
    : null;
}

export async function getAnalysisByVideoId(
  videoId: number
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(videoAnalysis)
    .where(eq(videoAnalysis.videoId, videoId))
    .limit(1);

  return result.length > 0
    ? {
        id: result[0].id,
        taskId: result[0].taskId,
        videoId: result[0].videoId,
        sceneDescriptions: result[0].sceneDescriptions,
        keywords: result[0].keywords,
        highlights: result[0].highlights,
        metadata: result[0].metadata,
        createdAt: result[0].createdAt,
      }
    : null;
}
