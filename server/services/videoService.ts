import { getDb } from "../db";
import { videos } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
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
