import { bigint, decimal, int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: text("name"),
  passwordHash: varchar("passwordHash", { length: 255 }),
  emailVerified: boolean("emailVerified").default(false).notNull(),
  loginMethod: varchar("loginMethod", { length: 64 }).default("email"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn"),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// 邮箱验证码表
export const emailVerificationCodes = mysqlTable("emailVerificationCodes", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  code: varchar("code", { length: 10 }).notNull(),
  type: mysqlEnum("type", ["register", "login", "reset"]).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmailVerificationCode = typeof emailVerificationCodes.$inferSelect;
export type InsertEmailVerificationCode = typeof emailVerificationCodes.$inferInsert;

// 用户积分表
export const userCredits = mysqlTable("userCredits", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  balance: bigint("balance", { mode: "number" }).default(0).notNull(), // 积分余额
  totalEarned: bigint("totalEarned", { mode: "number" }).default(0).notNull(), // 总获得
  totalUsed: bigint("totalUsed", { mode: "number" }).default(0).notNull(), // 总消耗
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserCredit = typeof userCredits.$inferSelect;
export type InsertUserCredit = typeof userCredits.$inferInsert;

// 积分流水表
export const creditTransactions = mysqlTable("creditTransactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(), // 正数为充值，负数为消耗
  type: mysqlEnum("type", ["analysis", "editing", "subtitle", "admin_recharge", "admin_deduction"]).notNull(),
  description: text("description"),
  taskId: int("taskId"), // 关联的任务 ID
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type InsertCreditTransaction = typeof creditTransactions.$inferInsert;

// 视频表
export const videos = mysqlTable("videos", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  originalName: varchar("originalName", { length: 255 }).notNull(), // 原始文件名
  fileName: varchar("fileName", { length: 255 }).notNull(),
  filePath: text("filePath").notNull(), // 本地存储路径
  fileSize: bigint("fileSize", { mode: "number" }).notNull(), // 字节数
  duration: decimal("duration", { precision: 10, scale: 2 }), // 视频时长（秒）
  mimeType: varchar("mimeType", { length: 50 }).notNull(),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Video = typeof videos.$inferSelect;
export type InsertVideo = typeof videos.$inferInsert;

// 处理任务表
export const processingTasks = mysqlTable("processingTasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  videoId: int("videoId").notNull(),
  taskType: mysqlEnum("taskType", ["analysis", "editing", "subtitle", "combined"]).notNull(),
  status: mysqlEnum("status", ["queued", "processing", "completed", "failed"]).default("queued").notNull(),
  progress: int("progress").default(0), // 0-100
  creditsUsed: bigint("creditsUsed", { mode: "number" }).default(0),
  parameters: json("parameters"), // 任务参数（JSON）
  result: json("result"), // 处理结果（JSON）
  errorMessage: text("errorMessage"),
  queuedAt: timestamp("queuedAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProcessingTask = typeof processingTasks.$inferSelect;
export type InsertProcessingTask = typeof processingTasks.$inferInsert;

// 视频分析结果表
export const videoAnalysis = mysqlTable("videoAnalysis", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  videoId: int("videoId").notNull(),
  sceneDescriptions: json("sceneDescriptions"), // 场景描述数组
  keywords: json("keywords"), // 关键词数组
  highlights: json("highlights"), // 精彩片段时间戳数组
  metadata: json("metadata"), // 其他元数据
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VideoAnalysis = typeof videoAnalysis.$inferSelect;
export type InsertVideoAnalysis = typeof videoAnalysis.$inferInsert;

// 字幕表
export const subtitles = mysqlTable("subtitles", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  videoId: int("videoId").notNull(),
  language: varchar("language", { length: 10 }).notNull(), // 语言代码（en, zh, etc.）
  filePath: text("filePath"), // 本地存储路径
  content: text("content"), // SRT 格式内容
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Subtitle = typeof subtitles.$inferSelect;
export type InsertSubtitle = typeof subtitles.$inferInsert;

// 积分费率配置表
export const creditRates = mysqlTable("creditRates", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", ["analysis", "editing", "subtitle"]).notNull().unique(),
  creditsPerMinute: decimal("creditsPerMinute", { precision: 10, scale: 2 }).notNull(), // 每分钟消耗积分
  description: text("description"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CreditRate = typeof creditRates.$inferSelect;
export type InsertCreditRate = typeof creditRates.$inferInsert;