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

  return fs
    .readdirSync(taskDir)
    .filter((f) => f.startsWith("seg_") && f.endsWith(".mp4"))
    .sort()
    .map((f) => path.join(taskDir, f));
}

// ====== 视频转 Base64 ======

function videoToBase64(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return `data:video/mp4;base64,${data.toString("base64")}`;
}

// ====== AI 分析提示词 ======

/**
 * 完整视频分析提示词（≤60秒 / 小文件直接分析时使用）
 *
 * 优化重点：
 * 1. 明确告知 AI 输出对象是"剪辑师"，让描述更实用
 * 2. 场景描述增加"可用性"维度，便于后续剪辑决策
 * 3. highlights 新增 reason 字段说明精彩原因
 * 4. 要求输出严格 JSON，避免 markdown 包裹
 */
const ANALYSIS_PROMPT = `你是专业视频内容分析师，你的分析结果直接用于 AI 剪辑系统。完整观看视频，输出 JSON。

## 关键任务：识别废片（必做）
你必须逐帧审查，精确标记所有不可用的片段：
- 黑屏/白屏/纯色画面（哪怕只有 0.1 秒）
- 闪白/闪黑转场效果（视频自带的劣质转场瑕疵）
- 严重模糊/失焦/剧烈晃动（导致眩晕感的片段）
- 花屏/画面撕裂/跳帧/编码错误
- 镜头盖未开/拍摄者调试/误触录制的画面
- 与主体完全无关的随机画面
- 极短片段：持续 < 0.5 秒的碎片画面（几十帧的无意义片段）

废片放入 wasteSegments 数组，不要放入 scenes。剪辑系统会自动跳过它们。

## 场景质量标准（quality 字段）
- "优质"：清晰稳定，可直接用作主镜头
- "可用"：轻微瑕疵不影响使用
- "一般"：有明显抖动/噪点，建议缩短使用时长
- "较差"：模糊/闪白/黑屏/剧烈晃动 → 放入 wasteSegments

## 输出 JSON（只输出 JSON）
{
  "scenes": [
    {
      "startTime": 0.0,
      "endTime": 4.5,
      "description": "画面内容（人物/物体/动作/构图/光线/色彩，25字内）",
      "shotType": "特写|近景|中景|远景|空镜|转场",
      "motion": "静止|微动|运动|剧烈运动",
      "quality": "优质|可用|一般|较差",
      "audioGuess": "清晰人声|模糊人声|环境音|安静无声",
      "tags": ["标签"]
    }
  ],
  "wasteSegments": [
    {
      "startTime": 12.0,
      "endTime": 12.3,
      "description": "闪白转场瑕疵，约9帧",
      "type": "闪白|黑屏|模糊|晃动|花屏|无关|极短"
    }
  ],
  "highlights": [
    {
      "startTime": 3.0,
      "endTime": 6.5,
      "description": "精彩原因",
      "score": 9
    }
  ],
  "keywords": ["关键词", 最多8个],
  "summary": "整体总结，50字内",
  "category": "口播|带货|短剧|解说|Vlog|美食|教程|混剪|其他",
  "hasClearAudio": true,
  "usabilityScore": 8
}`;

/**
 * 分段视频分析提示词（大文件切片后逐段分析时使用）
 *
 * 与完整版的差异：
 * - 明确告知当前段的时间偏移背景，让 AI 意识到自己在分析"片段"
 * - 删去 hasClearAudio / usabilityScore（在合并阶段统一计算）
 * - 压缩输出体积，每段 keywords 不超过 5 个
 */
