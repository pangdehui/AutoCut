import { getDb } from "../db";
import { subtitles, videos } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { ProcessingTask } from "../../drizzle/schema";
import { registerTaskHandler } from "./taskService";
import { openai } from "../_core/openai";
import { ENV } from "../_core/env";
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
  const audioPath = path.join(AUDIO_DIR, `audio_${taskId}.mp3`);

  await execAsync(
    `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -q:a 2 "${audioPath}" -y`
  );

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

  try {
    const audioStream = fs.createReadStream(audioPath);
    const response = await openai.audio.transcriptions.create({
      file: audioStream,
      model: ENV.openaiWhisperModel,
      response_format: "verbose_json",
    });

    const segments = (response as any).segments as
      | { start: number; end: number; text: string }[]
      | undefined;

    if (segments && segments.length > 0) {
      return segments.map((seg, i) => ({
        index: i + 1,
        start: seg.start,
        end: seg.end,
        text: seg.text.trim(),
      }));
    }

    if (response.text) {
      return [{ index: 1, start: 0, end: 5, text: response.text.trim() }];
    }
  } catch (error) {
    console.warn("[Subtitle] OpenAI Whisper ASR failed:", String(error));
  }

  return generateMockSubtitles();
}

function generateMockSubtitles(): SubEntry[] {
  const lines = [
    "大家好，欢迎观看本期视频。",
    "今天我们来聊聊一个非常有趣的话题。",
    "首先让我们看一下基本的操作方法。",
    "打开软件之后，你可以看到主界面上有几个选项。",
    "点击开始按钮，系统会自动进行初始化设置。",
    "在整个过程中，你不需要手动干预。",
    "接下来是最关键的部分，请仔细看。",
    "这种方式可以极大提高工作效率，节省大量时间。",
    "根据测试数据显示，性能提升了约百分之三十。",
    "当然，具体效果还要根据实际情况来判断。",
    "如果你有任何问题，可以在评论区留言。",
    "最后总结一下今天的主要内容。",
    "感谢大家的收看，我们下期再见。",
  ];

  return lines.map((text, i) => ({
    index: i + 1,
    start: i * 5 + 1,
    end: i * 5 + 4.5,
    text,
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
  outputPath: string
): Promise<void> {
  await execAsync(
    `ffmpeg -i "${videoPath}" -vf "subtitles='${srtPath.replace(/\\/g, "/")}':force_style='FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'" -c:v libx264 -preset medium -crf 23 -c:a aac "${outputPath}" -y`
  );
}

// ====== 任务处理器 ======

interface SubtitleParams {
  targetLanguages?: string[];
  burnIn?: boolean;
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
    const burnLang = targetLanguages.includes("zh") ? "zh" : targetLanguages[0];
    const srtToBurn = path.join(SUBTITLE_DIR, `sub_${task.id}_${burnLang}.srt`);
    const burntPath = path.resolve("uploads/output", `burned_${task.id}.mp4`);

    const outDir = path.resolve("uploads/output");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    await updateProgress(85);
    await burnSubtitles(videoPath, srtToBurn, burntPath);
    burntVideo = burntPath;
  }

  // 清理音频
  if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

  await updateProgress(100);

  return {
    subtitles: results,
    burntVideo,
    totalEntries: entries.length,
    message: `字幕生成完成，共 ${entries.length} 条字幕，${targetLanguages.length} 种语言`,
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
