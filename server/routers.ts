import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { sendRegisterCode, registerWithEmail, sendLoginCode, loginWithCode } from "./services/authService";
import { getUserCredits, initializeCreditRates, rechargeCredits, deductCreditsAdmin } from "./services/creditService";
import { getUserVideos, getVideoById } from "./services/videoService";

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
      .mutation(async ({ input }) => {
        return await registerWithEmail(input.email, input.code, input.password, input.name);
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
      .mutation(async ({ input }) => {
        return await loginWithCode(input.email, input.code);
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

  videos: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const videos = await getUserVideos(ctx.user.id);
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
  }),
});

export type AppRouter = typeof appRouter;
