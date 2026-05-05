# AutoCut — AI Video Processing & Editing Platform 🎬

> An AI-powered video processing tool that's still growing — hoping the open source community can help make it better.

[中文](README.md) | [English](README_EN.md)

## About This Project 👋

Hi, I'm **Dahui**. I've been programming for over a decade, but I'm still a newbie in the open source world.

AutoCut is my first serious attempt at an open source project. The original idea was simple: could I use AI to automatically edit my videos and generate subtitles? There are plenty of powerful tools out there, but they're either too expensive or too complicated. So I decided to build my own.

Honestly, this project is still **pretty rough around the edges** — a lot of features are still in the planning and draft phase, and there's plenty of room for improvement in the code. I'm open-sourcing it partly to help others with similar needs, but more importantly, I'm hoping to **find people who want to help make it better**. If this project interests you — even just filing an issue, fixing a typo, or sharing ideas — I'd be thrilled!

I've been writing code for years, but open source is a whole new ballgame for me. If you're experienced, I'd love your guidance. If you're also new to open source, let's figure it out together. 😊

---

## What Can It Do Right Now?

The core video processing features are still under development, but the user system and credit system are up and running:

### 👤 User System
- **Email Registration**: Enter your email → receive verification code → set a password. Three steps, done.
- **Two Login Methods**: Sign in with a verification code or with a password — whichever you prefer.
- **OAuth Login**: If you use the Manus platform, one-click sign-in is available.
- **Profile Page**: View and edit your account details.
- **Role Management**: Regular user and admin roles. Admins have additional privileges.

### 💰 Credit System
- **Credit Wallet**: Every user gets their own credit balance.
- **Per-Service Pricing**:
  - AI Video Analysis: 10 credits/minute
  - Video Editing: 15 credits/minute
  - Subtitle Generation: 8 credits/minute
- **Full Transaction History**: Every credit earned and spent is recorded — who did what and when, crystal clear.
- **Admin Panel**: Admins can top up or deduct credits from users.
- **New User Bonus**: 1,000 free credits on registration — enough to try out every feature.

### 🎨 Frontend UI
- Home page with a hero section and feature cards
- Dashboard showing credit balance, video upload (drag & drop, batch, format validation, 2GB limit), and task list
- Light and dark themes — easy on the eyes at night
- Responsive layout — works on mobile too

### 🤖 AI Video Analysis
- **Smart Frame Extraction**: FFmpeg extracts 6 key frames evenly distributed across the video
- **Multimodal Analysis**: AI model analyzes frames, generating scene descriptions, keywords, highlights
- **Graceful Degradation**: Falls back to mock analysis when AI is unavailable
- **Result Viewer**: Scene analysis, keyword tag cloud, highlight scores, content category & summary

### ⚙️ Task Queue
- **State Machine**: queued → processing → completed/failed, full lifecycle management
- **Auto Processing**: Server automatically polls the queue and processes pending tasks
- **Progress Tracking**: Real-time 0-100% progress display
- **Extensible**: Register custom handlers for different task types (analysis/editing/subtitles)

### 📤 Video Upload
- **Drag & Drop**: Drag files onto the page or click to select, up to 10 files at a time
- **Format Validation**: Supports MP4, MKV, MOV, AVI, WebM, FLV and other popular formats
- **Size Limit**: 2GB max per file, validated on both client and server side
- **Batch Processing**: Select multiple files at once, each file uploaded and reported independently
- **Local Storage**: Files are saved in the server's `uploads/` directory

---

## Roadmap: What's Next? 🗺️

To be honest, everything below **still needs to be done**. I keep a detailed development plan in `todo.md` — here's a quick overview by priority:

### 🔴 High Priority (Core Features, Most Urgent)

| Feature | Current State | What Needs to Be Done |
|---|---|---|
| **Async Task Queue** | ✅ Done | In-memory queue + pluggable handlers, upgradeable to Bull/RabbitMQ later |
| **AI Video Analysis** | ✅ Done | FFmpeg frame extraction + multimodal AI analysis + mock fallback, extensible for better models |
| **FFmpeg Editing** | Not started at all | Slicing, merging, resizing, watermarking, trimming intros/outros |

### 🟡 Medium Priority (Important but Can Wait)

| Feature | Current State | What Needs to Be Done |
|---|---|---|
| **Subtitle Generation** | Only an empty `subtitles` table | ASR speech recognition → translation → SRT file generation → burn-in |
| **Admin Dashboard** | A few placeholder buttons | User management pages, credit management panel, task monitoring dashboard |
| **Task Center** | An empty tab in Dashboard | Show queued/processing/completed/failed tasks with detail view and result downloads |

