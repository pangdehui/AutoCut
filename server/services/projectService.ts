import { getDb } from "../db";
import { projects, videos } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import type { Project } from "../../drizzle/schema";

export async function createProject(
  userId: number,
  name: string,
  description?: string
): Promise<Project | null> {
  const db = await getDb();
  if (!db) return null;

  const [project] = await db
    .insert(projects)
    .values({ userId, name, description: description || null })
    .$returningId();

  const result = await db
    .select()
    .from(projects)
    .where(eq(projects.id, project.id))
    .limit(1);

  return result[0] ?? null;
}

export async function getUserProjects(userId: number): Promise<Project[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));
}

export async function getProjectById(id: number, userId: number): Promise<Project | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);

  return result[0] ?? null;
}

export async function getProjectWithVideoCount(
  id: number,
  userId: number
): Promise<(Project & { videoCount: number }) | null> {
  const project = await getProjectById(id, userId);
  if (!project) return null;

  const db = await getDb();
  if (!db) return null;

  const videoList = await db
    .select()
    .from(videos)
    .where(eq(videos.projectId, id));

  return { ...project, videoCount: videoList.length };
}

export async function deleteProject(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const project = await getProjectById(id, userId);
  if (!project) return false;

  // 解除关联的视频
  await db
    .update(videos)
    .set({ projectId: null })
    .where(eq(videos.projectId, id));

  await db.delete(projects).where(eq(projects.id, id));
  return true;
}
