import { getDb } from "../db";
import { users, userCredits, processingTasks, creditTransactions } from "../../drizzle/schema";
import { eq, desc, count, sum, sql } from "drizzle-orm";

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

// 总览统计：用户数、任务数、积分消耗
export async function getOverviewStats() {
  const db = await getDb();
  if (!db) return null;

  const [totalUsers] = await db.select({ count: count() }).from(users);
  const [activeUsers] = await db
    .select({ count: count() })
    .from(users)
    .where(eq(users.isActive, true));
  const [totalTasks] = await db.select({ count: count() }).from(processingTasks);
  const [completedTasks] = await db
    .select({ count: count() })
    .from(processingTasks)
    .where(eq(processingTasks.status, "completed"));
  const [creditStats] = await db
    .select({
      totalConsumed: sql<number>`COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)`,
      totalRecharged: sql<number>`COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)`,
    })
    .from(creditTransactions);

  return {
    totalUsers: totalUsers.count,
    activeUsers: activeUsers.count,
    totalTasks: totalTasks.count,
    completedTasks: completedTasks.count,
    totalConsumed: Number(creditStats.totalConsumed),
    totalRecharged: Number(creditStats.totalRecharged),
  };
}

// 近 30 天每日新增用户数
export async function getDailyUserRegistrations() {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      date: sql<string>`DATE(createdAt)`,
      count: count(),
    })
    .from(users)
    .where(sql`createdAt >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)`)
    .groupBy(sql`DATE(createdAt)`)
    .orderBy(sql`DATE(createdAt)`);

  return rows.map(r => ({ date: r.date, count: r.count }));
}

// 近 30 天每日积分消耗趋势
export async function getDailyCreditConsumption() {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      date: sql<string>`DATE(createdAt)`,
      consumed: sql<number>`COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)`,
      recharged: sql<number>`COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)`,
    })
    .from(creditTransactions)
    .where(sql`createdAt >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)`)
    .groupBy(sql`DATE(createdAt)`)
    .orderBy(sql`DATE(createdAt)`);

  return rows.map(r => ({
    date: r.date,
    consumed: Number(r.consumed),
    recharged: Number(r.recharged),
  }));
}

// 近 30 天每日任务数（按类型）
export async function getDailyTaskCounts() {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      date: sql<string>`DATE(queuedAt)`,
      taskType: processingTasks.taskType,
      count: count(),
    })
    .from(processingTasks)
    .where(sql`queuedAt >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)`)
    .groupBy(sql`DATE(queuedAt)`, processingTasks.taskType)
    .orderBy(sql`DATE(queuedAt)`);

  return rows.map(r => ({ date: r.date, taskType: r.taskType, count: r.count }));
}

// 各任务类型平均处理时长（秒，仅 completed 且有 startedAt/completedAt）
export async function getAvgProcessingDuration() {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      taskType: processingTasks.taskType,
      avgSeconds: sql<number>`ROUND(AVG(TIMESTAMPDIFF(SECOND, startedAt, completedAt)), 1)`,
      taskCount: count(),
    })
    .from(processingTasks)
    .where(
      sql`status = 'completed' AND startedAt IS NOT NULL AND completedAt IS NOT NULL`
    )
    .groupBy(processingTasks.taskType);

  return rows.map(r => ({
    taskType: r.taskType,
    avgSeconds: Number(r.avgSeconds),
    taskCount: r.taskCount,
  }));
}
