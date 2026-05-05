import { getDb } from "../db";
import { users, userCredits, processingTasks, creditTransactions } from "../../drizzle/schema";
import { eq, desc, count, sql } from "drizzle-orm";

export async function listUsers() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      emailVerified: users.emailVerified,
      loginMethod: users.loginMethod,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
      balance: userCredits.balance,
      totalEarned: userCredits.totalEarned,
      totalUsed: userCredits.totalUsed,
    })
    .from(users)
    .leftJoin(userCredits, eq(users.id, userCredits.userId))
    .orderBy(desc(users.createdAt));
}

export async function setUserActive(userId: number, isActive: boolean) {
  const db = await getDb();
  if (!db) return { success: false, message: "数据库连接失败" };

  await db.update(users).set({ isActive }).where(eq(users.id, userId));
  return { success: true };
}

export async function setUserRole(userId: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) return { success: false, message: "数据库连接失败" };

  await db.update(users).set({ role }).where(eq(users.id, userId));
  return { success: true };
}

export async function getCreditTransactions(userId?: number) {
  const db = await getDb();
  if (!db) return [];

  const query = db
    .select({
      id: creditTransactions.id,
      userId: creditTransactions.userId,
      amount: creditTransactions.amount,
      type: creditTransactions.type,
      description: creditTransactions.description,
      createdAt: creditTransactions.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(creditTransactions)
    .leftJoin(users, eq(creditTransactions.userId, users.id))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(200);

  if (userId) {
    return query.where(eq(creditTransactions.userId, userId));
  }
  return query;
}

export async function getTaskStats() {
  const db = await getDb();
  if (!db) return null;

  const [total] = await db.select({ count: count() }).from(processingTasks);
  const [queued] = await db
    .select({ count: count() })
    .from(processingTasks)
    .where(eq(processingTasks.status, "queued"));
  const [processing] = await db
    .select({ count: count() })
    .from(processingTasks)
    .where(eq(processingTasks.status, "processing"));
  const [completed] = await db
    .select({ count: count() })
    .from(processingTasks)
    .where(eq(processingTasks.status, "completed"));
  const [failed] = await db
    .select({ count: count() })
    .from(processingTasks)
    .where(eq(processingTasks.status, "failed"));

  return {
    total: total.count,
    queued: queued.count,
    processing: processing.count,
    completed: completed.count,
    failed: failed.count,
  };
}

export async function listAllTasks() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      id: processingTasks.id,
      userId: processingTasks.userId,
      videoId: processingTasks.videoId,
      taskType: processingTasks.taskType,
      status: processingTasks.status,
      progress: processingTasks.progress,
      creditsUsed: processingTasks.creditsUsed,
      errorMessage: processingTasks.errorMessage,
      queuedAt: processingTasks.queuedAt,
      startedAt: processingTasks.startedAt,
      completedAt: processingTasks.completedAt,
      userEmail: users.email,
      userName: users.name,
    })
    .from(processingTasks)
    .leftJoin(users, eq(processingTasks.userId, users.id))
    .orderBy(desc(processingTasks.createdAt))
    .limit(200);
}
