import { getDb } from "../db";
import { processingTasks, videos } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import type { ProcessingTask } from "../../drizzle/schema";

type TaskType = "analysis" | "editing" | "subtitle" | "combined" | "ai_edit" | "tts";

interface CreateTaskParams {
  userId: number;
  videoId: number;
  taskType: TaskType;
  parameters?: Record<string, unknown>;
}

interface TaskHandler {
  (task: ProcessingTask, updateProgress: (progress: number) => Promise<void>): Promise<Record<string, unknown>>;
}

const handlers = new Map<TaskType, TaskHandler>();
const running = new Set<number>();

let queueInterval: ReturnType<typeof setInterval> | null = null;

export function registerTaskHandler(type: TaskType, handler: TaskHandler) {
  handlers.set(type, handler);
}

export async function createTask(params: CreateTaskParams): Promise<ProcessingTask | null> {
  const db = await getDb();
  if (!db) return null;

  const [task] = await db
    .insert(processingTasks)
    .values({
      userId: params.userId,
      videoId: params.videoId,
      taskType: params.taskType,
      status: "queued",
      progress: 0,
      parameters: params.parameters ?? {},
    })
    .$returningId();

  const created = await db
    .select()
    .from(processingTasks)
    .where(eq(processingTasks.id, task.id))
    .limit(1);

  startQueue();

  return created[0] ?? null;
}

async function processTask(task: ProcessingTask) {
  if (running.has(task.id)) return;
  running.add(task.id);

  const db = await getDb();
  if (!db) return;

  try {
    await db
      .update(processingTasks)
      .set({ status: "processing", startedAt: new Date() })
      .where(eq(processingTasks.id, task.id));

    const updateProgress = async (progress: number) => {
      await db
        .update(processingTasks)
        .set({ progress: Math.min(100, Math.max(0, Math.round(progress))) })
        .where(eq(processingTasks.id, task.id));
    };

    const handler = handlers.get(task.taskType as TaskType);
    let result: Record<string, unknown>;

    if (handler) {
      result = await handler(task, updateProgress);
    } else {
      // 模拟处理：逐步推进进度
      for (let p = 0; p <= 100; p += 10) {
        await new Promise(r => setTimeout(r, 500));
        await updateProgress(p);
      }
      result = { message: `${task.taskType} 处理完成` };
    }

    await db
      .update(processingTasks)
      .set({
        status: "completed",
        progress: 100,
        result,
        completedAt: new Date(),
      })
      .where(eq(processingTasks.id, task.id));
  } catch (error) {
    await db
      .update(processingTasks)
      .set({
        status: "failed",
        errorMessage: String(error),
        completedAt: new Date(),
      })
      .where(eq(processingTasks.id, task.id));
  } finally {
    running.delete(task.id);
  }
}

async function tick() {
  const db = await getDb();
  if (!db) return;

  const queued = await db
    .select()
    .from(processingTasks)
    .where(eq(processingTasks.status, "queued"))
    .orderBy(processingTasks.queuedAt)
    .limit(3);

  for (const task of queued) {
    if (!running.has(task.id)) {
      processTask(task);
    }
  }
}

function startQueue() {
  if (queueInterval) return;
  queueInterval = setInterval(tick, 2000);
  tick();
}

export function stopQueue() {
  if (queueInterval) {
    clearInterval(queueInterval);
    queueInterval = null;
  }
}

export async function getUserTasks(
  userId: number,
  statusFilter?: string
): Promise<ProcessingTask[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(processingTasks.userId, userId)];
  if (statusFilter && statusFilter !== "all") {
    conditions.push(eq(processingTasks.status, statusFilter as any));
  }

  return db
    .select()
    .from(processingTasks)
    .where(and(...conditions))
    .orderBy(desc(processingTasks.createdAt));
}

export async function getTaskById(
  id: number,
  userId: number
): Promise<ProcessingTask | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(processingTasks)
    .where(eq(processingTasks.id, id))
    .limit(1);

  if (result.length === 0) return null;
  const task = result[0];
  if (task.userId !== userId) return null;
  return task;
}

export async function getRunningCount(): Promise<number> {
  return running.size;
}

export async function deleteTask(
  id: number,
  userId: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const task = await getTaskById(id, userId);
  if (!task) return false;
  if (task.status === "processing") return false;

  await db.delete(processingTasks).where(eq(processingTasks.id, id));
  return true;
}
