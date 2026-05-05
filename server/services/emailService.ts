import { getDb } from "../db";
import { emailVerificationCodes } from "../../drizzle/schema";
import { eq, and, lt } from "drizzle-orm";

/**
 * 生成随机验证码
 */
export function generateVerificationCode(): string {
  return Math.random().toString().slice(2, 8);
}

/**
 * 发送邮件（模拟实现，实际应集成真实邮件服务）
 */
export async function sendVerificationEmail(
  email: string,
  code: string,
  type: "register" | "login" | "reset"
): Promise<boolean> {
  try {
    // TODO: 集成真实邮件服务（如 SendGrid、Mailgun 等）
    // 这里仅作示例，实际应该调用邮件 API
    console.log(`[Email] Sending ${type} verification code to ${email}: ${code}`);
    
    // 模拟邮件发送成功
    return true;
  } catch (error) {
    console.error("[Email] Failed to send verification email:", error);
    return false;
  }
}

/**
 * 创建邮箱验证码
 */
export async function createVerificationCode(
  email: string,
  type: "register" | "login" | "reset",
  expiresInMinutes: number = 10
): Promise<string | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[EmailService] Database not available");
    return null;
  }

  try {
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    await db.insert(emailVerificationCodes).values({
      email,
      code,
      type,
      expiresAt,
    });

    return code;
  } catch (error) {
    console.error("[EmailService] Failed to create verification code:", error);
    return null;
  }
}

/**
 * 验证邮箱验证码
 */
export async function verifyEmailCode(
  email: string,
  code: string,
  type: "register" | "login" | "reset"
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn("[EmailService] Database not available");
    return false;
  }

  try {
    const record = await db
      .select()
      .from(emailVerificationCodes)
      .where(
        and(
          eq(emailVerificationCodes.email, email),
          eq(emailVerificationCodes.code, code),
          eq(emailVerificationCodes.type, type),
          eq(emailVerificationCodes.usedAt, null as any)
        )
      )
      .limit(1);

    if (record.length === 0) {
      return false;
    }

    const verificationRecord = record[0];
    
    // 检查是否过期
    if (verificationRecord.expiresAt < new Date()) {
      return false;
    }

    // 标记为已使用
    await db
      .update(emailVerificationCodes)
      .set({ usedAt: new Date() })
      .where(eq(emailVerificationCodes.id, verificationRecord.id));

    return true;
  } catch (error) {
    console.error("[EmailService] Failed to verify email code:", error);
    return false;
  }
}

/**
 * 清理过期的验证码
 */
export async function cleanupExpiredCodes(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[EmailService] Database not available");
    return;
  }

  try {
    await db
      .delete(emailVerificationCodes)
      .where(lt(emailVerificationCodes.expiresAt, new Date()));
  } catch (error) {
    console.error("[EmailService] Failed to cleanup expired codes:", error);
  }
}