### 🟢 Low Priority (Nice to Have)

| Feature | Description |
|---|---|
| **Analytics** | Usage stats, processing time, credit consumption trends |
| **Performance Optimization** | Large file handling, DB query optimization, caching |
| **Security Hardening** | Rate limiting, audit logging for sensitive actions, dependency scanning |

---

## Tech Stack: What's Under the Hood? 🛠️

When choosing technologies, I focused on a few things: solid documentation, an active community, and keeping things lightweight.

| Layer | Technology | Why I Chose It |
|---|---|---|
| Frontend | **React 19** | Most popular frontend framework — tons of tutorials, easy to find answers |
| Type System | **TypeScript** | More boilerplate than JS, but autocomplete and error checking are worth it |
| CSS | **Tailwind CSS 4** | No switching between CSS files and components — write styles right in your JSX |
| UI Components | **shadcn/ui** | Not a traditional npm package — components are copied into your project, fully customizable |
| Routing | **wouter** | Lightweight router with an API similar to React Router but much smaller |
| API Layer | **tRPC** | Shared types between frontend and backend — no hand-written API docs, call backend functions directly |
| Backend | **Express** | The classic Node.js framework with a rich middleware ecosystem |
| ORM | **Drizzle ORM** | SQL-like query syntax, type-safe, lighter weight than Prisma |
| Database | **MySQL / TiDB** | Battle-tested relational database, stable and reliable |
| Auth | **jose + JWT** | Lightweight JWT library with no dependency on the global crypto object |
| Validation | **Zod** | Define schemas once, use them on both the frontend and backend |
| Package Manager | **pnpm** | Faster than npm, uses less disk space |
| Build Tool | **Vite 7** | Lightning-fast HMR in dev, fast builds in production |

### Some Technical Details

**Why tRPC instead of REST?**
tRPC lets me define a function in `server/routers.ts` and call it directly from the frontend with full type inference. No axios wrappers, no hand-written API types, no maintaining API docs — for a solo project, this saves so much time.

**Why Drizzle ORM instead of Prisma?**
Drizzle's query syntax is closer to raw SQL, so the learning curve is lower. And the SQL it generates is clean — no deeply nested JOIN monsters like you get with Prisma.

**Why wouter instead of React Router?**
wouter's API is nearly identical to React Router, but the whole library is just over 1KB. More than enough for a project of this size.

---

## Project Structure: How Are the Files Organized? 📁

It might look like a lot of files at first glance — here's what each key directory is for:

```
autocut/
│
├── client/                         # 📱 Frontend — everything the user sees and interacts with
│   └── src/
│       ├── main.tsx                # Entry point: initializes tRPC, React Query, global error interceptors
│       ├── App.tsx                  # Route config + global Provider wrapping
│       ├── pages/                  # 📄 Pages
│       │   ├── Home.tsx            #   Home page
│       │   ├── Auth/               #   Login / Registration
│       │   └── Dashboard/          #   Dashboard / Profile
│       ├── components/             # 🧩 Reusable UI components
│       │   └── ui/                 #   shadcn/ui component library (70+ components)
│       ├── hooks/                  # 🪝 Custom React hooks
│       ├── contexts/               #   Global state (theme)
│       └── lib/                    #   Utility functions + tRPC client
│
├── server/                         # 🖥️ Backend — APIs, auth, business logic
│   ├── _core/                      # Framework layer (generated from a template — rarely needs changes)
│   │   ├── index.ts                # Express server entry point
│   │   ├── trpc.ts                 # tRPC initialization + three permission levels
│   │   ├── sdk.ts                  # Auth core: JWT signing/verification, OAuth integration
│   │   ├── context.ts              # Request context (user info, req, res)
│   │   └── cookies.ts             # Cookie configuration (security settings)
│   ├── services/                   # Business logic — this is where you'll make most changes
│   │   ├── authService.ts          # Registration, login, password handling
│   │   ├── creditService.ts        # Credit queries, deductions, top-ups
│   │   └── emailService.ts         # Email sending (⚠️ currently mocked, needs replacement)
│   ├── routers.ts                  # 📍 API route definitions — all endpoints are registered here
│   └── db.ts                       # Database connection + common queries
│
├── drizzle/                        # 🗄️ Database layer
│   ├── schema.ts                   # Complete definitions for all 9 tables (the database "blueprint")
│   ├── 0000_aromatic_elektra.sql   # Initial migration
│   └── 0001_old_rhodey.sql         # Incremental migration
│
├── shared/                         # 🔄 Code shared between frontend and backend
│   ├── const.ts                    #   Constants (cookie names, expiration times, etc.)
│   └── _core/errors.ts            #   HTTP error classes
│
├── patches/                        # 🩹 Dependency patches
│   └── wouter@3.7.1.patch          #   A small fix for wouter
│
├── vite.config.ts                  # Vite build configuration
├── tsconfig.json                   # TypeScript configuration
├── package.json                    # Project dependencies and scripts
├── pnpm-lock.yaml                  # Dependency version lock
├── .env                            # ⚠️ Environment variables (not committed to Git)
├── .gitignore                      # Git ignore rules
├── .prettierrc                     # Code formatting rules
├── LICENSE                         # Apache 2.0 License
└── README.md                       # 📖 The file you're reading right now
```

