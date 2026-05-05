import { getDb } from "../db";
import { users, userCredits } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { createVerificationCode, sendVerificationEmail, verifyEmailCode } from "./emailService";
import * as crypto from "crypto";

/**
 * 哈希密码
 */
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

/**
 * 验证密码
 */
function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

/**
 * 邮箱注册 - 第一步：发送验证码
 */
export async function sendRegisterCode(email: string): Promise<{ success: boolean; message: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, message: "数据库连接失败" };
  }

  try {
    // 检查邮箱是否已注册
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      return { success: false, message: "该邮箱已被注册" };
    }

    // 生成验证码
    const code = await createVerificationCode(email, "register");
    if (!code) {
      return { success: false, message: "验证码生成失败" };
    }

    // 发送邮件
    const sent = await sendVerificationEmail(email, code, "register");
    if (!sent) {
      return { success: false, message: "验证码发送失败" };
    }

    return { success: true, message: "验证码已发送到您的邮箱" };
  } catch (error) {
    console.error("[AuthService] Register code send failed:", error);
    return { success: false, message: "发送失败，请稍后重试" };
  }
}

/**
 * 邮箱注册 - 第二步：验证码验证并创建账户
 */
export async function registerWithEmail(
  email: string,
  code: string,
  password: string,
  name?: string
): Promise<{ success: boolean; message: string; userId?: number }> {
  const db = await getDb();
  if (!db) {
    return { success: false, message: "数据库连接失败" };
  }

  try {
    // 验证验证码
    const isValid = await verifyEmailCode(email, code, "register");
    if (!isValid) {
      return { success: false, message: "验证码无效或已过期" };
    }

    // 再次检查邮箱是否已注册
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      return { success: false, message: "该邮箱已被注册" };
    }

    // 创建用户
    const passwordHash = hashPassword(password);
    const result = await db.insert(users).values({
      openId: `email_${email}_${Date.now()}`,
      email,
      name: name || email.split("@")[0],
      passwordHash,
      emailVerified: true,
      loginMethod: "email",
      role: "user",
      isActive: true,
    });

    const userId = (result as any).insertId;

    // 创建积分账户（初始赠送 1000 积分）
    await db.insert(userCredits).values({
      userId,
      balance: 1000,
      totalEarned: 1000,
      totalUsed: 0,
    });

    return {
      success: true,
      message: "注册成功",
      userId,
    };
  } catch (error) {
    console.error("[AuthService] Register failed:", error);
    return { success: false, message: "注册失败，请稍后重试" };
  }
}

/**
 * 邮箱登录 - 第一步：发送验证码
 */
export async function sendLoginCode(email: string): Promise<{ success: boolean; message: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, message: "数据库连接失败" };
  }

  try {
    // 检查邮箱是否存在
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user.length === 0) {
      return { success: false, message: "该邮箱未注册" };
    }

    // 生成验证码
    const code = await createVerificationCode(email, "login");
    if (!code) {
      return { success: false, message: "验证码生成失败" };
    }

    // 发送邮件
    const sent = await sendVerificationEmail(email, code, "login");
    if (!sent) {
      return { success: false, message: "验证码发送失败" };
    }

    return { success: true, message: "验证码已发送到您的邮箱" };
  } catch (error) {
    console.error("[AuthService] Login code send failed:", error);
    return { success: false, message: "发送失败，请稍后重试" };
  }
}

/**
 * 邮箱登录 - 第二步：验证码验证
 */
export async function loginWithCode(
  email: string,
  code: string
): Promise<{ success: boolean; message: string; userId?: number }> {
  const db = await getDb();
  if (!db) {
    return { success: false, message: "数据库连接失败" };
  }

  try {
    // 验证验证码
    const isValid = await verifyEmailCode(email, code, "login");
    if (!isValid) {
      return { success: false, message: "验证码无效或已过期" };
    }

    // 获取用户
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user.length === 0) {
      return { success: false, message: "用户不存在" };
    }

    const userRecord = user[0];

    // 检查用户是否被禁用
    if (!userRecord.isActive) {
      return { success: false, message: "账户已被禁用" };
    }

    // 更新最后登录时间
    await db
      .update(users)
      .set({ lastSignedIn: new Date() })
      .where(eq(users.id, userRecord.id));

    return {
      success: true,
      message: "登录成功",
      userId: userRecord.id,
    };
  } catch (error) {
    console.error("[AuthService] Login failed:", error);
    return { success: false, message: "登录失败，请稍后重试" };
  }
}

/**
 * 密码登录
 */
export async function loginWithPassword(
  email: string,
  password: string
): Promise<{ success: boolean; message: string; userId?: number }> {
  const db = await getDb();
  if (!db) {
    return { success: false, message: "数据库连接失败" };
  }

  try {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user.length === 0) {
      return { success: false, message: "邮箱或密码错误" };
    }

    const userRecord = user[0];

    // 检查用户是否被禁用
    if (!userRecord.isActive) {
      return { success: false, message: "账户已被禁用" };
    }

    // 验证密码
    if (!userRecord.passwordHash || !verifyPassword(password, userRecord.passwordHash)) {
      return { success: false, message: "邮箱或密码错误" };
    }

    // 更新最后登录时间
    await db
      .update(users)
      .set({ lastSignedIn: new Date() })
      .where(eq(users.id, userRecord.id));

    return {
      success: true,
      message: "登录成功",
      userId: userRecord.id,
    };
  } catch (error) {
    console.error("[AuthService] Password login failed:", error);
    return { success: false, message: "登录失败，请稍后重试" };
  }
}

/**
 * 获取用户信息
 */
export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) {
    return null;
  }

  try {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user.length > 0 ? user[0] : null;
  } catch (error) {
    console.error("[AuthService] Get user failed:", error);
    return null;
  }
}
