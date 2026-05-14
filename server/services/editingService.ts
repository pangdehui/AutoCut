import { getDb } from "../db";
import { videos } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { ProcessingTask } from "../../drizzle/schema";
import { registerTaskHandler } from "./taskService";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const execAsync = promisify(exec);

const OUTPUT_DIR = path.resolve("uploads/output");

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

// ====== 工具函数 ======

function timeToSeconds(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parseFloat(t) || 0;
}

function secondsToTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function durationBetween(start: string, end: string): string {
  const dur = timeToSeconds(end) - timeToSeconds(start);
  if (dur <= 0) throw new Error(`无效时间段：start=${start} >= end=${end}`);
  return secondsToTime(dur);
}

/** 生成不重复的临时文件路径（用 taskId + 随机数，避免并发冲突） */
function tempPath(prefix: string, ext = "mp4"): string {
  ensureOutputDir();
  return path.join(OUTPUT_DIR, `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`);
}

/** 安全删除文件，失败只打 warning */
function safeUnlink(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn(`[EditingService] 清理临时文件失败: ${filePath}`, String(err));
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

export function outputPath(taskId: number, suffix = "output"): string {
  ensureOutputDir();
  return path.join(OUTPUT_DIR, `edit_${taskId}_${suffix}.mp4`);
}

// ====== 核心剪辑操作 ======

/**
 * 裁剪视频片段。
 *
 * 注意：使用 `-c copy` 流拷贝，速度快但不重编码，裁剪点会对齐到最近的关键帧，
 * 可能导致开头/结尾有轻微偏差（通常 <1 秒）。
 * 若需要帧精确裁剪，将 `-c copy` 改为 `-c:v libx264 -c:a aac`（速度较慢）。
 */
export async function trimVideo(
  inputPath: string,
  outPath: string,
  startTime: string,
  endTime: string
): Promise<void> {
  const duration = durationBetween(startTime, endTime);
  await execAsync(
    `ffmpeg -ss ${startTime} -i "${inputPath}" -to ${duration} -c copy -avoid_negative_ts make_zero "${outPath}" -y`,
    { timeout: 120_000 }
  );
}

/**
 * 从同一视频中截取多个片段并拼接输出。
 *
 * Bug fix：原实现在清理阶段重新调用 Date.now()，导致路径与生成时不同，临时文件无法删除。
 * 现在统一在生成时记录路径，复用同一份引用进行清理。
 */
export async function sliceAndMerge(
  inputPath: string,
  outPath: string,
  segments: { start: string; end: string }[]
): Promise<void> {
  if (segments.length === 0) throw new Error("segments 不能为空");

  const concatList = tempPath("concat_list", "txt");
  const segPaths: string[] = [];

  try {
    for (let i = 0; i < segments.length; i++) {
      const segPath = tempPath(`seg_slice_${i}`);
      segPaths.push(segPath);

      const dur = durationBetween(segments[i].start, segments[i].end);
      await execAsync(
        `ffmpeg -ss ${segments[i].start} -i "${inputPath}" -to ${dur} -c copy -avoid_negative_ts make_zero "${segPath}" -y`,
        { timeout: 120_000 }
      );
      fs.appendFileSync(concatList, `file '${segPath.replace(/\\/g, "/")}'\n`);
    }

    await execAsync(
      `ffmpeg -f concat -safe 0 -i "${concatList}" -c copy "${outPath}" -y`,
      { timeout: 300_000 }
    );
  } finally {
    // 无论成功失败都清理临时文件
    safeUnlink(concatList);
    for (const p of segPaths) safeUnlink(p);
  }
}

/**
 * 缩放视频分辨率，保持原始宽高比，不足部分补黑边。
 * resolution 格式："1920:1080" | "1280:720" | "640:360"
 */
export async function resizeVideo(
  inputPath: string,
  outPath: string,
  resolution: string
): Promise<void> {
  if (!/^\d+:\d+$/.test(resolution)) {
    throw new Error(`无效的分辨率格式：${resolution}，应为 "宽:高"，如 "1920:1080"`);
  }
  await execAsync(
    `ffmpeg -i "${inputPath}" -vf "scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2,setsar=1" -c:v libx264 -preset medium -crf 23 -c:a aac "${outPath}" -y`,
    { timeout: 300_000 }
  );
}

/**
 * 在视频上叠加文字水印。
 * position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center"
 */
export async function addWatermark(
  inputPath: string,
  outPath: string,
  text: string,
  position: string
): Promise<void> {
  const posMap: Record<string, string> = {
    "top-left":     "x=10:y=10",
    "top-right":    "x=W-tw-10:y=10",
    "bottom-left":  "x=10:y=H-th-10",
    "bottom-right": "x=W-tw-10:y=H-th-10",
    center:         "x=(W-tw)/2:y=(H-th)/2",
  };

  const overlay = posMap[position] ?? posMap["bottom-right"];
  // 转义 FFmpeg drawtext 中的特殊字符
  const escapedText = text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");

  await execAsync(
    `ffmpeg -i "${inputPath}" -vf "drawtext=text='${escapedText}':fontsize=24:fontcolor=white@0.8:${overlay}:box=1:boxcolor=black@0.4:boxborderw=6" -c:v libx264 -preset medium -crf 23 -c:a aac "${outPath}" -y`,
    { timeout: 300_000 }
  );
}

/**
 * 调整视频播放速度。
 *
 * FFmpeg atempo 滤镜只支持 0.5-2.0，超出范围需要串联多个 atempo。
 * 本函数自动处理极值，支持 0.1x - 10x 的速度范围。
 */
export async function changeSpeed(
  inputPath: string,
  outPath: string,
  speed: number
): Promise<void> {
  const safeSpeed = Math.min(Math.max(speed, 0.1), 10);
  const setPts = `setpts=${(1 / safeSpeed).toFixed(4)}*PTS`;

  // atempo 串联：将速度拆解为多个 0.5-2.0 之间的因子
  const atempoFilters = buildAtempoChain(safeSpeed);

  await execAsync(
    `ffmpeg -i "${inputPath}" -filter_complex "[0:v]${setPts}[v];[0:a]${atempoFilters}[a]" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 23 -c:a aac "${outPath}" -y`,
    { timeout: 300_000 }
  );
}

/**
 * 将任意速度分解为若干个在 [0.5, 2.0] 范围内的 atempo 因子并串联。
 * 例：speed=4.0 → atempo=2.0,atempo=2.0
 *     speed=0.25 → atempo=0.5,atempo=0.5
 */
function buildAtempoChain(speed: number): string {
  const factors: number[] = [];
  let remaining = speed;

  if (speed > 1) {
    while (remaining > 2.0) {
      factors.push(2.0);
      remaining /= 2.0;
    }
    factors.push(remaining);
  } else {
    while (remaining < 0.5) {
      factors.push(0.5);
      remaining /= 0.5;
    }
    factors.push(remaining);
  }

  const chain = factors.map((f) => `atempo=${f.toFixed(4)}`).join(",");
  return chain;
}

export async function reverseVideo(
  inputPath: string,
  outPath: string
): Promise<void> {
  await execAsync(
    `ffmpeg -i "${inputPath}" -vf reverse -af areverse -c:v libx264 -preset medium -crf 23 -c:a aac "${outPath}" -y`,
    { timeout: 300_000 }
  );
}

/**
 * 拼接多个视频片段。
 *
 * 优化：优先使用 `-c copy` 流拷贝（无损、极快）；
 * 仅当输入来源不同或流拷贝失败时才回退到重编码。
 */
export async function concatVideos(
  inputPaths: string[],
  outPath: string
): Promise<void> {
  if (inputPaths.length === 0) throw new Error("inputPaths 不能为空");
  if (inputPaths.length === 1) {
    await execAsync(`ffmpeg -i "${inputPaths[0]}" -c copy "${outPath}" -y`, { timeout: 60_000 });
    return;
  }

  const concatList = tempPath("concat_list", "txt");
  try {
    for (const p of inputPaths) {
      fs.appendFileSync(concatList, `file '${p.replace(/\\/g, "/")}'\n`);
    }

    try {
      // 优先流拷贝（快速无损）
      await execAsync(
        `ffmpeg -f concat -safe 0 -i "${concatList}" -c copy "${outPath}" -y`,
        { timeout: 300_000 }
      );
    } catch {
      // 流拷贝失败（如编解码不一致）→ 回退重编码
      console.warn("[EditingService] concatVideos 流拷贝失败，回退到重编码");
      await execAsync(
        `ffmpeg -f concat -safe 0 -i "${concatList}" -c:v libx264 -preset medium -crf 23 -c:a aac "${outPath}" -y`,
        { timeout: 600_000 }
      );
    }
  } finally {
    safeUnlink(concatList);
  }
}

export async function adjustVolume(
  inputPath: string,
  outPath: string,
  volume: number
): Promise<void> {
  const safeVol = Math.max(0, volume);
  await execAsync(
    `ffmpeg -i "${inputPath}" -filter:a "volume=${safeVol}" -c:v copy "${outPath}" -y`,
    { timeout: 300_000 }
  );
}

// ====== 转场（xfade）支持 ======

export type TransitionType =
  | "cut"
  | "fade"
  | "fadeblack"
  | "fadewhite"
  | "dissolve"
  | "slideleft"
  | "slideright"
  | "slideup"
  | "slidedown"
  | "wipeleft"
  | "wiperight"
  | "circleopen"
  | "circleclose"
  | "zoomin";

export interface SegmentTransition {
  type: TransitionType;
  duration?: number;
}

export async function getVideoDurationSec(filePath: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
    { timeout: 15_000 }
  );
  return parseFloat(stdout.trim()) || 0;
}

