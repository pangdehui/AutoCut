import { getDb } from "../db";
import { videos } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { ProcessingTask } from "../../drizzle/schema";
import { registerTaskHandler } from "./taskService";
import { submitGatewayTask, waitForGatewayTask } from "../_core/gateway";
import { ENV } from "../_core/env";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execAsync = promisify(exec);
const AUDIO_DIR = path.resolve("uploads/audio");
const OUTPUT_DIR = path.resolve("uploads/output");

function ensureDirs() {
  for (const d of [AUDIO_DIR, OUTPUT_DIR]) {
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

interface TtsParams {
  text: string;
  voiceId: string;
  speed?: number;
  vol?: number;
  videoId?: number;   // 可选：配到哪个视频上
  mixVolume?: number;  // TTS 音量比例，默认 1.0
  keepOriginal?: boolean; // 是否保留原声（默认 false，完全替换）
}

async function runTts(
  task: ProcessingTask,
  updateProgress: (progress: number) => Promise<void>
): Promise<Record<string, unknown>> {
  await updateProgress(5);

  const params = (task.parameters || {}) as TtsParams;
  if (!params.text) throw new Error("请提供配音文本");
  if (!params.voiceId) throw new Error("请选择音色");

  ensureDirs();

  // 1. 提交网关任务
  await updateProgress(10);
  const forwardResult = await submitGatewayTask("audio_tts", {
    text: params.text,
    voice_id: params.voiceId,
    speed: String(params.speed || 1),
    vol: String(params.vol || 1),
  });

  if (!forwardResult.success) {
    throw new Error("提交 TTS 任务失败");
  }

  const gatewayTaskId = forwardResult.data.taskId;

  // 2. 轮询等待完成
  await updateProgress(20);
  const ttsResult = await waitForGatewayTask(gatewayTaskId);

  await updateProgress(80);

  if (!ttsResult.resultUrl) {
    throw new Error("TTS 未返回音频文件");
  }

  // 3. 下载音频文件（网关可能返回相对路径，需补全）
  let audioUrl = ttsResult.resultUrl;
  if (audioUrl.startsWith("/")) {
    audioUrl = ENV.gatewayBaseUrl.replace(/\/$/, "") + audioUrl;
  }

  const audioExt = path.extname(audioUrl.split("?")[0]) || ".mp3";
  const audioPath = path.join(AUDIO_DIR, `tts_${task.id}${audioExt}`);

  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) throw new Error("下载 TTS 音频失败");
  const audioBuffer = Buffer.from(await audioResp.arrayBuffer());
  fs.writeFileSync(audioPath, audioBuffer);

  await updateProgress(90);

  // 4. 如果有 videoId，混入视频
  let outputVideo: string | null = null;
  if (params.videoId) {
    const videoPath = await getVideoPath(params.videoId);
    if (videoPath && fs.existsSync(videoPath)) {
      outputVideo = path.join(OUTPUT_DIR, `tts_video_${task.id}.mp4`);
      await mixAudioToVideo(videoPath, audioPath, outputVideo, params);
      await updateProgress(95);
    }
  }

  await updateProgress(100);

  return {
    audioPath,
    outputVideo,
    gatewayTaskId,
    text: params.text,
    voiceId: params.voiceId,
    message: params.videoId
      ? `配音完成并已混入视频`
      : `配音完成，音频文件已生成`,
  };
}

async function mixAudioToVideo(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  params: TtsParams
): Promise<void> {
  const ttsVol = params.mixVolume ?? 1.0;

  if (params.keepOriginal) {
    // 叠加：原声 + TTS
    await execAsync(
      `ffmpeg -i "${videoPath}" -i "${audioPath}" -filter_complex "[1:a]volume=${ttsVol}[tts];[0:a][tts]amix=inputs=2:duration=first" -c:v copy -c:a aac "${outputPath}" -y`
    );
  } else {
    // 替换：TTS 完全替代原声
    await execAsync(
      `ffmpeg -i "${videoPath}" -i "${audioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest "${outputPath}" -y`
    );
  }
}

registerTaskHandler("tts", runTts);

export { runTts, type TtsParams };
