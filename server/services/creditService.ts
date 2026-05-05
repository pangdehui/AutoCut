import { getDb } from "../db";
import { userCredits, creditTransactions, creditRates } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * 获取用户积分余额
 */
export async function getUserCredits(userId: number) {
  const db = await getDb();
  if (!db) {
    return null;
  }

  try {
    const result = await db
      .select()
      .from(userCredits)
      .where(eq(userCredits.userId, userId))
      .limit(1);

    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[CreditService] Get user credits failed:", error);
    return null;
  }
}

/**
 * 获取积分费率
 */
export async function getCreditRate(type: "analysis" | "editing" | "subtitle") {
  const db = await getDb();
  if (!db) {
    return null;
  }

  try {
    const result = await db
      .select()
      .from(creditRates)
      .where(eq(creditRates.type, type))
      .limit(1);

    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[CreditService] Get credit rate failed:", error);
    return null;
  }
}

/**
 * 计算所需积分
 */
export async function calculateRequiredCredits(
  type: "analysis" | "editing" | "subtitle",
  durationInSeconds: number
): Promise<number | null> {
  const rate = await getCreditRate(type);
  if (!rate) {
    return null;
  }

  const durationInMinutes = durationInSeconds / 60;
  const creditsPerMinute = parseFloat(rate.creditsPerMinute.toString());
  return Math.ceil(durationInMinutes * creditsPerMinute);
}

/**
 * 扣除用户积分
 */
export async function deductCredits(
  userId: number,
  amount: number,
  type: "analysis" | "editing" | "subtitle",
  taskId?: number,
  description?: string
): Promise<{ success: boolean; message: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, message: "数据库连接失败" };
  }

  try {
    // 获取用户当前积分
    const userCredit = await getUserCredits(userId);
    if (!userCredit) {
      return { success: false, message: "用户积分账户不存在" };
    }

    // 检查积分是否足够
    if (userCredit.balance < amount) {
      return { success: false, message: "积分不足" };
    }

    // 扣除积分
    const newBalance = userCredit.balance - amount;
    await db
      .update(userCredits)
      .set({
        balance: newBalance,
        totalUsed: userCredit.totalUsed + amount,
      })
      .where(eq(userCredits.userId, userId));

    // 记录交易
    await db.insert(creditTransactions).values({
      userId,
      amount: -amount,
      type,
      taskId,
      description: description || `${type} 消耗`,
    });

    return { success: true, message: "积分扣除成功" };
  } catch (error) {
    console.error("[CreditService] Deduct credits failed:", error);
    return { success: false, message: "扣除积分失败" };
  }
}

/**
 * 充值用户积分（后台管理）
 */
export async function rechargeCredits(
  userId: number,
  amount: number,
  description?: string
): Promise<{ success: boolean; message: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, message: "数据库连接失败" };
  }

  try {
    const userCredit = await getUserCredits(userId);
    if (!userCredit) {
      return { success: false, message: "用户积分账户不存在" };
    }

    // 充值积分
    const newBalance = userCredit.balance + amount;
    await db
      .update(userCredits)
      .set({
        balance: newBalance,
        totalEarned: userCredit.totalEarned + amount,
      })
      .where(eq(userCredits.userId, userId));

    // 记录交易
    await db.insert(creditTransactions).values({
      userId,
      amount,
      type: "admin_recharge",
      description: description || "管理员充值",
    });

    return { success: true, message: "充值成功" };
  } catch (error) {
    console.error("[CreditService] Recharge credits failed:", error);
    return { success: false, message: "充值失败" };
  }
}

/**
 * 扣除用户积分（后台管理）
 */
export async function deductCreditsAdmin(
  userId: number,
  amount: number,
  description?: string
): Promise<{ success: boolean; message: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, message: "数据库连接失败" };
  }

  try {
    const userCredit = await getUserCredits(userId);
    if (!userCredit) {
      return { success: false, message: "用户积分账户不存在" };
    }

    // 检查积分是否足够
    if (userCredit.balance < amount) {
      return { success: false, message: "用户积分不足" };
    }

    // 扣除积分
    const newBalance = userCredit.balance - amount;
    await db
      .update(userCredits)
      .set({
        balance: newBalance,
        totalUsed: userCredit.totalUsed + amount,
      })
      .where(eq(userCredits.userId, userId));

    // 记录交易
    await db.insert(creditTransactions).values({
      userId,
      amount: -amount,
      type: "admin_deduction",
      description: description || "管理员扣除",
    });

    return { success: true, message: "扣除成功" };
  } catch (error) {
    console.error("[CreditService] Admin deduct credits failed:", error);
    return { success: false, message: "扣除失败" };
  }
}

/**
 * 初始化积分费率（首次运行）
 */
export async function initializeCreditRates(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[CreditService] Database not available");
    return;
  }

  try {
    // 检查是否已初始化
    const existing = await db.select().from(creditRates).limit(1);
    if (existing.length > 0) {
      return;
    }

    // 初始化默认费率（每分钟消耗积分数）
    await db.insert(creditRates).values([
      {
        type: "analysis" as const,
        creditsPerMinute: "10",
        description: "AI 视频内容分析",
      },
      {
        type: "editing" as const,
        creditsPerMinute: "15",
        description: "FFmpeg 视频剪辑",
      },
      {
        type: "subtitle" as const,
        creditsPerMinute: "8",
        description: "多语言字幕生成",
      },
    ]);

    console.log("[CreditService] Credit rates initialized");
  } catch (error) {
    console.error("[CreditService] Initialize credit rates failed:", error);
  }
}
