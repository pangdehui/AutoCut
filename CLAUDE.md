# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server (Express on port 3000 with tsx watch) |
| `pnpm build` | Production build — Vite builds client, esbuild bundles server |
| `pnpm start` | Run production server (`NODE_ENV=production node dist/index.js`) |
| `pnpm check` | TypeScript type-check (`tsc --noEmit`) |
| `pnpm format` | Prettier format all files |
| `pnpm test` | Run vitest tests (`vitest run`, matches `server/**/*.test.ts` and `server/**/*.spec.ts`) |
| `pnpm db:push` | Generate + apply Drizzle migrations |

## Architecture

AutoCut is an **AI-powered video processing platform** (React 19 + Express + MySQL). Video analysis, AI editing, subtitle generation, TTS, BGM, and project management are all implemented as a task-driven pipeline.

### Task Queue System

`server/services/taskService.ts` runs an in-memory queue that polls the DB for `queued` tasks. Each task type registers a handler:

- `analysis` — [analysisService.ts](server/services/analysisService.ts) (frame extraction + LLM scene analysis)
- `editing` — [editingService.ts](server/services/editingService.ts) (FFmpeg: trim, concat, resize, watermark, speed)
- `subtitle` — [subtitleService.ts](server/services/subtitleService.ts) (ASR + AI translation to 8 languages)
- `ai_edit` — [aiEditService.ts](server/services/aiEditService.ts) (AI-driven editing decisions)
- `tts` — [ttsService.ts](server/services/ttsService.ts) (text-to-speech generation)
- `ai_video_creator` — [aiVideoCreatorService.ts](server/services/aiVideoCreatorService.ts) (fully automatic video creation from user materials — AI selects, edits, adds BGM/subtitles)
- `combined` — runs multiple handlers sequentially

### LLM & AI Layer

`server/_core/llm.ts` defines a unified interface (text/image/file messages, tool calls). Providers:
- [openai.ts](server/_core/openai.ts) — OpenAI-compatible API
- [deepseek.ts](server/_core/deepseek.ts) — DeepSeek API

Configured via `ENV.llmProvider`. All AI services degrade gracefully to mock/rule-based results when the LLM provider is unavailable.

`server/_core/gateway.ts` submits tasks to an external processing gateway (`GATEWAY_BASE_URL` / `GATEWAY_API_KEY`) for remote AI work (ASR, image analysis). Falls back to mock data when not configured.

### Directory Layout

```
client/src/           # React 19 frontend (Vite + Tailwind CSS 4 + shadcn/ui)
  pages/
    Auth/             # Login/register
    Dashboard/        # VideoList, VideoUpload, ProjectWorkspace, AiCreatorPanel,
                      # EditingPanel, SubtitlePanel, TtsPanel, SubtitleViewer,
                      # AnalysisViewer, TaskList, OutputList, Profile
    Admin/            # UserManagement, CreditManagement, TaskMonitor, Statistics

server/
  _core/              # Framework layer (avoid casual edits)
    index.ts, trpc.ts, sdk.ts, env.ts, context.ts, cookies.ts, oauth.ts
    llm.ts, openai.ts, deepseek.ts    # LLM abstraction
    gateway.ts, dataApi.ts, storageProxy.ts  # External service clients
    voiceTranscription.ts, imageGeneration.ts, notification.ts, map.ts
  services/           # Business logic
    authService.ts, creditService.ts, emailService.ts
    videoService.ts, projectService.ts
    taskService.ts                    # Queue engine + handler registry
    analysisService.ts, editingService.ts, aiEditService.ts
    subtitleService.ts, ttsService.ts, bgmService.ts
    aiVideoCreatorService.ts, volcanoAsrService.ts
    editStyle.ts                      # Editing style templates (presets + prompt injection + hard constraints)
    subtitleStyle.ts                  # Subtitle style presets
    adminService.ts
  routers.ts          # All tRPC route definitions
  db.ts               # Drizzle DB connection (lazy — null if no DATABASE_URL)
  storage.ts          # S3 upload/download via Forge proxy

drizzle/schema.ts     # 11 tables (see Database section below)
shared/               # const.ts, types.ts, _core/errors.ts
```

### Request Flow

