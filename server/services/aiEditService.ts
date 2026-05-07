import { getDb } from "../db";
import { videos, videoAnalysis } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { ProcessingTask } from "../../drizzle/schema";
import { registerTaskHandler } from "./taskService";
import { openai } from "../_core/openai";
import { ENV } from "../_core/env";
import { trimVideo, sliceAndMerge, changeSpeed, outputPath } from "./editingService";
import fs from "node:fs";

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

async function getAnalysisForVideo(videoId: number): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(videoAnalysis)
    .where(eq(videoAnalysis.videoId, videoId))
    .limit(1);

  if (result.length === 0) return null;

  return {
    scenes: result[0].sceneDescriptions || [],
    keywords: result[0].keywords || [],
    highlights: result[0].highlights || [],
    metadata: result[0].metadata || {},
  };
}

const AI_EDIT_PROMPT = (analysis: Record<string, unknown>, userPrompt: string) => {
  const scenes = (analysis.scenes as any[]) || [];
  const highlights = (analysis.highlights as any[]) || [];
  const keywords = (analysis.keywords as string[]) || [];
  const metadata = (analysis.metadata as Record<string, any>) || {};
  const summary = metadata.summary || "";
  const category = metadata.category || "";

  const scenesText = scenes.map((s, i) =>
    `  ${i + 1}. [${s.timestamp}] ${s.description}`
  ).join("\n");

  const highlightsText = highlights.map((h, i) =>
    `  ${i + 1}. [${h.timestamp}] 评分${h.score}/10: ${h.description}`
  ).join("\n");

  return `你是一个专业的视频剪辑助手。根据视频分析结果和用户的剪辑需求，生成精确的剪辑操作指令。

## 视频信息
- 分类: ${category}
- 摘要: ${summary}
- 关键词: ${keywords.join(", ")}

## 已识别的场景（带时间戳）
${scenesText || "无"}

## 精彩片段（带时间戳和评分）
${highlightsText || "无"}

## 用户剪辑需求
${userPrompt}

## 输出要求
请根据场景和精彩片段的时间信息，把用户需求转化为精确的剪辑指令。
时间格式统一使用 HH:MM:SS（如 00:01:30 表示1分30秒）。

只返回 JSON，不要其他文字：

{
  "operation": "trim" | "slice" | "speed",
  "explanation": "向用户解释你将如何剪辑（中文）",
  "params": {
    // 如果 operation 是 trim:
    "trim": { "startTime": "00:00:30", "endTime": "00:02:15" }
    // 如果 operation 是 slice（合并多个片段）:
    "slices": [{ "start": "00:00:10", "end": "00:00:30" }, { "start": "00:01:00", "end": "00:01:45" }]
    // 如果 operation 是 speed:
    "speed": 1.5
  }
}`;
};

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

  const params = (task.parameters || {}) as { prompt?: string };
  if (!params.prompt) {
    throw new Error("请提供剪辑指令");
  }

  const videoPath = await getVideoPath(task.videoId);
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error("视频文件不存在");
  }

  await updateProgress(10);

  // 获取分析结果
  const analysis = await getAnalysisForVideo(task.videoId);
  if (!analysis || !(analysis.scenes as any[])?.length) {
    throw new Error("该视频尚未完成内容分析，请先分析视频");
  }

  await updateProgress(15);

  // 发送给 AI 生成编辑计划
  let editPlan: EditPlan;
  try {
    const promptText = AI_EDIT_PROMPT(analysis, params.prompt);

    const result = await openai.chat.completions.create({
      model: ENV.openaiChatModel,
      messages: [{ role: "user", content: promptText }],
      max_tokens: 1000,
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

  // 执行编辑
  const output = outputPath(task.id, editPlan.operation);
  const { operation, params: editParams, explanation } = editPlan;

  try {
    switch (operation) {
      case "trim": {
        const t = editParams.trim as { startTime: string; endTime: string };
        if (!t?.startTime || !t?.endTime) throw new Error("缺少裁剪时间参数");
        await trimVideo(videoPath, output, t.startTime, t.endTime);
        break;
      }
      case "slice": {
        const s = editParams.slices as { start: string; end: string }[];
        if (!s || s.length === 0) throw new Error("缺少切片参数");
        await sliceAndMerge(videoPath, output, s);
        break;
      }
      case "speed": {
        const sp = editParams.speed as number;
        if (!sp || sp <= 0) throw new Error("缺少有效速度参数");
        await changeSpeed(videoPath, output, sp);
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

registerTaskHandler("ai_edit", runAiEdit);

export { runAiEdit };