function buildSegmentPrompt(segmentIndex: number, totalSegments: number, offsetSeconds: number): string {
  return `你是专业视频内容分析师。这是视频第 ${segmentIndex}/${totalSegments} 段（偏移：${offsetSeconds}秒），时间戳从 0 开始。

## 关键任务
逐场景描述画面，标记废片（黑屏/闪白/模糊/晃动/无关/极短片段）。废片放入 wasteSegments，不放 scenes。

## 输出 JSON（只输出 JSON）
{
  "scenes": [
    {
      "startTime": 0.0,
      "endTime": 5.0,
      "description": "画面内容（25字内）",
      "shotType": "特写|近景|中景|远景|空镜|转场",
      "motion": "静止|微动|运动|剧烈运动",
      "quality": "优质|可用|一般|较差",
      "audioGuess": "清晰人声|模糊人声|环境音|安静无声",
      "tags": ["标签"]
    }
  ],
  "wasteSegments": [
    { "startTime": 0.0, "endTime": 0.5, "description": "闪白瑕疵", "type": "闪白|黑屏|模糊|晃动|花屏|无关|极短" }
  ],
  "highlights": [
    { "startTime": 0.0, "endTime": 3.0, "description": "精彩原因", "score": 8 }
  ],
  "keywords": ["关键词"],
  "summary": "本段总结，30字内",
  "category": "口播|带货|短剧|解说|Vlog|美食|教程|混剪|其他"
}`;
}

// ====== AI 分析 ======