1. Express receives request → `/api/trpc` → tRPC middleware calls `createContext()`
2. `createContext` → `sdk.authenticateRequest()` verifies JWT session cookie, syncs user from OAuth server if needed
3. Route handler executes with typed `{ req, res, user }` context
4. Client (`main.tsx`) auto-redirects to login on `UNAUTHORIZED` tRPC errors

### tRPC Procedure Types

- `publicProcedure` — no auth required
- `protectedProcedure` — requires `ctx.user`
- `adminProcedure` — requires `ctx.user.role === 'admin'`

Import from `server/_core/trpc.ts`. Uses `superjson` transformer.

### tRPC Route Structure

All routes defined in [server/routers.ts](server/routers.ts):

- `auth.*` — register/login/logout/me
- `credits.*` — getBalance, recharge (admin), deduct (admin)
- `videos.*` — list, listWithStatus, getById, delete
- `projects.*` — list, create, getById, delete
- `tasks.*` — list, getById, create (with credit check + deduct), remove
- `analysis.*` — byTaskId, byVideoId
- `subtitles.*` — byTaskId
- `bgm.*` — list
- `admin.*` — listUsers, setUserActive, setUserRole, creditTransactions, taskStats, listAllTasks, overviewStats, dailyUserRegistrations, dailyCreditConsumption, dailyTaskCounts, avgProcessingDuration

### Database (11 tables in `drizzle/schema.ts`)

- **users** — email, password hash, role (user/admin), OAuth openId
- **emailVerificationCodes** — 6-digit codes (10 min expiry)
- **userCredits** — balance, totalEarned, totalUsed per user
- **creditTransactions** — audit log for all credit changes (type: analysis/editing/subtitle/admin_recharge/admin_deduction/ai_video_creator)
- **creditRates** — per-service-type credit cost config
- **videos** — uploaded video metadata (path, size, duration, projectId FK)
- **projects** — video project grouping
- **processingTasks** — task queue with status machine (queued→processing→completed/failed), taskType enum (7 types), progress 0-100, parameters/result JSON columns
- **videoAnalysis** — sceneDescriptions, keywords, highlights (JSON columns)
- **subtitles** — SRT content per language per task

### Editing Style Templates

[server/services/editStyle.ts](server/services/editStyle.ts) defines 4 style templates that constrain AI editing decisions:

| Style | Key constraints | Best for |
|---|---|---|
| `auto` | No override (current behavior) | Default |
| `ecommerce_matrix` | Max segment 6s, >70% cut transitions, total 25-40s, auto-split segments >6s | Livestream/product clips |
| `knowledge_talk` | First segment forced zoomin, dissolve transitions, total 40-90s | Tutorials/knowledge sharing |
| `emotional_story` | Max segment 10s, >40% dissolve transitions, total 45-90s | Vlog/storytelling/healing |

The style flows as `parameters.style` in the task params. Two-stage enforcement:
1. **Prompt injection** — `injectStyleRules()` appends style-specific rules to the LLM prompt
2. **Hard constraints** — `applyHardConstraints()` splits/enforces segments after AI JSON parsing, before FFmpeg execution

Backward compatible: `auto` or missing style = no changes to behavior.

### Credit System

Task creation deducts credits before queuing. Current rates:
- Analysis: 10 credits/min
- Editing / AI edit: 15 credits/min
- Subtitle: 8 credits/min
- TTS: 5 credits/min
- AI video creator: 30 flat

### Path Aliases (tsconfig + Vite)

| Alias | Path |
|---|---|
| `@/*` | `client/src/*` |
| `@shared/*` | `shared/*` |
| `@assets/*` | `attached_assets/*` |

## Key Constraints

- **Package manager is pnpm** with a patched dependency (`wouter@3.7.1`)
- **Email service is mocked** — [emailService.ts](server/services/emailService.ts) logs to console only
- **Task queue is in-memory** — restart clears the queue (upgrade to Bull/RabbitMQ planned)
- **`_core/` directories** contain framework template code — avoid casual edits
- **Database uses `bigint` with `{ mode: "number" }`** — plain JS numbers
- **Gateway fallback** — AI analysis/ASR returns mock data when `GATEWAY_BASE_URL` is not configured
- **LLM fallback** — all AI services fall back to mock/rule-based results when the LLM provider is unavailable
