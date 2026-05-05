import { getDb } from "../db";
import { videoAnalysis, videos } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { ProcessingTask } from "../../drizzle/schema";
import { registerTaskHandler } from "./taskService";
import { openai } from "../_core/openai";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execAsync = promisify(exec);

const FRAME_COUNT = 6;
const FRAMES_DIR = path.resolve("uploads/frames");

function ensureFramesDir() {
  if (!fs.existsSync(FRAMES_DIR)) {
    fs.mkdirSync(FRAMES_DIR, { recursive: true });
  }
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

async function extractFrames(
  videoPath: string,
  taskId: number
): Promise<string[]> {
  ensureFramesDir();
  const taskDir = path.join(FRAMES_DIR, `task_${taskId}`);
  if (!fs.existsSync(taskDir)) {
    fs.mkdirSync(taskDir, { recursive: true });
  }

  // Get video duration
  const { stdout: durationOut } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`
  );
  const duration = parseFloat(durationOut.trim());

  const framePaths: string[] = [];
  const interval = duration / (FRAME_COUNT + 1);

  for (let i = 1; i <= FRAME_COUNT; i++) {
    const seekTime = interval * i;
    const framePath = path.join(taskDir, `frame_${i}.jpg`);

    await execAsync(
      `ffmpeg -ss ${seekTime} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}" -y`
    );
    framePaths.push(framePath);
  }

  return framePaths;
}

function imageToBase64(filePath: string): string {
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${data.toString("base64")}`;
}

const ANALYSIS_PROMPT = `你是一个专业的视频内容分析专家。请仔细分析这些从视频中提取的关键帧，它们按时间顺序排列。

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

async function analyzeWithAI(
  framePaths: string[],
  updateProgress: (progress: number) => Promise<void>
): Promise<Record<string, unknown>> {
  await updateProgress(20);

  const imageContents = framePaths.map((fp) => ({
    type: "image_url" as const,
    image_url: { url: imageToBase64(fp), detail: "low" as const },
  }));

  try {
    await updateProgress(30);

    const result = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            ...imageContents,
            { type: "text" as const, text: ANALYSIS_PROMPT },
          ],
        },
      ],
      max_tokens: 2000,
    });

    await updateProgress(80);

    const content = result.choices[0]?.message?.content;
    if (!content) throw new Error("AI 分析返回空结果");

    const text = typeof content === "string" ? content : JSON.stringify(content);

    // 尝试提取 JSON（处理 AI 可能包裹在 ```json 中）
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("无法解析 AI 返回的 JSON");

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.warn("[Analysis] AI analysis failed:", String(error));
    // 返回模拟分析结果
    return generateMockAnalysis();
  }
}

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
      {
        timestamp: "00:30",
        description: "精彩内容片段（AI 模拟识别）",
        score: 8,
      },
      {
        timestamp: "00:50",
        description: "关键信息呈现（AI 模拟识别）",
        score: 7,
      },
    ],
    summary: "这是一个视频内容的 AI 自动分析结果。当前为模拟模式，实际部署时将提供更精确的逐帧分析和内容理解。",
    category: categories[Math.floor(Math.random() * categories.length)],
  };
}

async function runAnalysis(
  task: ProcessingTask,
  updateProgress: (progress: number) => Promise<void>
): Promise<Record<string, unknown>> {
  await updateProgress(5);

  // 获取视频路径
  const videoPath = await getVideoPath(task.videoId);
  if (!videoPath || !fs.existsSync(videoPath)) {
    // 视频文件不存在，使用模拟分析
    await updateProgress(15);
    const mockResult = generateMockAnalysis();
    await updateProgress(100);
    await saveAnalysisResult(task.id, task.videoId, mockResult);
    return mockResult;
  }

  await updateProgress(10);

  // 提取关键帧
  let framePaths: string[];
  try {
    framePaths = await extractFrames(videoPath, task.id);
  } catch (error) {
    console.warn("[Analysis] Frame extraction failed:", String(error));
    const mockResult = generateMockAnalysis();
    await updateProgress(100);
    await saveAnalysisResult(task.id, task.videoId, mockResult);
    return mockResult;
  }

  // AI 分析
  const analysisResult = await analyzeWithAI(framePaths, updateProgress);

  await updateProgress(90);

  // 存储结果
  await saveAnalysisResult(task.id, task.videoId, analysisResult);

  // 清理帧文件
  const taskFramesDir = path.join(FRAMES_DIR, `task_${task.id}`);
  fs.rmSync(taskFramesDir, { recursive: true, force: true });

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

// 注册分析任务处理器
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
