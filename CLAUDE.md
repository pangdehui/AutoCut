# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server (Vite HMR + Express with tsx watch on port 3000) |
| `pnpm build` | Production build — Vite builds client to `dist/public`, esbuild bundles server to `dist/` |
| `pnpm start` | Run production server (`NODE_ENV=production node dist/index.js`) |
| `pnpm check` | TypeScript type-check (`tsc --noEmit`) |
| `pnpm format` | Format all files with Prettier |
| `pnpm test` | Run vitest tests (matches `server/**/*.test.ts` and `server/**/*.spec.ts`) |
| `pnpm db:push` | Generate Drizzle migrations, then apply them |

## Architecture

AutoCut is a full-stack TypeScript monorepo: **AI-powered video processing SaaS** with user auth, credit system, and planned video analysis/editing/subtitle features.

### Directory Layout

```
client/src/     # React 19 frontend
  pages/        # Route-level page components (Home, Auth/*, Dashboard/*)
  components/   # Reusable UI — custom components + shadcn/ui in ui/
  hooks/        # Custom React hooks
  contexts/     # React context providers (ThemeContext)
  lib/trpc.ts   # tRPC client — creates typed hooks from AppRouter
  _core/        # Client-side framework internals (hooks)
  App.tsx       # wouter router + global providers
  main.tsx      # Entry — mounts React, sets up tRPC + React Query clients, auto-redirects on 401
server/         # Express + tRPC backend
  _core/        # Framework: Express setup, tRPC init, auth SDK (JWT/OAuth), context, cookies, env
  services/     # Business logic: authService, creditService, emailService
  routers.ts    # All tRPC routes (auth.*, credits.*)
  db.ts         # Drizzle DB connection (lazy) + user query helpers
  storage.ts    # File storage utilities
drizzle/        # Drizzle ORM schema (9 tables) + generated migrations
shared/         # Code shared between client/server: const.ts, types.ts, _core/errors.ts
```

### Request Flow

1. Express receives request → body parsed (50MB limit)
2. `/api/trpc` → tRPC Express middleware calls `createContext()`
3. `createContext` → `sdk.authenticateRequest()` verifies JWT session cookie, syncs user from OAuth server if needed, returns `{ req, res, user }`
4. Route handler executes with typed context
5. Client auto-redirects to login on `UNAUTHORIZED` tRPC errors (see `main.tsx` query/mutation cache subscribers)

### tRPC Procedure Types

- `publicProcedure` — no auth required
- `protectedProcedure` — requires valid session (middleware checks `ctx.user`)
- `adminProcedure` — requires `ctx.user.role === 'admin'`

Import from `server/_core/trpc.ts`. Use `superjson` transformer for type-safe serialization.

### Database

- **Dialect**: MySQL (via `mysql2` + Drizzle ORM)
- **Connection**: lazy — `getDb()` returns null if `DATABASE_URL` is not set, allowing local tooling to run without a DB
- **Migrations**: Located in `drizzle/` directory (Drizzle Kit SQL migrations)
- **Schema**: 9 tables defined in `drizzle/schema.ts` — users, emailVerificationCodes, userCredits, creditTransactions, videos, processingTasks, videoAnalysis, subtitles, creditRates

### Auth System

Dual auth: **email verification codes** (6-digit codes sent via email service, currently mock) and **OAuth** (via external OAuth server). Sessions are JWT stored in HTTP-only cookie (`app_session_id`). The SDK server (`server/_core/sdk.ts`) handles JWT signing/verification with HS256 and OAuth token exchange.

### Path Aliases (tsconfig + Vite)

| Alias | Path |
|---|---|
| `@/*` | `client/src/*` |
| `@shared/*` | `shared/*` |
| `@assets/*` | `attached_assets/*` |

## Key Constraints

- **Email service is mocked** (`server/services/emailService.ts` sends no real emails) — needs SendGrid/Mailgun integration for production
- **Video processing pipeline** (FFmpeg, AI analysis, subtitle generation) is **planned but not yet implemented**
- **Package manager is pnpm** with a patched dependency (`wouter@3.7.1`)
- The `_core/` directories contain framework plumbing imported from a template — avoid casual edits to these files
- Database uses `bigint` with `{ mode: "number" }` — JavaScript numbers, not BigInt
