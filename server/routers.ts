import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { sendRegisterCode, registerWithEmail, sendLoginCode, loginWithCode } from "./services/authService";
import { getUserCredits, initializeCreditRates, rechargeCredits, deductCreditsAdmin, calculateRequiredCredits, deductCredits } from "./services/creditService";
import { getUserVideos, getUserVideosWithStatus, getVideoById, deleteVideo } from "./services/videoService";
import { createTask, getUserTasks, getTaskById, deleteTask } from "./services/taskService";
import { getAnalysisByTaskId } from "./services/analysisService";
import { getSubtitlesByTaskId } from "./services/subtitleService";
import { listUsers, setUserActive, setUserRole, getCreditTransactions, getTaskStats, listAllTasks, getOverviewStats, getDailyUserRegistrations, getDailyCreditConsumption, getDailyTaskCounts, getAvgProcessingDuration } from "./services/adminService";

// 初始化积分费率
initializeCreditRates().catch(console.error);

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),

    sendRegisterCode: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input }) => {
        return await sendRegisterCode(input.email);
      }),

    register: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          code: z.string(),
          password: z.string().min(6),
          name: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const result = await registerWithEmail(input.email, input.code, input.password, input.name);
        if (result.success && result.userId) {
          const openId = `email_${input.email}`;
          const token = await sdk.signSession({
            openId,
            appId: "local",
            name: input.name || input.email.split("@")[0],
          });
          const cookieOptions = getSessionCookieOptions(ctx.req);
          ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: 365 * 24 * 60 * 60 * 1000 });
        }
        return result;
      }),

    sendLoginCode: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input }) => {
        return await sendLoginCode(input.email);
      }),

    loginWithCode: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          code: z.string(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const result = await loginWithCode(input.email, input.code);
        if (result.success && result.userId) {
          const openId = `email_${input.email}`;
          const token = await sdk.signSession({
            openId,
            appId: "local",
            name: input.email.split("@")[0],
          });
          const cookieOptions = getSessionCookieOptions(ctx.req);
          ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: 365 * 24 * 60 * 60 * 1000 });
        }
        return result;
      }),
  }),

  credits: router({
    getBalance: protectedProcedure.query(async ({ ctx }) => {
      const credits = await getUserCredits(ctx.user.id);
      return {
        success: !!credits,
        data: credits,
      };
    }),

    recharge: protectedProcedure
      .input(
        z.object({
          userId: z.number(),
          amount: z.number().positive(),
          description: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          return { success: false, message: "权限不足" };
        }
        return await rechargeCredits(input.userId, input.amount, input.description);
      }),

    deduct: protectedProcedure
      .input(
        z.object({
          userId: z.number(),
          amount: z.number().positive(),
          description: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          return { success: false, message: "权限不足" };
        }
        return await deductCreditsAdmin(input.userId, input.amount, input.description);
      }),
  }),

  subtitles: router({
    byTaskId: protectedProcedure
      .input(z.object({ taskId: z.number() }))
      .query(async ({ input }) => {
        const result = await getSubtitlesByTaskId(input.taskId);
        return { success: true, data: result };
      }),
  }),

  analysis: router({
    byTaskId: protectedProcedure
      .input(z.object({ taskId: z.number() }))
      .query(async ({ input }) => {
        const result = await getAnalysisByTaskId(input.taskId);
        if (!result) return { success: false, message: "分析结果不存在" };
        return { success: true, data: result };
      }),
  }),

  tasks: router({
    list: protectedProcedure
      .input(z.object({ status: z.string().optional() }))
      .query(async ({ input, ctx }) => {
        const tasks = await getUserTasks(ctx.user.id, input.status);
        return { success: true, data: tasks };
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const task = await getTaskById(input.id, ctx.user.id);
        if (!task) return { success: false, message: "任务不存在" };
        return { success: true, data: task };
      }),

    create: protectedProcedure
      .input(
        z.object({
          videoId: z.number(),
          taskType: z.enum(["analysis", "editing", "subtitle", "combined"]),
          parameters: z.any().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // 检查视频是否存在且属于用户
        const video = await getVideoById(input.videoId, ctx.user.id);
        if (!video) {
          return { success: false, message: "视频不存在" };
        }

        // 计算所需积分（暂时使用固定值，实际应根据视频时长计算）
        const requiredCredits = input.taskType === "analysis" ? 10 : input.taskType === "editing" ? 15 : 8;

        // 检查用户积分
        const userCredits = await getUserCredits(ctx.user.id);
        if (!userCredits || userCredits.balance < requiredCredits) {
          return { success: false, message: "积分不足，请先充值" };
        }

        // 创建任务
        const task = await createTask({
          userId: ctx.user.id,
          videoId: input.videoId,
          taskType: input.taskType,
          parameters: input.parameters,
        });
        if (!task) return { success: false, message: "创建任务失败" };

        // 扣除积分
        const creditType: "analysis" | "editing" | "subtitle" = input.taskType === "combined" ? "analysis" : input.taskType;
        const deductResult = await deductCredits(ctx.user.id, requiredCredits, creditType, task.id);
        if (!deductResult.success) {
          // 如果扣积分失败，删除任务
          await deleteTask(task.id, ctx.user.id);
          return { success: false, message: deductResult.message };
        }

        return { success: true, data: task };
      }),

    remove: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const ok = await deleteTask(input.id, ctx.user.id);
        if (!ok) return { success: false, message: "删除失败（任务不存在或正在处理中）" };
        return { success: true };
      }),
  }),

  videos: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const videos = await getUserVideos(ctx.user.id);
      return {
        success: true,
        data: videos,
      };
    }),

    listWithStatus: protectedProcedure.query(async ({ ctx }) => {
      const videos = await getUserVideosWithStatus(ctx.user.id);
      return {
        success: true,
        data: videos,
      };
    }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const video = await getVideoById(input.id, ctx.user.id);
        if (!video) {
          return { success: false, message: "视频不存在" };
        }
        return { success: true, data: video };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const ok = await deleteVideo(input.id, ctx.user.id);
        if (!ok) return { success: false, message: "删除失败（视频不存在）" };
        return { success: true };
      }),
  }),

  admin: router({
    listUsers: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") return { success: false, message: "权限不足" };
      const data = await listUsers();
      return { success: true, data };
    }),

    setUserActive: protectedProcedure
      .input(z.object({ userId: z.number(), isActive: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") return { success: false, message: "权限不足" };
        return await setUserActive(input.userId, input.isActive);
      }),

    setUserRole: protectedProcedure
      .input(z.object({ userId: z.number(), role: z.enum(["user", "admin"]) }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") return { success: false, message: "权限不足" };
        return await setUserRole(input.userId, input.role);
      }),

    creditTransactions: protectedProcedure
      .input(z.object({ userId: z.number().optional() }))
      .query(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") return { success: false, data: [] };
        const data = await getCreditTransactions(input.userId);
        return { success: true, data };
      }),

    taskStats: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") return { success: false, data: null };
      const data = await getTaskStats();
      return { success: true, data };
    }),

    listAllTasks: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") return { success: false, data: [] };
      const data = await listAllTasks();
      return { success: true, data };
    }),

    overviewStats: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") return { success: false, data: null };
      const data = await getOverviewStats();
      return { success: true, data };
    }),

    dailyUserRegistrations: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") return { success: false, data: [] };
      const data = await getDailyUserRegistrations();
      return { success: true, data };
    }),

    dailyCreditConsumption: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") return { success: false, data: [] };
      const data = await getDailyCreditConsumption();
      return { success: true, data };
    }),

    dailyTaskCounts: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") return { success: false, data: [] };
      const data = await getDailyTaskCounts();
      return { success: true, data };
    }),

    avgProcessingDuration: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") return { success: false, data: [] };
      const data = await getAvgProcessingDuration();
      return { success: true, data };
    }),
  }),
});

export type AppRouter = typeof appRouter;