### Which Files Should You Touch When Making Changes?

- **Adding a new feature?** → Create a new service file in `server/services/` → register a route in `server/routers.ts` → build the page in `client/src/pages/`
- **Changing the database?** → Edit `drizzle/schema.ts` → run `pnpm db:push` to generate migrations
- **Tweaking the UI?** → Go to `client/src/components/` and find the right component
- **Adding a new page?** → Create it in `client/src/pages/` → add a `<Route>` in `App.tsx`
- **Files in `_core/`** → Try not to touch these — they're framework template code

---

## How Does a Request Flow? 🔄

Ever wonder what happens when you click a button in the browser? Here's a simplified flow:

```
You click "Get Credit Balance" in the browser
         │
         ▼
    tRPC client sends the request (useQuery)
         │
         ▼
  POST /api/trpc/credits.getBalance ──► Express Server
         │                                  │
         │                           Parse JWT from cookies
         │                                  │
         │                           Verify signature, extract user info
         │                                  │
         │                           Query DB: userCredits table
         │                           WHERE userId = current user
         │                                  │
         │                                  ▼
         │                           Return { balance: 1000, ... }
         │                                  │
         ▼                                  ▼
   UI auto-updates, credit balance shows on screen
```

### Three Permission Levels

```typescript
// No login required
publicProcedure      // For registration, sending verification codes

// Must be logged in
protectedProcedure   // For checking credits, profile access

// Must be an admin
adminProcedure       // For topping up or deducting user credits
```

---

## Database: What Are the 9 Tables For? 📊

> Don't worry — it might seem like a lot at first, but each table has a clear purpose.

### User-Related (3 Tables)

```
users                    Account info (email, password, role, etc.)
  │
  ├── emailVerificationCodes    Verification codes for registration/login (10-minute expiry)
  └── userCredits               Credit wallet (balance, total earned, total spent)
```

### Credit-Related (2 Tables)

```
creditRates              Pricing table (analysis/editing/subtitle cost per minute)
creditTransactions        Complete transaction log for every credit movement
```

### Video-Related (4 Tables, ⚠️ tables exist but features aren't implemented)

```
videos                   Uploaded video file info (path, size, duration)
processingTasks          Video processing tasks (queued → processing → completed/failed)
videoAnalysis            Detailed AI analysis results (scenes, keywords, highlights)
subtitles                Subtitle data (multi-language, SRT format)
```

---

## Getting Started 🚀

### Step 1: Prerequisites

You'll need these installed on your machine:

