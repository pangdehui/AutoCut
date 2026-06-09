import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { sendRegisterCode, registerWithEmail, sendLoginCode, loginWithCode } from "./services/authService";
import { getUserCredits, initializeCreditRates, rechargeCredits, deductCreditsAdmin, calculateRequiredCredits, deductCredits } from "./services/creditService";
import { getUserVideos, getUserVideosWithStatus, getVideoById, deleteVideo } from "./services/videoService";
import { createProject, getUserProjects, getProjectById, getProjectWithVideoCount, deleteProject } from "./services/projectService";
import { createTask, getUserTasks, getTaskById, deleteTask, cancelTask } from "./services/taskService";
import { getAnalysisByTaskId, getAnalysisByVideoId } from "./services/analysisService";
import { getSubtitlesByTaskId } from "./services/subtitleService";
import { listBgmFiles } from "./services/bgmService";
import { listUsers, setUserActive, setUserRole, getCreditTransactions, getTaskStats, listAllTasks, getOverviewStats, getDailyUserRegistrations, getDailyCreditConsumption, getDailyTaskCounts, getAvgProcessingDuration, listErrorLogs } from "./services/adminService";

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

  bgm: router({
    list: protectedProcedure.query(() => {
      const files = listBgmFiles();
      return { success: true, data: files };
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
    byVideoId: protectedProcedure
      .input(z.object({ videoId: z.number() }))
      .query(async ({ input }) => {
        const result = await getAnalysisByVideoId(input.videoId);
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
          videoId: z.number().optional(),
          taskType: z.enum(["analysis", "editing", "subtitle", "combined", "ai_edit", "tts", "ai_video_creator"]),
          parameters: z.any().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // ai_video_creator 类型由 AI 自动选择视频，不需要前端传 videoId
        if (input.taskType !== "ai_video_creator") {
          if (!input.videoId) {
            return { success: false, message: "请指定视频" };
          }
          const video = await getVideoById(input.videoId, ctx.user.id);
          if (!video) {
            return { success: false, message: "视频不存在" };
          }
        }

        // 计算所需积分
        const requiredCredits =
          input.taskType === "analysis" ? 10 :
          input.taskType === "editing" || input.taskType === "ai_edit" ? 15 :
          input.taskType === "tts" ? 5 :
          input.taskType === "ai_video_creator" ? 30 : 8;

        // 检查用户积分
        const userCredits = await getUserCredits(ctx.user.id);
        if (!userCredits || userCredits.balance < requiredCredits) {
          return { success: false, message: "积分不足，请先充值" };
        }

        // 创建任务
        const task = await createTask({
          userId: ctx.user.id,
          videoId: input.videoId ?? 0,
          taskType: input.taskType,
          parameters: input.parameters,
        });
        if (!task) return { success: false, message: "创建任务失败" };

        // 扣除积分
        const creditType: "analysis" | "editing" | "subtitle" | "ai_video_creator" =
          input.taskType === "combined" ? "analysis" :
          input.taskType === "ai_edit" ? "editing" :
          input.taskType === "tts" ? "subtitle" :
          input.taskType === "ai_video_creator" ? "ai_video_creator" :
          input.taskType;
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

    cancel: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await cancelTask(input.id, ctx.user.id);
      }),

    // 方案确认模式：用户确认/微调 review 方案后，创建渲染任务继续 Phase 3-5
    approvePlan: protectedProcedure
      .input(
        z.object({
          taskId: z.number(),
          // 用户微调后的方案；不传则使用 review 阶段的原方案
          approvedPlan: z
            .object({
              title: z.string(),
              script: z.string(),
              clips: z.array(
                z.object({
                  videoIndex: z.number(),
                  startTime: z.number(),
                  endTime: z.number(),
                  narration: z.string(),
                  transition: z.string().optional(),
                  transitionDuration: z.number().optional(),
                })
              ),
              muteOriginal: z.boolean(),
            })
            .optional(),
          // 可选覆盖参数（用户在确认界面微调音色/BGM 等）
          overrides: z
            .object({
              voiceId: z.string().optional(),
              speed: z.number().optional(),
              bgmMood: z.string().optional(),
              bgmVolume: z.number().optional(),
              subtitleStyle: z.string().optional(),
            })
            .optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const prev = await getTaskById(input.taskId, ctx.user.id);
        if (!prev || prev.taskType !== "ai_video_creator") {
          return { success: false, message: "方案任务不存在" };
        }
        if (prev.status !== "completed") {
          return { success: false, message: "方案尚未生成完成，请稍候" };
        }
        const review = (prev.result || {}) as Record<string, any>;
        if (review.phase !== "review") {
          return { success: false, message: "该任务不是待确认的方案" };
        }

        const selectedVideoIds: number[] = review.selectedVideoIds || [];
        if (selectedVideoIds.length === 0) {
          return { success: false, message: "方案缺少选中素材信息，无法继续渲染" };
        }

        // 优先用用户微调后的方案，否则用 review 原方案
        const approvedPlan = input.approvedPlan ?? {
          title: review.title,
          script: review.script,
          clips: review.clips,
          muteOriginal: review.muteOriginal,
        };

        // 渲染任务沿用原始方案任务的全部参数（prompt/projectId/音色/画幅等），叠加确认信息
        const prevParams = (prev.parameters || {}) as Record<string, unknown>;
        const renderParams: Record<string, unknown> = {
          ...prevParams,
          ...(input.overrides || {}),
          approvedPlan,
          selectedVideoIds,
          planOnly: false,
        };

        // 不重复扣费：30 积分已在方案生成（tasks.create）时扣除，渲染阶段免费
        const task = await createTask({
          userId: ctx.user.id,
          taskType: "ai_video_creator",
          parameters: renderParams,
        });
        if (!task) return { success: false, message: "创建渲染任务失败" };
        return { success: true, data: task };
      }),

    // 迭代修改：基于上一版成品 + 自然语言指令，diff 式最小修改后重新渲染。半价 15 积分。
    iteratePlan: protectedProcedure
      .input(
        z.object({
          taskId: z.number(), // 上一版已完成的成品任务
          editInstruction: z.string().min(1),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const prev = await getTaskById(input.taskId, ctx.user.id);
        if (!prev || prev.taskType !== "ai_video_creator") {
          return { success: false, message: "原任务不存在" };
        }
        if (prev.status !== "completed") {
          return { success: false, message: "原任务尚未完成，无法修改" };
        }
        const prevResult = (prev.result || {}) as Record<string, any>;
        // 必须是有成品的任务（不是 review 阶段），且带 clips 时间轴
        if (prevResult.phase === "review") {
          return { success: false, message: "请先确认渲染成片后再修改" };
        }
        if (!Array.isArray(prevResult.clips) || prevResult.clips.length === 0) {
          return { success: false, message: "原成品缺少剪辑时间轴，无法迭代（可能是旧版本生成的）" };
        }
        const selectedVideoIds: number[] = prevResult.selectedVideoIds || [];
        if (selectedVideoIds.length === 0) {
          return { success: false, message: "原成品缺少选中素材信息，无法迭代" };
        }

        const ITERATE_COST = 15;
        const userCredits = await getUserCredits(ctx.user.id);
        if (!userCredits || userCredits.balance < ITERATE_COST) {
          return { success: false, message: "积分不足，请先充值" };
        }

        const prevParams = (prev.parameters || {}) as Record<string, unknown>;
        const iterateParams: Record<string, unknown> = {
          ...prevParams,
          // 上一版完整方案作为 diff 基准
          previousPlan: {
            title: prevResult.title,
            script: prevResult.script,
            clips: prevResult.clips,
            muteOriginal: prevResult.muteOriginal ?? false,
            selectedVideoIds,
          },
          editInstruction: input.editInstruction,
          // 清除可能干扰迭代分支判断的字段
          approvedPlan: undefined,
          planOnly: false,
        };

        const task = await createTask({
          userId: ctx.user.id,
          taskType: "ai_video_creator",
          parameters: iterateParams,
        });
        if (!task) return { success: false, message: "创建迭代任务失败" };

        const deductResult = await deductCredits(ctx.user.id, ITERATE_COST, "ai_video_creator", task.id);
        if (!deductResult.success) {
          await deleteTask(task.id, ctx.user.id);
          return { success: false, message: deductResult.message };
        }

        return { success: true, data: task };
      }),
  }),

  projects: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const projects = await getUserProjects(ctx.user.id);
      return { success: true, data: projects };
    }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const project = await getProjectWithVideoCount(input.id, ctx.user.id);
        if (!project) return { success: false, message: "项目不存在" };
        return { success: true, data: project };
      }),

    create: protectedProcedure
      .input(z.object({ name: z.string().min(1), description: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const project = await createProject(ctx.user.id, input.name, input.description);
        if (!project) return { success: false, message: "创建失败" };
        return { success: true, data: project };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const ok = await deleteProject(input.id, ctx.user.id);
        if (!ok) return { success: false, message: "删除失败" };
        return { success: true };
      }),
  }),

  videos: router({
    list: protectedProcedure
      .input(z.object({ projectId: z.number().optional() }).optional())
      .query(async ({ input, ctx }) => {
        const videos = await getUserVideos(ctx.user.id, input?.projectId);
        return {
          success: true,
          data: videos,
        };
      }),

    listWithStatus: protectedProcedure
      .input(z.object({ projectId: z.number().optional() }).optional())
      .query(async ({ input, ctx }) => {
        const videos = await getUserVideosWithStatus(ctx.user.id, input?.projectId);
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

    errorLogs: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(500).optional() }).optional())
      .query(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") return { success: false, data: [] };
        const data = await listErrorLogs(input?.limit ?? 100);
        return { success: true, data };
      }),
  }),
});

export type AppRouter = typeof appRouter;