/**
 * 使用 xfade 转场拼接多段视频。
 * - transitions[i] 表示 inputPaths[i] → inputPaths[i+1] 之间的转场，长度必须是 inputs.length-1
 * - 全部为 "cut" 时回退到 concatVideos（demuxer 拼接，速度更快）
 * - 输出不带音频（-an），调用方负责后续混入 TTS / 原声
 * - 自动归一化分辨率、SAR、帧率，避免不同源素材的 xfade 报错
 */
export async function concatVideosWithTransitions(
  inputPaths: string[],
  outPath: string,
  transitions: SegmentTransition[],
  options: { width?: number; height?: number; fps?: number } = {}
): Promise<void> {
  ensureOutputDir();
  if (inputPaths.length === 0) throw new Error("没有视频片段");
  if (inputPaths.length === 1) {
    await execAsync(`ffmpeg -i "${inputPaths[0]}" -c copy "${outPath}" -y`, { timeout: 60_000 });
    return;
  }

  const allCut =
    transitions.length === 0 || transitions.every((t) => !t || t.type === "cut");
  if (allCut) {
    await concatVideos(inputPaths, outPath);
    return;
  }

  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const fps = options.fps ?? 30;

  const durations: number[] = [];
  for (const p of inputPaths) durations.push(await getVideoDurationSec(p));

  const inputArgs = inputPaths.map((p) => `-i "${p}"`).join(" ");
  const filters: string[] = [];

  for (let i = 0; i < inputPaths.length; i++) {
    filters.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`
    );
  }

  let prev = "v0";
  let runningDuration = durations[0];

  for (let i = 1; i < inputPaths.length; i++) {
    const t = transitions[i - 1] ?? { type: "fade" as TransitionType };
    const transType: TransitionType = t.type === "cut" ? "fade" : t.type;
    const requested = t.duration ?? 0.4;
    const maxAllowed = Math.max(0.1, Math.min(durations[i - 1] / 2, durations[i] / 2, 1.5));
    const transDur = Math.min(Math.max(0.15, requested), maxAllowed);
    const offset = Math.max(0, runningDuration - transDur);
    const outLabel = i === inputPaths.length - 1 ? "vout" : `vt${i}`;

    filters.push(
      `[${prev}][v${i}]xfade=transition=${transType}:duration=${transDur.toFixed(3)}:offset=${offset.toFixed(3)}[${outLabel}]`
    );
    prev = outLabel;
    runningDuration = runningDuration + durations[i] - transDur;
  }

  const filterStr = filters.join(";");
  await execAsync(
    `ffmpeg ${inputArgs} -filter_complex "${filterStr}" -map "[vout]" -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -an "${outPath}" -y`,
    { timeout: 600_000 }
  );
}

// ====== 任务处理器 ======

interface EditingParams {
  operation: "trim" | "slice" | "resize" | "watermark" | "speed";
  trim?: { startTime: string; endTime: string };
  slices?: { start: string; end: string }[];
  resolution?: string;
  watermark?: { text: string; position: string };
  speed?: number;
}

async function runEditing(
  task: ProcessingTask,
  updateProgress: (progress: number) => Promise<void>
): Promise<Record<string, unknown>> {
  await updateProgress(5);

  const params = (task.parameters || {}) as EditingParams;
  const out = outputPath(task.id, params.operation || "output");
  const videoPath = await getVideoPath(task.videoId);

  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error("视频文件不存在");
  }

  await updateProgress(10);

  switch (params.operation) {
    case "trim":
      if (!params.trim) throw new Error("缺少裁剪参数");
      await trimVideo(videoPath, out, params.trim.startTime, params.trim.endTime);
      break;

    case "slice":
      if (!params.slices || params.slices.length === 0) throw new Error("缺少切片参数");
      await sliceAndMerge(videoPath, out, params.slices);
      break;

    case "resize":
      if (!params.resolution) throw new Error("缺少分辨率参数");
      await resizeVideo(videoPath, out, params.resolution);
      break;

    case "watermark":
      if (!params.watermark) throw new Error("缺少水印参数");
      await addWatermark(videoPath, out, params.watermark.text, params.watermark.position);
      break;

    case "speed":
      if (params.speed === undefined || params.speed === null) throw new Error("缺少速度参数");
      await changeSpeed(videoPath, out, params.speed);
      break;

    default:
      throw new Error(`不支持的操作类型: ${(params as any).operation}`);
  }

  await updateProgress(90);

  const stats = fs.statSync(out);

  await updateProgress(100);

  return {
    outputPath: out,
    fileSize: stats.size,
    operation: params.operation,
    message: `${params.operation} 处理完成`,
  };
}

registerTaskHandler("editing", runEditing);

export { runEditing, type EditingParams };