- **Node.js** ≥ 18 ([download](https://nodejs.org))
- **pnpm** ≥ 10 (after installing Node.js, run `npm install -g pnpm`)
- **MySQL** ≥ 8.0 (install locally or use Docker)

### Step 2: Clone the Repository

```bash
git clone https://github.com/pangdehui/AutoCut.git
cd AutoCut
pnpm install
```

### Step 3: Set Up the Database

First, create a database in MySQL:

```sql
CREATE DATABASE autocut CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Then create a `.env` file in the project root (⚠️ this file is not committed to Git):

```bash
# Required: Database connection
DATABASE_URL=mysql://root:your-password@localhost:3306/autocut

# Required: JWT secret (any random string will do; the longer, the safer)
JWT_SECRET=a-random-string-at-least-32-characters-long-abcdefghijklmn

# Optional: OAuth login (leave blank if you don't use it — email login works fine)
VITE_APP_ID=
OAUTH_SERVER_URL=
OWNER_OPEN_ID=

# Optional: File storage (leave blank if you don't need it)
BUILT_IN_FORGE_API_URL=
BUILT_IN_FORGE_API_KEY=
```

### Step 4: Initialize the Database

```bash
pnpm db:push
```

This command reads the table definitions in `drizzle/schema.ts` and creates all the tables in your database.

### Step 5: Launch!

```bash
pnpm dev
```

Open your browser and go to **http://localhost:3000** — you should see the AutoCut home page.

---

## Command Reference 📋

```bash
pnpm dev          # Start the dev server (hot reload on code changes)
pnpm build        # Build for production
pnpm start        # Run the production build
pnpm check        # Check for TypeScript type errors
pnpm test         # Run tests
pnpm format       # Format code (keeps code style consistent)
pnpm db:push      # Run database migrations (run after editing schema.ts)
```

---

## For Open Source Newcomers 👨‍💻👩‍💻

I've been coding for a decade, but open source is new territory for me. Whether you're a seasoned developer or just starting out, this project welcomes **contributions of all kinds**:

- 🐛 **Report Bugs**: If something doesn't work right, file an Issue to let me know
- 💡 **Suggest Ideas**: If you think something could be better, speak up
- 📝 **Fix Documentation**: Found a typo or unclear explanation? Send a PR directly
- 🔧 **Fix Small Bugs**: Look for issues tagged `good first issue`
- 🎯 **Add Features**: Want to build something? Let's chat in an Issue first

### Quick PR Workflow

1. Fork this repo
2. Create a branch: `git checkout -b my-feature`
3. Write your code
4. Format: `pnpm format`
5. Type-check: `pnpm check`
6. Commit: `git commit -m "what you changed"`
7. Push to your fork: `git push origin my-feature`
8. Open a Pull Request on GitHub

**Don't be afraid to send a PR!** If the code isn't perfect, that's fine — we can improve it together. Nobody's first PR is flawless. That's totally normal.

### Getting in Touch

- Questions? Open an [Issue](https://github.com/pangdehui/AutoCut/issues)
- You can also start a Discussion in the Issues section

---

## FAQ ❓

**Q: Why build a web app instead of just using FFmpeg commands?**
A: Not everyone is comfortable with the command line. I want to make AI-powered editing accessible to video creators who aren't technical. Plus, combining AI analysis with automated editing is way more efficient than typing commands manually.

**Q: What if emails don't send?**
A: The email service is currently a mock implementation (the code just uses `console.log` instead of actually sending). For production, you'll need to get an API key from SendGrid or Mailgun and replace the `sendVerificationEmail` function in `server/services/emailService.ts`.

**Q: Why MySQL instead of PostgreSQL?**
A: Because TiDB is MySQL-compatible, and hosted TiDB means zero ops. If you prefer PostgreSQL, Drizzle makes the switch straightforward.

**Q: How far do 1,000 credits go?**
A: At 10 credits/minute for analysis, that's 100 minutes of video. At 15 credits/minute for editing, about 67 minutes. Plenty for testing things out.

**Q: Why so many UI component files?**
A: That's because of shadcn/ui. It's not a typical npm package — instead, it copies component source code directly into your project. The upside: you can freely modify any component's internals without waiting for upstream updates.

---

## Known Issues (Keeping It Honest) ⚠️

I don't want to give you the impression this project is perfect. Here's what I already know needs work:

1. **Email is fake**: `server/services/emailService.ts` only does `console.log` — you'll need to wire up SendGrid or Mailgun for real use
2. **FFmpeg editing and subtitles not yet built**: Video editing and subtitle generation are unimplemented. AI analysis is now functional
3. **Task queue is in-memory**: The queue runs inside the server process and is lost on restart. Upgradeable to Bull/RabbitMQ for persistence and distributed processing
4. **Cloud storage depends on Forge**: `storage.ts` S3 upload logic relies on Forge proxy. Video uploads use local storage — if you want cloud storage (AWS S3, Cloudflare R2, etc.), you'll need to adapt it
5. **Almost no tests**: The entire project has exactly 1 test file that tests the logout function. A proper project would have dozens or hundreds
6. **Admin panel is empty**: The admin buttons in the Dashboard don't do anything yet — the corresponding pages and APIs haven't been built
7. **No logging system**: When things go wrong, all you get is console output. There's no proper log collection

If you find more issues while using it, please file an Issue!

---

## Acknowledgments 🙏

Thank you to everyone who visits this repo, and especially those who contribute code, suggestions, or bug reports.

Special thanks to:
- [shadcn/ui](https://ui.shadcn.com) for making frontend development elegant
- [tRPC](https://trpc.io) for that amazing full-stack type-safety experience
- [Drizzle ORM](https://orm.drizzle.team) for making database operations simple and intuitive

---

## License

[Apache License 2.0](LICENSE)