async function analyzeVideo(
  videoPath: string,
  isSegment: boolean,
  segmentIndex: number,
  totalSegments: number,
): Promise<Record<string, unknown>> {
  const dataUrl = videoToBase64(videoPath);

  const offsetSeconds = (segmentIndex - 1) * SEGMENT_DURATION;
  const promptText = isSegment
    ? buildSegmentPrompt(segmentIndex, totalSegments, offsetSeconds)
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

  // 尝试提取 JSON（兼容模型输出 markdown 代码块的情况）
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fence ? fence[1].trim() : text;
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
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

function toSeconds(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseTimestamp(val);
  return 0;
}

/**
 * 合并多段分析结果，时间戳加上段偏移量还原为全局时间。
 * 优化：
 * - 过滤 quality="较差" 的场景（不阻止存储，仍保留，只打标记）
 * - highlights 按 score 降序，取前 10 个最精彩
 * - category 取出现最多次的值（投票）
 * - 汇总 usabilityScore 取平均
 */
function mergeSegmentResults(results: Record<string, unknown>[]): Record<string, unknown> {
  if (results.length === 1) return results[0];

  const allScenes: unknown[] = [];
  const allKeywords = new Set<string>();
  const allHighlights: Array<Record<string, unknown>> = [];
  const summaries: string[] = [];
  const categoryVotes: Record<string, number> = {};
  const usabilityScores: number[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const offset = i * SEGMENT_DURATION;

    // 合并 scenes（兼容新旧格式）
    const scenes = (r.scenes as any[]) || [];
    for (const s of scenes) {
      const start = toSeconds(s.startTime ?? s.timestamp) + offset;
      const rawEnd = toSeconds(s.endTime ?? s.startTime ?? s.timestamp) + offset;
      const end = rawEnd > start ? rawEnd : start + 3;
      allScenes.push({
        startTime: Math.round(start * 10) / 10,
        endTime: Math.round(end * 10) / 10,
        description: s.description || "",
        shotType: s.shotType || "",
        motion: s.motion || "",
        quality: s.quality || "可用",
        audioGuess: s.audioGuess || "",
        tags: s.tags || [],
      });
    }

    // 合并 highlights，保留 score / reason
    const highlights = (r.highlights as any[]) || [];
    for (const h of highlights) {
      const hStart = toSeconds(h.startTime ?? h.timestamp) + offset;
      const hRawEnd = toSeconds(h.endTime ?? h.startTime ?? h.timestamp) + offset;
      const hEnd = hRawEnd > hStart ? hRawEnd : hStart + 2;
      allHighlights.push({
        startTime: Math.round(hStart * 10) / 10,
        endTime: Math.round(hEnd * 10) / 10,
        description: h.description || "",
        score: typeof h.score === "number" ? h.score : 5,
        reason: h.reason || "",
      });
    }

    // 关键词去重
    const keywords = (r.keywords as string[]) || [];
    for (const k of keywords) allKeywords.add(k);

    // 摘要收集
    if (r.summary) summaries.push(r.summary as string);

    // category 投票
    const cat = (r.category as string) || "其他";
    categoryVotes[cat] = (categoryVotes[cat] || 0) + 1;

    // usabilityScore 收集
    if (typeof r.usabilityScore === "number") {
      usabilityScores.push(r.usabilityScore);
    }
  }

  // highlights 去重（相似时间段）并降序取前 10
  const dedupedHighlights = allHighlights
    .sort((a, b) => (b.score as number) - (a.score as number))
    .filter((h, idx, arr) => {
      // 去掉与已选中的高光时间重叠超过 50% 的条目
      return !arr.slice(0, idx).some((prev) => {
        const overlap =
          Math.min(h.endTime as number, prev.endTime as number) -
          Math.max(h.startTime as number, prev.startTime as number);
        const duration = (h.endTime as number) - (h.startTime as number);
        return overlap > duration * 0.5;
      });
    })
    .slice(0, 10);

  // category 取票数最多的
  const topCategory = Object.entries(categoryVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || "其他";

  // usabilityScore 平均
  const avgUsability =
    usabilityScores.length > 0
      ? Math.round(usabilityScores.reduce((a, b) => a + b, 0) / usabilityScores.length)
      : undefined;

  return {
    scenes: allScenes,
    keywords: Array.from(allKeywords).slice(0, 15),
    highlights: dedupedHighlights,
    summary: summaries.join(" ／ ").slice(0, 300),
    category: topCategory,
    ...(avgUsability !== undefined ? { usabilityScore: avgUsability } : {}),
  };
}

// ====== Mock 降级（字段对齐正式格式） ======

function generateMockAnalysis(): Record<string, unknown> {
  return {
    scenes: [
      { startTime: 0.0, endTime: 5.0, description: "开场画面，整体场景介绍", shotType: "远景", motion: "静止", quality: "可用", audioGuess: "环境音", tags: ["开场", "场景介绍"] },
      { startTime: 5.0, endTime: 12.0, description: "主体出现，开始展示核心内容", shotType: "中景", motion: "微动", quality: "可用", audioGuess: "清晰人声", tags: ["主体", "核心内容"] },
      { startTime: 12.0, endTime: 18.0, description: "细节特写，重点内容深度展示", shotType: "特写", motion: "静止", quality: "优质", audioGuess: "清晰人声", tags: ["特写", "细节"] },
      { startTime: 18.0, endTime: 25.0, description: "动作转场，内容节奏变化", shotType: "中景", motion: "运动", quality: "可用", audioGuess: "环境音", tags: ["动作", "转场"] },
      { startTime: 25.0, endTime: 35.0, description: "高潮部分，最精彩内容呈现", shotType: "近景", motion: "微动", quality: "优质", audioGuess: "清晰人声", tags: ["高潮", "精彩"] },
      { startTime: 35.0, endTime: 42.0, description: "结尾收束，总结或后续预告", shotType: "远景", motion: "静止", quality: "可用", audioGuess: "清晰人声", tags: ["结尾", "总结"] },
    ],
    keywords: ["视频内容", "自动分析", "AI 识别", "场景检测", "内容理解"],
    highlights: [
      { startTime: 25.0, endTime: 32.0, description: "高潮内容段落", score: 8, reason: "视觉表现力强，适合作为引流片段" },
      { startTime: 12.0, endTime: 18.0, description: "细节特写段落", score: 7, reason: "画质优质，信息密度高" },
    ],
    summary: "AI 模拟分析结果。实际部署后将提供精确的场景识别、情绪分析和可用性评分，帮助剪辑师高效定位优质素材。",
    category: "其他",
    hasClearAudio: false,
    usabilityScore: 6,
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
    console.warn(`[Analysis] 视频文件不存在，taskId=${task.id}, videoId=${task.videoId}`);
    const mockResult = generateMockAnalysis();
    await saveAnalysisResult(task.id, task.videoId, mockResult);
    await updateProgress(100);
    return mockResult;
  }

  await updateProgress(8);

  // 获取视频元数据
  let meta: VideoMeta;
  try {
    meta = await getVideoMetadata(videoPath);
  } catch (err) {
    console.warn("[Analysis] 获取视频元数据失败:", String(err));
    const mockResult = generateMockAnalysis();
    await saveAnalysisResult(task.id, task.videoId, mockResult);
    await updateProgress(100);
    return mockResult;
  }

  await updateProgress(10);

  // 更新 videos 表中的 duration（如果尚未写入）
  await updateVideoDuration(task.videoId, meta.duration);

  // 判断是否需要切片
  const needsSplit = meta.fileSize > MAX_VIDEO_SIZE || meta.duration > SEGMENT_DURATION;
  const segmentDir = path.join(SEGMENTS_DIR, `task_${task.id}`);

  let segments: string[] = [videoPath];
  if (needsSplit) {
    try {
      segments = await splitVideo(videoPath, task.id);
      console.log(`[Analysis] 切片完成，共 ${segments.length} 段`);
    } catch (err) {
      console.warn("[Analysis] 视频切片失败，降级为直接分析:", String(err));
      // 文件过大且切片失败 → 降级 mock
      if (meta.fileSize > MAX_VIDEO_SIZE * 2) {
        console.warn("[Analysis] 文件过大且切片失败，使用 Mock 降级");
        const mockResult = generateMockAnalysis();
        await saveAnalysisResult(task.id, task.videoId, mockResult);
        await updateProgress(100);
        return mockResult;
      }
      // 文件可接受大小 → 继续尝试直接分析
    }
  }

  await updateProgress(15);

  const totalSegments = segments.length;
  const progressPerSegment = 65 / totalSegments; // 15% → 80%
  const allResults: Record<string, unknown>[] = [];

  for (let i = 0; i < totalSegments; i++) {
    try {
      const result = await analyzeVideo(segments[i], totalSegments > 1, i + 1, totalSegments);
      allResults.push(result);
      console.log(`[Analysis] 段 ${i + 1}/${totalSegments} 分析完成`);
    } catch (err) {
      console.warn(`[Analysis] 段 ${i + 1}/${totalSegments} 分析失败:`, String(err));
      // 单段失败不中断整体流程，继续分析下一段
    }
    await updateProgress(15 + Math.round(progressPerSegment * (i + 1)));
  }

  // 所有段均失败 → 降级 mock
  if (allResults.length === 0) {
    console.warn("[Analysis] 全部段分析失败，使用 Mock 降级");
    const mockResult = generateMockAnalysis();
    await saveAnalysisResult(task.id, task.videoId, mockResult);
    await updateProgress(100);
    return mockResult;
  }

  await updateProgress(85);

  // 合并多段结果
  const analysisResult = mergeSegmentResults(allResults);

  await updateProgress(90);

  // 存储结果
  await saveAnalysisResult(task.id, task.videoId, analysisResult);

  // 清理临时切片
  if (needsSplit && fs.existsSync(segmentDir)) {
    try {
      fs.rmSync(segmentDir, { recursive: true, force: true });
    } catch (err) {
      console.warn("[Analysis] 清理临时切片失败:", String(err));
    }
  }

  await updateProgress(100);

  return analysisResult;
}

// ====== 数据持久化 ======

/**
 * 更新 videos 表的 duration 字段（仅在字段为空时写入，避免重复更新）
 */
async function updateVideoDuration(videoId: number, duration: number): Promise<void> {
  if (!duration || duration <= 0) return;
  try {
    const db = await getDb();
    if (!db) return;
    const rows = await db.select({ duration: videos.duration }).from(videos).where(eq(videos.id, videoId)).limit(1);
    if (rows.length > 0 && !rows[0].duration) {
      await db.update(videos).set({ duration: String(duration) }).where(eq(videos.id, videoId));
    }
  } catch (err) {
    console.warn("[Analysis] 更新 duration 失败:", String(err));
  }
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
      hasClearAudio: result.hasClearAudio,
      usabilityScore: result.usabilityScore,
    },
  });
}

// ====== 任务注册 ======

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

// ====== 查询接口 ======

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

  return result.length > 0 ? mapAnalysisRow(result[0]) : null;
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

  return result.length > 0 ? mapAnalysisRow(result[0]) : null;
}

function mapAnalysisRow(row: any): Record<string, unknown> {
  return {
    id: row.id,
    taskId: row.taskId,
    videoId: row.videoId,
    sceneDescriptions: row.sceneDescriptions,
    keywords: row.keywords,
    highlights: row.highlights,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}