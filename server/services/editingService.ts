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

async function getVideoPath(videoId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select({ filePath: videos.filePath, fileName: videos.fileName })
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

export async function trimVideo(
  inputPath: string,
  outputPath: string,
  startTime: string,
  endTime: string
): Promise<void> {
  const duration = durationBetween(startTime, endTime);
  await execAsync(
    `ffmpeg -ss ${startTime} -i "${inputPath}" -to ${duration} -c copy -avoid_negative_ts make_zero "${outputPath}" -y`,
    { timeout: 120000 } // 2分钟超时
  );
}

export async function sliceAndMerge(
  inputPath: string,
  outputPath: string,
  segments: { start: string; end: string }[]
): Promise<void> {
  const concatList = path.resolve(OUTPUT_DIR, `concat_${Date.now()}.txt`);

  for (let i = 0; i < segments.length; i++) {
    const segPath = path.resolve(OUTPUT_DIR, `seg_${Date.now()}_${i}.mp4`);
    const dur = durationBetween(segments[i].start, segments[i].end);
    await execAsync(
      `ffmpeg -ss ${segments[i].start} -i "${inputPath}" -to ${dur} -c copy -avoid_negative_ts make_zero "${segPath}" -y`
    );
    fs.appendFileSync(concatList, `file '${segPath.replace(/\\/g, "/")}'\n`);
  }

  await execAsync(
    `ffmpeg -f concat -safe 0 -i "${concatList}" -c copy "${outputPath}" -y`
  );

  // 清理
  for (let i = 0; i < segments.length; i++) {
    const segPath = path.resolve(OUTPUT_DIR, `seg_${Date.now()}_${i}.mp4`);
    if (fs.existsSync(segPath)) fs.unlinkSync(segPath);
  }
  if (fs.existsSync(concatList)) fs.unlinkSync(concatList);
}

export async function resizeVideo(
  inputPath: string,
  outputPath: string,
  resolution: string
): Promise<void> {
  // resolution: "1920:1080", "1280:720", "640:360" 等
  await execAsync(
    `ffmpeg -i "${inputPath}" -vf "scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -preset medium -crf 23 -c:a aac "${outputPath}" -y`
  );
}

export async function addWatermark(
  inputPath: string,
  outputPath: string,
  text: string,
  position: string
): Promise<void> {
  // position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center"
  const posMap: Record<string, string> = {
    "top-left": "x=10:y=10",
    "top-right": "x=W-tw-10:y=10",
    "bottom-left": "x=10:y=H-th-10",
    "bottom-right": "x=W-tw-10:y=H-th-10",
    center: "x=(W-tw)/2:y=(H-th)/2",
  };

  const overlay = posMap[position] || posMap["bottom-right"];
  const escapedText = text.replace(/[:'"]/g, "\\$&");

  await execAsync(
    `ffmpeg -i "${inputPath}" -vf "drawtext=text='${escapedText}':fontsize=24:fontcolor=white@0.7:${overlay}:box=1:boxcolor=black@0.3:boxborderw=5" -c:v libx264 -preset medium -crf 23 -c:a aac "${outputPath}" -y`
  );
}

export async function changeSpeed(
  inputPath: string,
  outputPath: string,
  speed: number
): Promise<void> {
  // speed: 0.5 (half), 2.0 (double)
  const setPts = speed < 1 ? `setpts=${(1 / speed).toFixed(1)}*PTS` : `setpts=${(1 / speed).toFixed(2)}*PTS`;
  const atempo = `atempo=${speed}`;

  await execAsync(
    `ffmpeg -i "${inputPath}" -filter_complex "[0:v]${setPts}[v];[0:a]${atempo}[a]" -map "[v]" -map "[a]" "${outputPath}" -y`
  );
}

export async function reverseVideo(
  inputPath: string,
  outputPath: string
): Promise<void> {
  await execAsync(
    `ffmpeg -i "${inputPath}" -vf reverse -af areverse -c:v libx264 -preset medium -crf 23 -c:a aac "${outputPath}" -y`
  );
}

export async function concatVideos(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  const concatList = path.resolve(OUTPUT_DIR, `concat_${Date.now()}.txt`);
  for (const p of inputPaths) {
    fs.appendFileSync(concatList, `file '${p.replace(/\\/g, "/")}'\n`);
  }
  await execAsync(
    `ffmpeg -f concat -safe 0 -i "${concatList}" -c:v libx264 -preset medium -crf 23 -c:a aac "${outputPath}" -y`
  );
  if (fs.existsSync(concatList)) fs.unlinkSync(concatList);
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
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`
  );
  return parseFloat(stdout.trim()) || 0;
}

/**
 * 使用 xfade 转场拼接多段视频。
 * - transitions[i] 表示「inputPaths[i] 与 inputPaths[i+1] 之间」的转场，长度必须是 inputs.length-1
 * - 全部为 "cut" 时回退到 concatVideos（demuxer 拼接，速度更快）
 * - 不携带音频（-an）；调用方负责后续混入 TTS / 原声
 * - 自动归一化分辨率、SAR、帧率，避免不同源素材的 xfade 报错
 */
export async function concatVideosWithTransitions(
  inputPaths: string[],
  outputPath: string,
  transitions: SegmentTransition[],
  options: { width?: number; height?: number; fps?: number } = {}
): Promise<void> {
  ensureOutputDir();
  if (inputPaths.length === 0) throw new Error("没有视频片段");
  if (inputPaths.length === 1) {
    await execAsync(`ffmpeg -i "${inputPaths[0]}" -c copy "${outputPath}" -y`);
    return;
  }

  const allCut = transitions.length === 0
    || transitions.every((t) => !t || t.type === "cut");
  if (allCut) {
    await concatVideos(inputPaths, outputPath);
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
    const t = transitions[i - 1] || { type: "fade" as TransitionType };
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
    `ffmpeg ${inputArgs} -filter_complex "${filterStr}" -map "[vout]" -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -an "${outputPath}" -y`
  );
}

export async function adjustVolume(
  inputPath: string,
  outputPath: string,
  volume: number
): Promise<void> {
  // volume: 0.0 = 静音, 1.0 = 原音量, 2.0 = 两倍
  await execAsync(
    `ffmpeg -i "${inputPath}" -filter:a "volume=${volume}" -c:v copy "${outputPath}" -y`
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
  const output = outputPath(task.id, params.operation || "output");
  const videoPath = await getVideoPath(task.videoId);

  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error("视频文件不存在");
  }

  await updateProgress(10);

  try {
    switch (params.operation) {
      case "trim":
        if (!params.trim) throw new Error("缺少裁剪参数");
        await trimVideo(videoPath, output, params.trim.startTime, params.trim.endTime);
        break;

      case "slice":
        if (!params.slices || params.slices.length === 0) throw new Error("缺少切片参数");
        await sliceAndMerge(videoPath, output, params.slices);
        break;

      case "resize":
        if (!params.resolution) throw new Error("缺少分辨率参数");
        await resizeVideo(videoPath, output, params.resolution);
        break;

      case "watermark":
        if (!params.watermark) throw new Error("缺少水印参数");
        await addWatermark(videoPath, output, params.watermark.text, params.watermark.position);
        break;

      case "speed":
        if (!params.speed) throw new Error("缺少速度参数");
        await changeSpeed(videoPath, output, params.speed);
        break;

      default:
        throw new Error(`不支持的操作类型: ${params.operation}`);
    }

    await updateProgress(90);

    const stats = fs.statSync(output);
    const fileSize = stats.size;

    await updateProgress(100);

    return {
      outputPath: output,
      fileSize,
      operation: params.operation,
      message: `${params.operation} 处理完成`,
    };
  } catch (error) {
    throw new Error(`剪辑失败: ${String(error)}`);
  }
}

// 注册剪辑任务处理器
registerTaskHandler("editing", runEditing);

export { runEditing, type EditingParams };
