import { getDb } from "../db";
import { videos, processingTasks, videoAnalysis } from "../../drizzle/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import type { Video } from "../../drizzle/schema";
import fs from "node:fs";
import path from "node:path";

const UPLOAD_DIR = path.resolve("uploads");
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const ALLOWED_MIME_TYPES = [
  "video/mp4",
  "video/x-matroska",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/avi",
];
const ALLOWED_EXTENSIONS = [".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".flv"];

export async function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export function validateVideoFile(
  originalName: string,
  mimeType: string,
  fileSize: number
): { valid: boolean; error?: string } {
  const ext = path.extname(originalName).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `不支持的文件格式 "${ext}"，仅支持 ${ALLOWED_EXTENSIONS.join(", ")}`,
    };
  }

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `不支持的 MIME 类型 "${mimeType}"`,
    };
  }

  if (fileSize > MAX_FILE_SIZE) {
    const maxGB = MAX_FILE_SIZE / (1024 * 1024 * 1024);
    return {
      valid: false,
      error: `文件大小超过限制（最大 ${maxGB}GB）`,
    };
  }

  return { valid: true };
}

export async function saveVideo(
  userId: number,
  originalName: string,
  mimeType: string,
  fileSize: number,
  tempPath: string
): Promise<Video> {
  const db = await getDb();
  if (!db) throw new Error("数据库连接失败");

  await ensureUploadDir();

  const timestamp = Date.now();
  const safeName = `${timestamp}_${originalName}`;
  const filePath = path.join(UPLOAD_DIR, safeName);

  fs.copyFileSync(tempPath, filePath);

  const [video] = await db
    .insert(videos)
    .values({
      userId,
      originalName,
      fileName: safeName,
      filePath,
      fileSize,
      mimeType,
    })
    .$returningId();

  const created = await db
    .select()
    .from(videos)
    .where(eq(videos.id, video.id))
    .limit(1);

  return created[0];
}

export async function getUserVideos(userId: number): Promise<Video[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(videos)
    .where(eq(videos.userId, userId))
    .orderBy(desc(videos.uploadedAt));
}

export async function getVideoById(id: number, userId: number): Promise<Video | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(videos)
    .where(eq(videos.id, id))
    .limit(1);

  if (result.length === 0) return null;

  const video = result[0];
  if (video.userId !== userId) return null;

  return video;
}

export interface VideoWithStatus extends Video {
  analysisStatus: "none" | "queued" | "processing" | "completed" | "failed";
  analysisTaskId: number | null;
  analysisSummary: string | null;
  analysisCategory: string | null;
  analysisKeywords: string[] | null;
}

export async function getUserVideosWithStatus(userId: number): Promise<VideoWithStatus[]> {
  const db = await getDb();
  if (!db) return [];

  const videoList = await db
    .select()
    .from(videos)
    .where(eq(videos.userId, userId))
    .orderBy(desc(videos.uploadedAt));

  if (videoList.length === 0) return [];

  const videoIds = videoList.map((v) => v.id);

  // 查询每个视频最新的 analysis 任务
  const tasks = await db
    .select()
    .from(processingTasks)
    .where(
      and(
        inArray(processingTasks.videoId, videoIds),
        eq(processingTasks.taskType, "analysis")
      )
    );

  // 按视频分组，取最新任务
  const latestTaskByVideo = new Map<number, { status: string; id: number }>();
  const completedTaskIds: number[] = [];
  for (const t of tasks) {
    const existing = latestTaskByVideo.get(t.videoId);
    if (!existing || t.createdAt > (existing as any)._createdAt) {
      latestTaskByVideo.set(t.videoId, {
        status: t.status,
        id: t.id,
        _createdAt: t.createdAt,
      } as any);
      if (t.status === "completed") {
        completedTaskIds.push(t.id);
      }
    }
  }

  // 查询已完成任务的分析结果摘要
  const analysisMap = new Map<number, { summary: string; category: string; keywords: string[] }>();
  if (completedTaskIds.length > 0) {
    const analyses = await db
      .select()
      .from(videoAnalysis)
      .where(inArray(videoAnalysis.taskId, completedTaskIds));

    for (const a of analyses) {
      const metadata = (a.metadata || {}) as Record<string, any>;
      const keywords = (a.keywords || []) as string[];
      analysisMap.set(a.taskId, {
        summary: metadata.summary || "",
        category: metadata.category || "",
        keywords,
      });
    }
  }

  return videoList.map((v) => {
    const task = latestTaskByVideo.get(v.id);
    const analysis = task ? analysisMap.get(task.id) : null;
    return {
      ...v,
      analysisStatus: (task?.status as any) || "none",
      analysisTaskId: task?.id ?? null,
      analysisSummary: analysis?.summary || null,
      analysisCategory: analysis?.category || null,
      analysisKeywords: analysis?.keywords || null,
    };
  });
}

export async function deleteVideo(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const video = await getVideoById(id, userId);
  if (!video) return false;

  // 删除文件
  if (fs.existsSync(video.filePath)) {
    fs.unlinkSync(video.filePath);
  }

  // 删除数据库记录
  await db
    .delete(videos)
    .where(eq(videos.id, id));

  return true;
}
