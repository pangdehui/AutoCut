import { getDb } from "../db";
import { subtitles, videos } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { ProcessingTask } from "../../drizzle/schema";
import { registerTaskHandler } from "./taskService";
import { ENV } from "../_core/env";
import { openai } from "../_core/openai";
import { transcribeAudio, mergeToSentences } from "./volcanoAsrService";
import { subtitleStyleString, type SubtitleStyle, type SubtitleConfig } from "./subtitleStyle";
import { pickBgmByMood, type BgmMood } from "./bgmService";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const execAsync = promisify(exec);

const AUDIO_DIR = path.resolve("uploads/audio");
const SUBTITLE_DIR = path.resolve("uploads/subtitles");

function ensureDirs() {
  for (const d of [AUDIO_DIR, SUBTITLE_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
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

// ====== 音频提取 ======

async function extractAudio(videoPath: string, taskId: number): Promise<string> {
  ensureDirs();

  // 先检查视频是否包含音频流
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${videoPath}"`
    );
    if (!stdout.trim()) {
      throw new Error("该视频没有音频轨道，无法通过语音识别生成字幕。请确认视频包含人声。");
    }
  } catch (e: any) {
    if (e.message?.includes("没有音频轨道") || e.message?.includes("无法通过语音识别")) throw e;
    // ffprobe 失败不阻塞，继续尝试提取
  }

  const audioPath = path.join(AUDIO_DIR, `audio_${taskId}.mp3`);

  await execAsync(
    `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -q:a 2 "${audioPath}" -y`
  );

  // 检查提取的音频是否有效（时长 > 0.5 秒）
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`
    );
    const duration = parseFloat(stdout.trim());
    if (isNaN(duration) || duration < 0.5) {
      throw new Error("提取的音频太短或为空，视频可能没有有效的人声内容。");
    }
  } catch (e: any) {
    if (e.message?.includes("太短") || e.message?.includes("人声")) throw e;
    // ffprobe 失败不阻塞
  }

  return audioPath;
}

// ====== SRT 生成 ======

interface SubEntry {
  index: number;
  start: number; // seconds
  end: number;
  text: string;
}

function secondsToSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function generateSrt(entries: SubEntry[]): string {
  return entries
    .map(
      (e) =>
        `${e.index}\n${secondsToSrtTime(e.start)} --> ${secondsToSrtTime(e.end)}\n${e.text}\n`
    )
    .join("\n");
}

// ====== ASR 语音识别 ======

async function runASR(audioPath: string, taskId: number): Promise<SubEntry[]> {
  ensureDirs();

  const rawSegments = await transcribeAudio(audioPath);

  if (rawSegments.length === 0) {
    throw new Error("火山 ASR 未返回任何识别结果，视频可能没有人声或音频质量过低。");
  }

  let segments = rawSegments;
  try {
    segments = await mergeToSentences(rawSegments);
  } catch (e) {
    console.warn("[Subtitle] mergeToSentences 失败，使用原始片段:", String(e));
    segments = rawSegments;
  }
  return segments.map((seg, i) => ({
    index: i + 1,
    start: seg.start,
    end: seg.end,
    text: seg.text,
  }));
}

// ====== 翻译 ======

async function translateSubtitles(
  entries: SubEntry[],
  targetLang: string
): Promise<SubEntry[]> {
  const langNames: Record<string, string> = {
    en: "English",
    ja: "Japanese",
    ko: "Korean",
    fr: "French",
    de: "German",
    es: "Spanish",
    pt: "Portuguese",
    ru: "Russian",
  };

  const langName = langNames[targetLang] || targetLang;
  const allText = entries.map((e) => e.text).join("\n---\n");

  try {
    const result = await openai.chat.completions.create({
      model: ENV.openaiChatModel,
      messages: [
        {
          role: "user",
          content: `将以下中文字幕逐行翻译成${langName}。保持行数和顺序不变，每行用 "---" 分隔。只返回翻译后的文本：\n\n${allText}`,
        },
      ],
    });

    const content = result.choices[0]?.message?.content;
    if (content) {
      const text = typeof content === "string" ? content : JSON.stringify(content);
      const translatedLines = text
        .split("---")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      return entries.map((entry, i) => ({
        ...entry,
        text: translatedLines[i] || entry.text,
      }));
    }
  } catch (error) {
    console.warn("[Subtitle] Translation failed:", String(error));
  }

  return entries;
}

// ====== 字幕压制 ======

async function burnSubtitles(
  videoPath: string,
  srtPath: string,
  outputPath: string,
  style: SubtitleStyle = "default",
  config?: SubtitleConfig,
): Promise<void> {
  const safeSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const styleStr = subtitleStyleString(style, config);
  await execAsync(
    `ffmpeg -i "${videoPath}" -vf "subtitles='${safeSrt}':force_style='${styleStr}'" -c:v libx264 -preset medium -crf 23 -c:a aac "${outputPath}" -y`
  );
}

// ====== 任务处理器 ======

interface SubtitleParams {
  targetLanguages?: string[];
  burnIn?: boolean;
  /** 烧录字幕样式：default / bold_caption / minimal / tiktok_yellow */
  style?: SubtitleStyle;
  /** 字幕样式细粒度覆盖：在 style 预设上叠加（颜色/字号/字体/位置 等） */
  subtitleConfig?: SubtitleConfig;
  /** 烧录使用哪个语言版本，默认中文优先 */
  burnLanguage?: string;
  /** 背景音乐情绪，不填则不加 BGM */
  bgmMood?: BgmMood;
  /** BGM 音量 0-1 */
  bgmVolume?: number;
}

async function runSubtitle(
  task: ProcessingTask,
  updateProgress: (progress: number) => Promise<void>
): Promise<Record<string, unknown>> {
  await updateProgress(5);

  const params = (task.parameters || {}) as SubtitleParams;
  const targetLanguages = params.targetLanguages || ["en"];
  const burnIn = params.burnIn ?? false;

  const videoPath = await getVideoPath(task.videoId);
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error("视频文件不存在");
  }

  await updateProgress(10);

  // 提取音频
  const audioPath = await extractAudio(videoPath, task.id);
  await updateProgress(20);

  // ASR 语音识别
  const entries = await runASR(audioPath, task.id);
  await updateProgress(50);

  const results: Record<string, unknown> = {};
  const generationProgressPerLang = 40 / Math.max(targetLanguages.length, 1);

  // 生成原始语言字幕
  const originalSrt = generateSrt(entries);
  const originalSrtPath = path.join(SUBTITLE_DIR, `sub_${task.id}_zh.srt`);
  fs.writeFileSync(originalSrtPath, originalSrt, "utf-8");

  await saveSubtitle(task.id, task.videoId, "zh", originalSrtPath, originalSrt);
  results.zh = { path: originalSrtPath, count: entries.length };

  await updateProgress(55);

  // 翻译 + 生成多语言字幕
  for (const lang of targetLanguages) {
    if (lang === "zh") continue;
    const translated = await translateSubtitles(entries, lang);
    const srtContent = generateSrt(translated);
    const srtPath = path.join(SUBTITLE_DIR, `sub_${task.id}_${lang}.srt`);
    fs.writeFileSync(srtPath, srtContent, "utf-8");

    await saveSubtitle(task.id, task.videoId, lang, srtPath, srtContent);
    results[lang] = { path: srtPath, count: translated.length };

    await updateProgress(55 + generationProgressPerLang);
  }

  // 可选：压制字幕到视频
  let burntVideo: string | null = null;
  if (burnIn && targetLanguages.length > 0) {
    const preferredLang = params.burnLanguage;
    let burnLang: string;
    if (preferredLang && (preferredLang === "zh" || targetLanguages.includes(preferredLang))) {
      burnLang = preferredLang;
    } else if (targetLanguages.includes("zh")) {
      burnLang = "zh";
    } else {
      burnLang = targetLanguages[0];
    }
    const srtToBurn = path.join(SUBTITLE_DIR, `sub_${task.id}_${burnLang}.srt`);
    const burntPath = path.resolve("uploads/output", `burned_${task.id}.mp4`);

    const outDir = path.resolve("uploads/output");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    await updateProgress(85);
    await burnSubtitles(videoPath, srtToBurn, burntPath, params.style || "default", params.subtitleConfig);
    burntVideo = burntPath;
  }

  // 可选：添加背景音乐
  let finalVideo: string | null = burntVideo ?? videoPath;
  let bgmApplied = false;
  if (params.bgmMood && params.bgmMood !== "none") {
    const bgmPath = pickBgmByMood(params.bgmMood);
    if (bgmPath) {
      const bgmMixedPath = path.resolve("uploads/output", `bgm_${task.id}.mp4`);
      const outDir = path.resolve("uploads/output");
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      await updateProgress(92);
      // 将 BGM 混入视频：BGM 音量降低，原视频音频保留
      const bgmVol = params.bgmVolume ?? 0.15;
      await execAsync(
        `ffmpeg -i "${finalVideo}" -i "${bgmPath}" -filter_complex "` +
        `[1:a]volume=${bgmVol}[bgm];` +
        `[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[out]" ` +
        `-map 0:v -map "[out]" -c:v copy -shortest "${bgmMixedPath}" -y`
      );
      finalVideo = bgmMixedPath;
      bgmApplied = true;
    }
  }

  // 清理音频
  if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

  await updateProgress(100);

  return {
    subtitles: results,
    burntVideo,
    outputPath: finalVideo ?? videoPath,
    originalVideo: videoPath,
    burnStyle: burntVideo ? (params.style || "default") : null,
    bgmApplied,
    bgmMood: bgmApplied ? params.bgmMood : null,
    totalEntries: entries.length,
    message: `字幕生成完成，共 ${entries.length} 条字幕，${targetLanguages.length} 种语言${bgmApplied ? " + BGM" : ""}`,
  };
}

async function saveSubtitle(
  taskId: number,
  videoId: number,
  language: string,
  filePath: string,
  content: string
) {
  const db = await getDb();
  if (!db) return;

  await db.insert(subtitles).values({
    taskId,
    videoId,
    language,
    filePath,
    content,
  });
}

// 注册字幕任务处理器
registerTaskHandler("subtitle", runSubtitle);

export { runSubtitle };

export async function getSubtitlesByTaskId(
  taskId: number
): Promise<{ language: string; filePath: string | null; content: string | null }[]> {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select()
    .from(subtitles)
    .where(eq(subtitles.taskId, taskId));

  return result.map((s) => ({
    language: s.language,
    filePath: s.filePath,
    content: s.content,
  }));
}
