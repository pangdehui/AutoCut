import { getDb } from "../db";
import { videos, videoAnalysis } from "../../drizzle/schema";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { ProcessingTask } from "../../drizzle/schema";
import { registerTaskHandler } from "./taskService";
import { getDeepSeek } from "../_core/deepseek";
import { transcribeAudio, mergeToSentences } from "./volcanoAsrService";
import { submitGatewayTask, waitForGatewayTask } from "../_core/gateway";
import { ENV } from "../_core/env";
import { trimVideo, concatVideos, concatVideosWithTransitions, outputPath, type TransitionType, type SegmentTransition } from "./editingService";
import { pickBgmByMood } from "./bgmService";
import { subtitleStyleString, type SubtitleStyle, type SubtitleConfig } from "./subtitleStyle";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execAsync = promisify(exec);
const AUDIO_DIR = path.resolve("uploads/audio");
const OUTPUT_DIR = path.resolve("uploads/output");

function parseJsonResponse(content: string | null): any {
  if (!content) throw new Error("LLM 返回为空");
  try { return JSON.parse(content); } catch {}
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  const brace = content.match(/\{[\s\S]*\}/);
  if (brace) {
    try { return JSON.parse(brace[0]); } catch {}
  }
  throw new Error(`无法解析 LLM 返回的 JSON: ${content.slice(0, 200)}`);
}

function ensureDirs() {
  for (const d of [AUDIO_DIR, OUTPUT_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

// ====== 接口定义 ======

type AspectRatio = "16:9" | "9:16" | "1:1";
type ResolutionTier = "1080p" | "720p";
type BgmMood = "upbeat" | "calm" | "dramatic" | "warm" | "energetic" | "cinematic" | "none";

interface AutoConfig {
  aspect: AspectRatio;
  resolution: ResolutionTier;
  voiceId: string;
  speed: number;
  /** true = 口播视频，跳过 TTS，只靠字幕传达；此时字幕必须开启且烧录 */
  noAudio: boolean;
  subtitlesEnabled: boolean;
  subtitlesBurnIn: boolean;
  subtitleStyle: SubtitleStyle;
  bgmMood: BgmMood;
  bgmVolume: number; // 0.05-0.4
  reasoning: string;
}

interface AiCreatorParams {
  prompt: string;
  projectId?: number;
  /** 自动模式：true 时由 LLM 决定下方所有参数；false 时使用用户提供的覆盖值 */
  autoMode?: boolean;
  voiceId?: string;
  speed?: number;
  noAudio?: boolean;
  aspect?: AspectRatio;
  resolution?: ResolutionTier;
  subtitleStyle?: SubtitleStyle;
  /** 字幕样式细粒度覆盖：在 subtitleStyle 预设上叠加（颜色/字号/字体/位置等） */
  subtitleConfig?: SubtitleConfig;
  bgmMood?: BgmMood;
  bgmVolume?: number;
  subtitles?: {
    enabled: boolean;
    language?: string;
    burnIn?: boolean;
  };
  /** 强制静音原视频（用户在 prompt 里明确说了"原音静音/原声去掉"） */
  muteOriginalOverride?: boolean;
  /** 仅生成方案+审查，不执行剪辑（用户确认后再继续）。true=方案确认模式；false/缺省=极速一键 */
  planOnly?: boolean;
  /** 用户确认后传入，跳过 Phase 0-2，直接执行 Phase 3-5 */
  approvedPlan?: ScriptResult;
  /** 用户确认后回传的选中视频子集 ID，必须与 review 阶段返回的一致，用于让 clips.videoIndex 对齐 */
  selectedVideoIds?: number[];
  /** 迭代修改：上一版完整方案（来自上一任务的 result），diff 式修改的基准 */
  previousPlan?: {
    title: string;
    script: string;
    clips: ScriptClip[];
    muteOriginal: boolean;
    selectedVideoIds: number[];
  };
  /** 迭代修改：本轮自然语言修改指令，如"开头第一段换更抓眼的镜头" */
  editInstruction?: string;
}

interface VideoSummary {
  id: number;
  fileName: string;
  duration: number | null;
  category: string | null;
  keywords: string[] | null;
  summary: string | null;
  scenes: Array<{
    startTime: number;
    endTime: number;
    description: string;
    tags: string[];
    shotType?: string;
    motion?: string;
    quality?: string;
  }> | null;
}

interface IntentResult {
  topic: string;
  style: string;
  targetDuration: number;
  selectedVideoIds: number[];
  reasoning: string;
  /** 创意简报：传给 Phase 2 剪辑师 */
  creativeBrief?: string;
  /** 推荐的 muteOriginal */
  suggestedMute?: boolean;
  /** 推荐的 BGM 情绪 */
  suggestedBgm?: string;
}

interface ScriptClip {
  videoIndex: number;
  startTime: number;
  endTime: number;
  narration: string;
  /** 进入此片段时使用的转场类型；首片段忽略 */
  transition?: TransitionType;
  /** 转场时长（秒），默认 0.4，范围 0.2 - 1.0 */
  transitionDuration?: number;
}

interface ScriptResult {
  title: string;
  script: string;
  clips: ScriptClip[];
  muteOriginal: boolean;
}

// ====== 视频查询 ======

function parseTs(ts: string): number {
  if (!ts) return 0;
  const parts = ts.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

async function getAnalyzedVideos(userId: number, projectId?: number): Promise<VideoSummary[]> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const conditions = [eq(videos.userId, userId), isNotNull(videoAnalysis.id)];
  if (projectId) {
    conditions.push(eq(videos.projectId, projectId));
  }

  const rows = await db
    .select({
      id: videos.id,
      fileName: videos.originalName,
      duration: videos.duration,
      sceneDescriptions: videoAnalysis.sceneDescriptions,
      keywords: videoAnalysis.keywords,
      metadata: videoAnalysis.metadata,
      analysisCreatedAt: videoAnalysis.createdAt,
    })
    .from(videos)
    .innerJoin(videoAnalysis, eq(videos.id, videoAnalysis.videoId))
    .where(and(...conditions))
    .orderBy(desc(videoAnalysis.createdAt));

  const latestRows = rows.filter((row, index, arr) =>
    arr.findIndex((candidate) => candidate.id === row.id) === index
  );

  return latestRows.map((r) => {
    const meta = (r.metadata || {}) as Record<string, unknown>;
    const rawScenes = (r.sceneDescriptions || []) as any[];
    const allScenes = rawScenes
      .map((s: any) => ({
        startTime: typeof s.startTime === "number" ? s.startTime : parseTs(s.timestamp || "0:00"),
        endTime: typeof s.endTime === "number" ? s.endTime : parseTs(s.timestamp || "0:00") + 3,
        description: s.description || "",
        tags: s.tags || [],
        shotType: s.shotType || "",
        motion: s.motion || "",
        quality: s.quality || "",
      }))
      // 过滤废片：质量"较差" 或 时长不足 0.5 秒（≈15帧）自动排除
      .filter((s) => {
        const dur = s.endTime - s.startTime;
        if (s.quality === "较差") return false;
        if (dur < 0.5) return false;
        return true;
      });
    // "一般" 质量的不删除，但在描述前加警告标记
    const scenes = allScenes.map((s) =>
      s.quality === "一般" ? { ...s, description: `⚠️${s.description}` } : s
    );
    return {
      id: r.id,
      fileName: r.fileName,
      duration: r.duration ? parseFloat(String(r.duration)) : null,
      category: (meta.category as string) || null,
      keywords: (r.keywords as string[]) || null,
      summary: (meta.summary as string) || null,
      scenes,
    };
  });
}

// ====== Phase 0: LLM 自动决策（音色/比例/字幕样式/BGM 等） ======

const VOICE_CATALOG: Array<{ id: string; tone: string; suit: string }> = [
  { id: "female-chengshu",                             tone: "甜美女声",   suit: "美食/亲子/治愈/日常 vlog" },
  { id: "female-yujie",                                tone: "御姐女声",   suit: "美妆/穿搭/品质感产品/职场" },
  { id: "female-shaonv",                               tone: "少女女声",   suit: "学生/萌系/二次元/年轻潮流" },
  { id: "Chinese (Mandarin)_News_Anchor",              tone: "新闻女声",   suit: "新闻播报/严肃话题/事件解读" },
  { id: "Chinese (Mandarin)_Sweet_Lady",               tone: "广告甜美",   suit: "广告/产品/亲和力开场" },
  { id: "Chinese (Mandarin)_Warm_Bestie",              tone: "温暖闺蜜",   suit: "情感共鸣/Vlog/生活记录" },
  { id: "male-qn-jingying",                            tone: "精英青年",   suit: "商业/科技/专业讲解/B 端" },
  { id: "male-qn-badao",                               tone: "霸道青年",   suit: "汽车/数码/极致体验/带货" },
  { id: "male-qn-qingse",                              tone: "青涩青年",   suit: "校园/治愈/情感故事" },
  { id: "Chinese (Mandarin)_Gentleman",                tone: "温润男声",   suit: "纪录片/旅行/人文" },
  { id: "Chinese (Mandarin)_Male_Announcer",           tone: "播报男声",   suit: "硬广/赛事/氛围旁白" },
  { id: "Chinese (Mandarin)_Reliable_Executive",       tone: "沉稳高管",   suit: "金融/政经/严肃商业" },
];

async function phase0AutoConfig(prompt: string): Promise<AutoConfig> {
  const voiceCatalogText = VOICE_CATALOG
    .map((v) => `  • ${v.id} → ${v.tone} (best for: ${v.suit})`)
    .join("\n");

  const systemPrompt = `You are a senior short-video post-production director. Based on the creative request, determine ALL production parameters at once. Each parameter must carefully match the content type — your decisions directly affect final quality.

━━━━━━━━━━━━━━━━━━━━━━━
1. Aspect Ratio
━━━━━━━━━━━━━━━━━━━━━━━
• 9:16  vertical → TikTok/Douyin/Shorts/Reels (mobile-first, default)
• 16:9  horizontal → YouTube/tutorials/documentaries/corporate
• 1:1   square → Xiaohongshu/brand content
Logic: platform name in request first; otherwise by content type (product/vlog→9:16; tutorial/doc→16:9)

━━━━━━━━━━━━━━━━━━━━━━━
2. Resolution
━━━━━━━━━━━━━━━━━━━━━━━
• 1080p → premium content, brand, product showcase (default)
• 720p  → quick daily vlog, small file size needed

━━━━━━━━━━━━━━━━━━━━━━━
3. Voice Selection (voiceId) ⚠️ CRITICAL
━━━━━━━━━━━━━━━━━━━━━━━
Must pick from this catalog — wrong voice ruins the video:
${voiceCatalogText}

Matching logic (by priority):
1. User explicitly specifies gender/tone/name → direct match
2. Content SUBTYPE matching (more specific = better):
   - Food ASMR / slow cooking → Chinese (Mandarin)_Warm_Bestie or female-chengshu (gentle, intimate)
   - Food fast-cut / street food → male-qn-badao or female-yujie (energetic, punchy)
   - Product promo (beauty/fashion) → female-yujie (sophisticated, trustworthy)
   - Product promo (tech/gadget/digital) → male-qn-jingying (precise, authoritative)
   - Product promo (general/deals) → male-qn-badao (urgent, compelling)
   - Knowledge/tutorial/deep-dive → male-qn-jingying (clear, credible) or female-yujie
   - Emotional story / healing / nostalgia → Chinese (Mandarin)_Warm_Bestie or male-qn-qingse
   - Youth culture / fashion / trends → female-shaonv or male-qn-qingse
   - Travel documentary / culture → Chinese (Mandarin)_Gentleman (warm, literary)
   - Travel fast-cut / adventure → male-qn-badao or female-yujie
   - News / serious topics → Chinese (Mandarin)_News_Anchor
   - Business / finance / B2B → Chinese (Mandarin)_Reliable_Executive
   - Daily Vlog (female creator) → female-chengshu or Chinese (Mandarin)_Warm_Bestie
   - Daily Vlog (male creator) → male-qn-qingse or Chinese (Mandarin)_Gentleman
3. Fallback (no clear match) → female-chengshu

━━━━━━━━━━━━━━━━━━━━━━━
4. Speed
━━━━━━━━━━━━━━━━━━━━━━━
• 0.85-0.95 → healing/documentary/emotional (breathing room)
• 1.0       → standard, general purpose
• 1.05-1.15 → knowledge content, higher information density
• 1.15-1.25 → product promo/fast-paced/limited-time (urgency)
Note: never exceed 1.25 — too fast causes fatigue

━━━━━━━━━━━━━━━━━━━━━━━
5. Subtitle Configuration
━━━━━━━━━━━━━━━━━━━━━━━
subtitleStyle options:
• default       → white text with black outline, universal, 95% of use cases
• bold_caption  → large bold text, product promo/talking-head/emphasis content
• minimal       → semi-transparent thin text, documentary/vlog/artistic
• tiktok_yellow → yellow text on black, trendy/entertainment/high-energy mashup
Most content: subtitlesEnabled=true, subtitlesBurnIn=true
When noAudio=true: subtitles are the ONLY information carrier — MUST enable and burn-in

━━━━━━━━━━━━━━━━━━━━━━━
6. BGM Mood — Match content SUBTYPE, not just broad category
━━━━━━━━━━━━━━━━━━━━━━━
• upbeat    → light & cheerful (daily vlog, check-in, good news, unboxing, casual food)
• calm      → soothing & gentle (ASMR cooking, nature, bedtime, meditation, slow lifestyle)
• dramatic  → tension & reveal (mystery, conflict, "wait for it" moments, transformation reveal)
• warm      → heartwarming & nostalgic (family, memories, growth story, emotional Vlog, pet content)
• energetic → high-energy & hype (sports highlights, challenge, workout, street fashion, festival)
• cinematic → epic & grand (travel films, brand promo, landscape, milestone celebration, luxury)
• none      → no BGM (pure narration, formal interview, user explicitly wants silence)

Content-type → BGM mapping reference:
  • 美食/food b-roll → calm or warm (let the food sounds breathe)
  • 美食/food fast-cut → upbeat
  • 带货/product promo (urgency) → energetic or upbeat
  • 带货/product promo (premium/luxury) → cinematic or warm
  • 教程/tutorial → calm or none (don't distract from instruction)
  • Vlog/日常 → warm or upbeat (personality-driven)
  • 知识科普/knowledge → cinematic or calm (intellectual, not distracting)
  • 情感故事/emotional → warm or dramatic (follow the emotional arc)
  • 旅行/travel → cinematic or upbeat (aspirational)

bgmVolume reference:
  • With TTS voiceover: 0.08–0.15 (BGM must duck behind speech)
  • Without TTS (noAudio=true, BGM + subtitles only): 0.25–0.40 (BGM is the audio backbone)
  • Product showcase with voiceover: 0.10–0.12 (slightly higher, adds energy)

━━━━━━━━━━━━━━━━━━━━━━━
7. noAudio (Skip Voiceover)
━━━━━━━━━━━━━━━━━━━━━━━
Set to true ONLY when user explicitly says "no voiceover / subtitles only / silent / just BGM". Otherwise false.

━━━━━━━━━━━━━━━━━━━━━━━
Output strictly as JSON, no other text:
{
  "aspect": "9:16",
  "resolution": "1080p",
  "voiceId": "voice-id",
  "speed": 1.0,
  "noAudio": false,
  "subtitlesEnabled": true,
  "subtitlesBurnIn": true,
  "subtitleStyle": "default",
  "bgmMood": "upbeat",
  "bgmVolume": 0.15,
  "reasoning": "Brief rationale for each key parameter choice in Chinese, under 100 chars"
}`;

  const result = await getDeepSeek().chat.completions.create({
    model: ENV.deepseekModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Creative request: ${prompt}` },
    ],
  });

  const content = result.choices[0]?.message?.content;
  if (!content) throw new Error("LLM 自动决策返回空");
  const parsed = parseJsonResponse(content);

  const allowedVoices = new Set(VOICE_CATALOG.map((v) => v.id));
  const voiceId = allowedVoices.has(parsed.voiceId) ? parsed.voiceId : "female-chengshu";

  return {
    aspect: (["16:9", "9:16", "1:1"].includes(parsed.aspect) ? parsed.aspect : "9:16") as AspectRatio,
    resolution: (["1080p", "720p"].includes(parsed.resolution) ? parsed.resolution : "1080p") as ResolutionTier,
    voiceId,
    speed: clamp(Number(parsed.speed) || 1.0, 0.7, 1.5),
    noAudio: parsed.noAudio === true,
    subtitlesEnabled: parsed.subtitlesEnabled !== false,
    subtitlesBurnIn: parsed.subtitlesBurnIn !== false,
    subtitleStyle: (["default", "bold_caption", "minimal", "tiktok_yellow"].includes(parsed.subtitleStyle)
      ? parsed.subtitleStyle : "default") as SubtitleStyle,
    bgmMood: (["upbeat", "calm", "dramatic", "warm", "energetic", "cinematic", "none"].includes(parsed.bgmMood)
      ? parsed.bgmMood : "none") as BgmMood,
    bgmVolume: clamp(Number(parsed.bgmVolume) || 0.15, 0.05, 0.5),
    reasoning: String(parsed.reasoning || ""),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function aspectToWH(aspect: AspectRatio, tier: ResolutionTier): { w: number; h: number } {
  const long = tier === "1080p" ? 1920 : 1280;
  const short = tier === "1080p" ? 1080 : 720;
  if (aspect === "16:9") return { w: long, h: short };
  if (aspect === "9:16") return { w: short, h: long };
  return { w: short, h: short };
}

// ====== Phase 1: LLM 意图理解 + 选视频 ======

const INTENT_SCHEMA = {
  name: "intent_result",
  schema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "Video topic in Chinese" },
      style: { type: "string", description: "Video style, e.g. product-promo/vlog/tutorial/review" },
      targetDuration: { type: "number", description: "Target video duration in seconds" },
      selectedVideoIds: {
        type: "array",
        items: { type: "number" },
        description: "Selected relevant video IDs for creation",
      },
      reasoning: { type: "string", description: "Selection rationale in Chinese" },
    },
    required: ["topic", "style", "targetDuration", "selectedVideoIds", "reasoning"],
  },
  strict: true,
};

async function phase1Intent(
  prompt: string,
  videoSummaries: VideoSummary[]
): Promise<IntentResult> {
  const videoListText = videoSummaries
    .map((v) => {
      const kw = (v.keywords || []).join(", ");
      const sceneCount = (v.scenes || []).length;
      const dur = v.duration?.toFixed(0) ?? "?";
      // Count quality distribution for diversity hints
      const qualityCounts: Record<string, number> = {};
      (v.scenes || []).forEach((s: any) => {
        const q = s.quality || "可用";
        qualityCounts[q] = (qualityCounts[q] || 0) + 1;
      });
      const qSummary = Object.entries(qualityCounts)
        .map(([q, n]) => `${q}:${n}`)
        .join(" ");
      return `  [ID:${v.id}] ${v.fileName} | ${dur}s | category:${v.category || "?"} | keywords:${kw || "none"} | scenes:${sceneCount} | quality: ${qSummary}`;
    })
    .join("\n");

  const systemPrompt = `You are a senior short-video creative director. Your job is to select the best footage from the media library and provide precise, executable creative direction to the editor.

## Your Task

**Step 1: Deep Intent Interpretation**
- What does the user REALLY want? Read between the lines — emotional appeal, distribution platform, conversion goal.
- Who is the target audience? Age bracket, interests, pain points. This shapes EVERYTHING: tone, pace, visual style.
- What is the ONE thing this video must communicate? If the viewer remembers only one sentence, what should it be?
- Is there an implicit platform? (Douyin = fast/vertical/trendy; Xiaohongshu = aesthetic/clean/slower; YouTube = horizontal/detailed; WeChat = square/quiet)

**Step 2: Smart Footage Selection (DIVERSITY IS A HARD REQUIREMENT)**

Selection scoring (mental checklist per video):
- Relevance score (1–5): Do keywords/category match the creative request?
- Visual diversity contribution (1–5): Does this video add a NEW angle, shot type, or mood that others don't?
- Duration buffer (1–5): Does this have enough runtime to contribute meaningful clips?
- Quality baseline: If >30% of scenes are "一般"(average), consider it lower priority.

⚠️ Hard selection rules:
- ≥10 relevant videos → select 6–10 (more footage = more visual variety)
- 5–9 relevant → select 4–7
- 3–4 relevant → select all
- NEVER select only 1–2 videos when more are available — editing from 1 source = visual monotony = high swipe-away rate
- If you find yourself selecting videos with similar categories, deliberately add 1–2 with different visual characteristics for contrast

**Step 3: Creative Brief — Be specific, not generic**

Write a creative brief that the editor can directly execute. AVOID vague instructions like "make it engaging" or "good pacing." Be CONCRETE:

1. Hook strategy: WHICH specific pattern to use (visual stun? question? result-first? pain-point?) and WHY for this content.
2. Narrative structure: WHICH content-type template fits best, and what the 3 key story beats are.
3. Emotional arc: Start emotion → middle emotion → end emotion. Be specific ("curiosity → surprise → satisfaction" not "positive emotions").
4. Visual language: Recommend shot type mix (e.g. "60% medium shots, 25% close-ups, 15% wide"), color/mood keywords.
5. Ending: CTA type (follow/comment/buy/save) OR emotional landing.

## Available Media Library
${videoListText}

## Target Duration Reference
• 15–30s: Viral short (product flash, comedy, challenge, quick tip)
• 30–60s: Standard (vlog, review, recipe, tutorial, story) — DEFAULT for unspecified
• 60–120s: In-depth (documentary, detailed tutorial, narrative story)
• Product promo → 25–35s | Food → 30–45s | Tutorial → 45–60s | Vlog → 40–60s | Knowledge → 45–90s

## Output JSON (strict format, no extra text)
{
  "topic": "Video topic in Chinese, under 10 characters — specific, not generic",
  "style": "Content style in Chinese — be precise: 美食教程/产品种草/旅行Vlog/知识科普/情感叙事/混剪/口播/测评/探店",
  "targetDuration": 45,
  "selectedVideoIds": [1, 3, 5],
  "reasoning": "In Chinese: what was selected, WHY each, how diversity is achieved (mention shot types, moods, categories represented)",
  "creativeBrief": "In Chinese, under 180 chars: specific hook pattern + content template + 3 beat names + shot mix ratio + CTA type. Be concrete, not abstract.",
  "suggestedMute": true,
  "suggestedBgm": "warm"
}`;

  const result = await getDeepSeek().chat.completions.create({
    model: ENV.deepseekModel,
    messages: [
      {
        role: "system",
        content:
          systemPrompt +
          `\n\n⚠️ STRICT: Output ONLY valid JSON. No markdown wrappers, no extra text.`,
      },
      { role: "user", content: `Creative request: ${prompt}` },
    ],
  });

  const content = result.choices[0]?.message?.content;
  if (!content) throw new Error("LLM 返回格式异常");
  return parseJsonResponse(content) as IntentResult;
}

// ====== Phase 2: LLM 生成脚本 + 剪辑计划 ======

const TRANSITION_TYPES: TransitionType[] = [
  "cut",
  "fade", "fadeblack", "fadewhite", "fadegrays", "dissolve", "distance",
  "slideleft", "slideright", "slideup", "slidedown",
  "smoothleft", "smoothright", "smoothup", "smoothdown",
  "coverleft", "coverright", "coverup", "coverdown",
  "revealleft", "revealright", "revealup", "revealdown",
  "wipeleft", "wiperight", "wipeup", "wipedown",
  "wipetl", "wipetr", "wipebl", "wipebr",
  "diagtl", "diagtr", "diagbl", "diagbr",
  "circleopen", "circleclose", "circlecrop", "rectcrop",
  "horzopen", "horzclose", "vertopen", "vertclose",
  "zoomin", "pixelize", "hblur", "radial", "squeezeh", "squeezev",
];

const SCRIPT_SCHEMA = {
  name: "script_result",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "视频标题" },
      script: { type: "string", description: "完整的配音脚本文本" },
      clips: {
        type: "array",
        items: {
          type: "object",
          properties: {
            videoIndex: { type: "number", description: "素材视频在 selectedVideoIds 中的序号（从0开始）" },
            startTime: { type: "number", description: "片段起始时间（秒）" },
            endTime: { type: "number", description: "片段结束时间（秒）" },
            narration: { type: "string", description: "该片段对应的配音文本" },
            transition: {
              type: "string",
              enum: TRANSITION_TYPES,
              description: "进入此片段时使用的转场（首片段会被忽略）。cut=硬切（最常用）；fade/dissolve/distance=淡入溶解；fadeblack/fadewhite/fadegrays=黑场/白场/灰场；slide*=滑动；smooth*=平滑滑动（更柔）；cover*=新片盖入；reveal*=旧片滑走露出；wipe上下左右=直边擦除；wipetl/tr/bl/br=四角斜擦；diag*=对角推移；circleopen/close/circlecrop=圆形开合/裁切；rectcrop=矩形裁切；horzopen/close、vertopen/close=横/竖开合；zoomin=推近；pixelize=像素化；hblur=模糊过渡；radial=径向扫；squeezeh/v=横/竖挤压",
            },
            transitionDuration: {
              type: "number",
              description: "转场时长（秒），范围 0.2-1.0，默认 0.4",
            },
          },
          required: ["videoIndex", "startTime", "endTime", "narration"],
        },
      },
      muteOriginal: { type: "boolean", description: "是否静音原视频音频" },
    },
    required: ["title", "script", "clips", "muteOriginal"],
  },
  strict: true,
};

async function phase2Script(
  prompt: string,
  topic: string,
  style: string,
  targetDuration: number,
  selectedVideos: VideoSummary[],
  selectedVideoIds: number[],
  creativeBrief?: string,
  noAudio?: boolean,
): Promise<ScriptResult> {
  const sceneDetails = selectedVideos
    .map((v) => {
      const vidx = selectedVideoIds.indexOf(v.id);
      const scenes = (v.scenes || [])
        .map(
          (s) =>
            `    [${s.startTime.toFixed(1)}s → ${s.endTime.toFixed(1)}s] ${s.description}` +
            (s.shotType ? ` | shot:${s.shotType}` : "") +
            (s.motion ? ` | motion:${s.motion}` : "") +
            (s.quality ? ` | quality:${s.quality}` : "") +
            (s.tags?.length ? ` | tags:${s.tags.join(",")}` : "")
        )
        .join("\n");
      return (
        `[Index:${vidx} | ID:${v.id}] ${v.fileName}\n` +
        `  duration:${v.duration?.toFixed(1) ?? "?"}s | category:${v.category || "?"}\n` +
        `  scenes:\n${scenes}`
      );
    })
    .join("\n\n");

  const systemPrompt = `You are a world-class short-video editor with 15 years of experience across TikTok, Douyin, and YouTube Shorts. You are equally skilled in ad copywriting, narrative design, visual composition, and audience psychology. Your work consistently achieves >80% completion rates and drives measurable conversion. You know every single frame must EARN its place.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORE PHILOSOPHY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Every shot must deliver one of: information value, emotional value, or visual impact. If a shot does none of these, it doesn't belong.
• The first 3 seconds determine retention (>70% drop-off happens here); the mid-section rhythm determines completion rate; the ending determines conversion/share/comment.
• Narration is never a visual description — it's the emotional and informational layer ON TOP of the visuals. Let the visuals SHOW, let the narration TELL what can't be seen.
• Visual surprise is the cheapest retention hack: when the audience can predict the next shot, they swipe away.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. HOOK ARSENAL — Pick the right weapon for the content type
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[PATTERN A: Visual Stun Hook] — Best for: food, product showcase, travel, fashion
  • Extreme close-up of the most visually appealing detail (sizzling oil, fabric texture, product finish)
  • Rapid macro-to-wide reveal: start 2cm from subject → pull back to full scene
  • Color bomb: intensely saturated hero shot that wouldn't exist in daily life
  • Duration: 1.0–2.5s per hook clip, cut directly to context clip
  • Narration style: Start mid-sentence or with an emotional exclamation ("这也太..." / "看这个...")

[PATTERN B: Question/Contradiction Hook] — Best for: knowledge, explainer, review, tech
  • Open with a counter-intuitive statement or provocative question
  • Show visual evidence that contradicts common belief
  • "你一定不知道..." / "很多人以为...但其实..." / "为什么..."
  • Duration: question clip 1.5–2s → answer tease clip 1.5–2s → context

[PATTERN C: Result-First Hook] — Best for: transformation, tutorial, before/after, product effect
  • Show the END RESULT in the first 1.5 seconds (the "wow" moment)
  • Then rewind to show the process/journey
  • Narration: "这就是..." / "XX天之后..." followed by flashback
  • Must use the most dramatic visual contrast available

[PATTERN D: Pain-Point Hook] — Best for: product promo, service, lifestyle, health
  • Show the frustration/pain point in 1–2s (the "before" state)
  • Narration names the problem the audience feels but hasn't articulated
  • Immediate transition to solution/relief
  • "你是不是也..." / "每次...都想..."

[PATTERN E: Action/Energy Hook] — Best for: sports, challenge, gaming, street content
  • Pure kinetic energy opening — motion blur, quick pans, jump cuts
  • 3–5 ultra-short clips (0.5–1.0s each) stitched with cut transitions
  • Rhythmic narration or text-only opening

❌ FORBIDDEN OPENINGS (will cause immediate swipe-away):
  • "大家好欢迎来到..." / "Hello everyone welcome to..."
  • "今天给大家分享..." / "Today I'm going to share..."
  • Any clip longer than 3s without a clear hook signal
  • Slow fade-in from black (wastes precious hook seconds)
  • A-roll of someone just talking without supporting B-roll

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. CONTENT-TYPE NARRATIVE TEMPLATES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[FOOD / 美食] Structure: Tease → Process → Climax → Call
  1. Hook (0–3s): Extreme close-up of the most appetizing detail
  2. Context (3–8s): What we're making, why it matters
  3. Process beats (8–70%): Key steps, each 2–4s, narrated with sensory language
  4. Climax reveal (70–85%): The finished dish, slow-mo or dramatic angle
  5. CTA (85–100%): "收藏起来下次做" / "你觉得怎么样"
  Tone: Warm, sensory, slightly hungry-inducing. Narration should make mouth water.

[PRODUCT PROMO / 带货] Structure: Pain → Solution → Proof → Scarcity → Buy
  1. Hook (0–3s): Pain point visual or result-first showcase
  2. Problem amplification (3–25%): 2–3 clips showing why current solution sucks
  3. Product reveal + features (25–55%): Close-ups, feature demos, texture shots
  4. Social proof / results (55–75%): Before/after, testimonials, usage scenes
  5. Scarcity + CTA (75–100%): Limited time, price anchor, "点击下方"
  Tone: Urgent, authoritative, benefit-driven. Numbers and specifics win.

[TUTORIAL / 教程] Structure: Promise → Step-by-step → Recap → CTA
  1. Hook (0–3s): Result preview + skill level promise ("30秒学会...")
  2. Step 1–N (3–85%): Each step = 1 clip, clear visual + concise narration
  3. Recap flash (85–95%): Quick montage of all steps (0.5s each)
  4. CTA (95–100%): Follow for more, comment questions
  Tone: Clear, encouraging, zero fluff. Every word advances the learning.

[VLOG / 日常] Structure: Moment → Context → Journey → Reflection
  1. Hook (0–3s): The most emotionally charged or visually striking moment
  2. Setup (3–20%): Time, place, mood, why this matters
  3. Journey beats (20–80%): 3–5 key moments, varied pacing
  4. Reflection/resolution (80–100%): What was learned, felt, or changed
  Tone: Authentic, intimate, as if talking to a close friend.

[KNOWLEDGE / 知识科普] Structure: Question → Evidence → Insight → Mind-blow
  1. Hook (0–3s): Surprising fact or question that challenges assumption
  2. Context (3–20%): Why this matters, what people usually think
  3. Evidence chain (20–75%): 3–4 supporting clips, each = one data point
  4. Mind-blow moment (75–90%): The "aha" insight that changes perspective
  5. Engagement bait (90–100%): "你觉得呢?" / "评论区告诉我"
  Tone: Curious, intelligent but accessible, slightly conspiratorial.

[EMOTIONAL / 情感故事] Structure: Mood → Build → Breakthrough → Resonance
  1. Hook (0–3s): Emotional anchor — a face, a moment, a detail that carries feeling
  2. Buildup (3–60%): Layered details, slow pacing, letting emotions breathe
  3. Breakthrough (60–85%): The emotional peak — revelation, realization, release
  4. Resonance ending (85–100%): Universal truth that echoes in viewer's life
  Tone: Gentle, spacious, unhurried. Narration should have breathing room. Use longer clips (4–6s).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. VISUAL DIVERSITY RULES (Shot Type Mixing)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Shot type variety directly impacts perceived production quality:
• Never place two extreme close-ups back-to-back (disorienting)
• Never place two wide shots back-to-back without a detail shot between (feels floaty)
• Ideal pattern: Wide (establish) → Medium (context) → Close-up (detail) → Medium → Wide
• Insert at least one detail/close-up shot every 3–4 clips (texture, hands, eyes, product)
• When switching between different source videos, the first clip should establish the new context
• Motion variety: alternate between static shots and moving shots — 3 static in a row = boring

Quality tier mixing strategy:
• "优质"(premium): Use for hooks, climax moments, product close-ups, money shots — ~40% of clips
• "可用"(usable): Use for context, transitions, supporting B-roll — ~50% of clips
• "一般"(average): Use sparingly, max 1–2 clips, keep them short (<2s), only when no alternative

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. NARRATION CRAFT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Per-segment narration length (characters):
• Hook clips: 5–12 chars (short, punchy)
• Standard information: 15–25 chars
• Emotional pause / climax: 10–18 chars (let the visuals breathe)
• CTA / ending: 8–15 chars

Writing techniques:
• Lead with emotion or benefit, not description
• Use specific numbers over vague claims ("降价300元" not "大幅降价")
• Plant curiosity gaps: make the viewer NEED to see the next clip
• Rhythmic patterns: short-short-LONG-short creates musicality
• NEVER say "我们可以看到..." / "这里有一个..." — these are visual description crutches

noAudio/subtitle-only mode writing:
• Text IS the voiceover — it must carry ALL information since there's no spoken audio
• Each narration segment should be self-contained (viewers can't hear context from previous subtitle)
• Use emoji and punctuation for emotional cues: "！" for excitement, "……" for suspense, "？" for curiosity
• Subtitle text should be slightly MORE expressive than voiceover text (compensating for lack of tone)
• Avoid long sentences that require 3+ seconds to read — split into multiple clips if needed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. RHYTHM & DURATION CALCULATOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Clip count planning (MATCH THIS):
• Target 30s video: 8–12 clips
• Target 45s video: 10–15 clips
• Target 60s video: 12–18 clips
• Target 90s video: 15–22 clips

Per-clip duration guardrails:
• Hook zone clips: 0.8–2.5s
• Fast information: 1.5–3.0s
• Standard rhythm: 2.5–4.0s
• Emotional / slow: 3.5–6.0s
• Product detail showcase: 2.0–3.5s
• NEVER exceed 8s for any single clip
• At least 40% of clips should be under 3s (maintains energy)

Transition rhythm rules:
• >60% of transitions should be "cut" (hard cut) — this is the default, never overuse fancy transitions
• Use "fadeblack"/"fadewhite" ONLY at major section breaks (max 1–2 per video)
• Use "dissolve"/"fade"/"distance" for emotional transitions or time jumps (max 2–3 per video)
• Use "slide*" or "smooth*" for energetic montage sequences (smooth* is softer/eased)
• Use "cover*"/"reveal*" for clean scene swaps (cover = new clip slides in over old; reveal = old slides away)
• Use "wipe*" (incl. corner wipetl/tr/bl/br) and "diag*" for snappy directional cuts
• Use "circleopen/close", "circlecrop", "rectcrop", "horzopen/close", "vertopen/close" sparingly for stylized reveals
• "zoomin" for product reveal or emphasis; "pixelize"/"hblur"/"radial"/"squeezeh"/"squeezev" are special-effect transitions — at most 1 per video, only when the style truly calls for it
• Never use the same non-cut transition twice in a row — variety signals quality
• Match transition energy to content: calm/emotional → fade/dissolve/smooth; energetic/product → cut/slide/zoomin/wipe

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. FOOTAGE USAGE CONSTRAINTS (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Same videoIndex: max 3 appearances in entire video
• Same videoIndex: NEVER consecutive (minimum 2 other clips between appearances)
• Same exact time range: NEVER reuse (even across different clips)
• Shaky/blurry clips: max 1.5s per clip, max 2 total in video
• Each clip MUST use a time range that exists in the scene descriptions provided
• Do NOT fabricate time ranges — if a scene says 2.5–7.0s, clip must be within that range
• When multiple sources are available, distribute clip selection across as many as possible

muteOriginal decision:
• Product promo / talking-head / explainer → TRUE (original audio = interference)
• Short drama / interview / documentary / live performance → FALSE (original audio = value)
• When noAudio mode → ALWAYS true (no exceptions)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. OUTPUT FORMAT (JSON ONLY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "title": "Engaging Chinese title under 15 chars — suspense, numbers, or strong emotion",
  "script": "ALL narration segments concatenated in order — the complete 'voiceover' text",
  "clips": [
    {
      "videoIndex": 0,
      "startTime": 2.5,
      "endTime": 5.0,
      "narration": "Subtitle/voiceover text for this clip in Chinese",
      "transition": "cut",
      "transitionDuration": 0.4
    }
  ],
  "muteOriginal": true
}

videoIndex = 0-based index into the provided footage list.
startTime/endTime = precise to 0.1 seconds, extracted from scene descriptions.
transition = only meaningful from clip[1] onward (first clip's transition is ignored).`;

  const result = await getDeepSeek().chat.completions.create({
    model: ENV.deepseekModel,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          `[Creative Request] ${prompt}\n` +
          (creativeBrief ? `[Creative Brief] ${creativeBrief}\n` : "") +
          `[Topic] ${topic}\n` +
          `[Style] ${style}\n` +
          `[Target Duration] ${targetDuration}s (allow ±10s)\n` +
          (noAudio
            ? `[IMPORTANT: No-Voiceover Mode] User does NOT want voiceover. The "narration" field should contain subtitle copy (15-30 chars each). muteOriginal MUST be true. Generate enough clips to cover the target duration — minimum 6 clips, ideally 8+. The text in each narration will be burned as on-screen subtitles.\n`
            : "") +
          `\n[Available Footage Details]\n${sceneDetails}\n\n` +
          `⚠️ STRICT: Follow all footage usage constraints — same videoIndex max 3 uses, never consecutive. Output ONLY valid JSON.`,
      },
    ],
  });

  const content = result.choices[0]?.message?.content;
  if (!content) throw new Error("LLM 返回格式异常");
  console.log("[Phase2] DeepSeek 原始返回(前500字):", content.slice(0, 500));
  const parsed = parseJsonResponse(content) as ScriptResult;
  console.log(`[Phase2] 解析结果: title="${parsed.title}", script=${(parsed.script || "").length}字, clips=${(parsed.clips || []).length}个, muteOriginal=${parsed.muteOriginal}`);
  if (parsed.clips) {
    parsed.clips.forEach((c, i) =>
      console.log(`  clip[${i}]: vid=${c.videoIndex}, ${c.startTime}-${c.endTime}s, narration="${(c.narration || "").slice(0, 40)}"`)
    );
  }
  return parsed;
}

// ====== Phase 2-Edit: diff 式迭代修改（基于上一版方案做最小改动）======

type PlanDiffOp =
  | { op: "modify_narration"; index: number; narration: string }
  | { op: "replace_clip"; index: number; clip: Partial<ScriptClip> }
  | { op: "delete_clip"; index: number }
  | { op: "insert_clip"; afterIndex: number; clip: ScriptClip }
  | { op: "change_transition"; index: number; transition: TransitionType; transitionDuration?: number }
  | { op: "set_title"; title: string }
  | { op: "set_mute"; muteOriginal: boolean };

interface PlanDiff {
  operations: PlanDiffOp[];
  /** LLM 对本次修改的简述，便于回显给用户 */
  summary?: string;
}

/**
 * 纯函数：把 diff 操作合并回上一版方案，产出新方案。
 * 容错：非法 index 的操作直接跳过（不抛错），保证迭代不会因单条非法操作整体失败。
 * 注意：所有 index 基于「原始方案」的下标；insert/delete 在最后统一结算，避免下标漂移。
 */
function applyPlanDiff(prev: ScriptResult, diff: PlanDiff): ScriptResult {
  const clips: ScriptClip[] = prev.clips.map((c) => ({ ...c }));
  let title = prev.title;
  let muteOriginal = prev.muteOriginal;

  // 先处理就地修改类操作（不改变数组长度）
  const inserts: Array<{ afterIndex: number; clip: ScriptClip }> = [];
  const deleteIdx = new Set<number>();

  for (const op of diff.operations || []) {
    switch (op.op) {
      case "set_title":
        if (op.title?.trim()) title = op.title.trim();
        break;
      case "set_mute":
        if (typeof op.muteOriginal === "boolean") muteOriginal = op.muteOriginal;
        break;
      case "modify_narration":
        if (clips[op.index]) clips[op.index].narration = op.narration ?? clips[op.index].narration;
        break;
      case "change_transition":
        if (clips[op.index]) {
          clips[op.index].transition = op.transition;
          if (op.transitionDuration != null) clips[op.index].transitionDuration = op.transitionDuration;
        }
        break;
      case "replace_clip":
        if (clips[op.index] && op.clip) clips[op.index] = { ...clips[op.index], ...op.clip };
        break;
      case "delete_clip":
        if (clips[op.index]) deleteIdx.add(op.index);
        break;
      case "insert_clip":
        if (op.clip) inserts.push({ afterIndex: op.afterIndex, clip: op.clip });
        break;
    }
  }

  // 结算删除 + 插入（按原始下标，从后往前避免漂移）
  let next: ScriptClip[] = clips.filter((_, i) => !deleteIdx.has(i));
  // 插入：afterIndex 指原始下标，映射到当前数组位置（被删的算到其后）
  const sortedInserts = [...inserts].sort((a, b) => b.afterIndex - a.afterIndex);
  for (const ins of sortedInserts) {
    // 计算原始 afterIndex 之前还剩多少个未删除 clip
    let pos = 0;
    for (let i = 0; i <= ins.afterIndex && i < clips.length; i++) {
      if (!deleteIdx.has(i)) pos++;
    }
    next.splice(pos, 0, ins.clip);
  }

  // 兜底：全删空了 → 退回原方案，避免产出空时间轴
  if (next.length === 0) next = clips;

  return { title, script: prev.script, clips: next, muteOriginal };
}

const PLAN_DIFF_SCHEMA = {
  name: "plan_diff",
  schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "用一句话概括本次修改（中文）" },
      operations: {
        type: "array",
        description: "对上一版方案的最小修改操作列表。只改用户点名的部分，其余保持不动。",
        items: {
          type: "object",
          properties: {
            op: {
              type: "string",
              enum: ["modify_narration", "replace_clip", "delete_clip", "insert_clip", "change_transition", "set_title", "set_mute"],
            },
            index: { type: "number", description: "目标片段下标（基于上一版方案，从0开始）。insert_clip 不用此字段" },
            afterIndex: { type: "number", description: "仅 insert_clip：插入到此下标之后（-1 表示插到最前）" },
            narration: { type: "string", description: "仅 modify_narration：新的配音文本" },
            transition: { type: "string", description: "仅 change_transition：新转场类型" },
            transitionDuration: { type: "number", description: "仅 change_transition：转场时长(秒)" },
            title: { type: "string", description: "仅 set_title：新标题" },
            muteOriginal: { type: "boolean", description: "仅 set_mute：是否静音原声" },
            clip: {
              type: "object",
              description: "仅 replace_clip/insert_clip：片段内容",
              properties: {
                videoIndex: { type: "number" },
                startTime: { type: "number" },
                endTime: { type: "number" },
                narration: { type: "string" },
                transition: { type: "string" },
                transitionDuration: { type: "number" },
              },
            },
          },
          required: ["op"],
        },
      },
    },
    required: ["operations"],
  },
};

/**
 * 基于上一版方案 + 用户修改指令，生成 diff（最小修改）。
 * 失败时抛错，调用方可降级为整份重写。
 */
async function phase2EditPlan(
  editInstruction: string,
  prevPlan: ScriptResult,
  selectedVideos: VideoSummary[],
  selectedVideoIds: number[],
): Promise<PlanDiff> {
  const sceneDetails = selectedVideos
    .map((v) => {
      const vidx = selectedVideoIds.indexOf(v.id);
      const scenes = (v.scenes || [])
        .map((s) => `    [${s.startTime.toFixed(1)}s → ${s.endTime.toFixed(1)}s] ${s.description}`)
        .join("\n");
      return `[Index:${vidx} | ID:${v.id}] ${v.fileName} (duration:${v.duration?.toFixed(1) ?? "?"}s)\n  scenes:\n${scenes}`;
    })
    .join("\n\n");

  const prevClipsDesc = prevPlan.clips
    .map(
      (c, i) =>
        `  #${i}: source[${c.videoIndex}] ${c.startTime.toFixed(1)}-${c.endTime.toFixed(1)}s` +
        ` | transition:${c.transition || "cut"} | narration:"${c.narration}"`
    )
    .join("\n");

  const systemPrompt = `You are a precise video editing assistant. The user already has an editing plan and wants to make a SPECIFIC, MINIMAL change to it. Your job is to output ONLY the diff operations needed — DO NOT rewrite the whole plan.

━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━
• Change ONLY what the user explicitly asked for. Leave every other clip exactly as-is.
• If the user says "change the opening", only touch clip #0 (and maybe #1). Do NOT modify clips the user didn't mention.
• All "index" values refer to the PREVIOUS plan's clip indices (0-based).
• Prefer the smallest operation: to change narration use modify_narration; to swap footage use replace_clip; only use delete/insert when the user wants to add/remove a segment.
• When replacing or inserting a clip, pick footage from the available list below. videoIndex must be a valid index.
• Keep total operations minimal. An empty operations array is valid if nothing needs to change.

Output strict JSON matching the schema. No extra text.`;

  const result = await getDeepSeek().chat.completions.create({
    model: ENV.deepseekModel,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          `[User's modification request] ${editInstruction}\n\n` +
          `[Current plan] title="${prevPlan.title}", muteOriginal=${prevPlan.muteOriginal}\n` +
          `[Current clips]\n${prevClipsDesc}\n\n` +
          `[Available footage]\n${sceneDetails}\n\n` +
          `Output the minimal diff operations to satisfy the request. Follow the schema:\n${JSON.stringify(PLAN_DIFF_SCHEMA.schema)}`,
      },
    ],
  });

  const content = result.choices[0]?.message?.content;
  if (!content) throw new Error("迭代修改 LLM 返回为空");
  const parsed = parseJsonResponse(content) as PlanDiff;
  if (!parsed || !Array.isArray(parsed.operations)) {
    throw new Error("迭代修改返回格式异常（缺少 operations）");
  }
  console.log(`[Phase2Edit] diff: ${parsed.operations.length} 个操作, summary="${parsed.summary || ""}"`);
  return parsed;
}



async function generateTtsAudio(
  script: string,
  voiceId: string,
  speed: number,
  taskId: number
): Promise<string> {
  ensureDirs();

  const safeSpeed = clamp(Number(speed) || 1.0, 0.5, 2.0);
  const forwardResult = await submitGatewayTask("audio_tts", {
    text: script,
    voice_id: voiceId,
    speed: safeSpeed,
    vol: "1.0",
  });

  if (!forwardResult.success) {
    throw new Error("提交 TTS 任务失败");
  }

  const ttsResult = await waitForGatewayTask(forwardResult.data.taskId);

  if (!ttsResult.resultUrl) {
    throw new Error("TTS 未返回音频文件");
  }

  let audioUrl = ttsResult.resultUrl;
  if (audioUrl.startsWith("/")) {
    audioUrl = ENV.gatewayBaseUrl.replace(/\/$/, "") + audioUrl;
  }

  const audioExt = path.extname(audioUrl.split("?")[0]) || ".mp3";
  const audioPath = path.join(AUDIO_DIR, `tts_${taskId}${audioExt}`);

  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) throw new Error("下载 TTS 音频失败");
  const audioBuffer = Buffer.from(await audioResp.arrayBuffer());
  fs.writeFileSync(audioPath, audioBuffer);

  return audioPath;
}

// ====== Whisper 转写 TTS 音频获取精确字幕时间戳 ======

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

async function transcribeTtsAudio(audioPath: string): Promise<WhisperSegment[]> {
  try {
    const segments = await transcribeAudio(audioPath);
    return segments.map((seg) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text,
    }));
  } catch (error) {
    console.warn("[AI Creator] 火山 ASR 转写失败:", String(error));
  }
  return [];
}

/**
 * 用 Whisper 分段时间戳修正 clip 时长，使视频时间轴与音频对齐。
 * 阶段：TTS 后 → 剪辑前调用。
 */
function adjustClipsToAudio(
  clips: ScriptClip[],
  segments: WhisperSegment[],
): ScriptClip[] {
  if (segments.length === 0) return clips;

  const totalAudioDuration = segments[segments.length - 1].end;
  if (totalAudioDuration <= 0) return clips;

  const fullWhisperText = segments.map((s) => s.text).join("");
  const cleanWhisper = fullWhisperText.replace(/\s/g, "");

  const adjusted = clips.map((c) => ({ ...c }));

  // 累积 Whisper 文本中每个字符的时间偏移，用于将文本位置映射回时间
  const charTimeMap: Array<{ pos: number; time: number; segIdx: number }> = [];
  let charCount = 0;
  for (let i = 0; i < segments.length; i++) {
    const clean = segments[i].text.replace(/\s/g, "");
    charTimeMap.push({ pos: charCount, time: segments[i].start, segIdx: i });
    charCount += clean.length;
  }
  charTimeMap.push({ pos: charCount, time: totalAudioDuration, segIdx: segments.length - 1 });

  function charPosToTime(pos: number): number {
    for (let i = charTimeMap.length - 1; i >= 0; i--) {
      if (pos >= charTimeMap[i].pos) {
        if (i === charTimeMap.length - 1) return charTimeMap[i].time;
        const frac =
          (pos - charTimeMap[i].pos) /
          Math.max(1, charTimeMap[i + 1].pos - charTimeMap[i].pos);
        return charTimeMap[i].time + frac * (charTimeMap[i + 1].time - charTimeMap[i].time);
      }
    }
    return 0;
  }

  let searchPos = 0;
  for (let i = 0; i < adjusted.length; i++) {
    const cleanNar = adjusted[i].narration.replace(/\s/g, "");
    if (!cleanNar) continue;

    const idx = cleanWhisper.indexOf(cleanNar, searchPos);
    if (idx >= 0) {
      searchPos = idx + cleanNar.length;
      const audioStart = charPosToTime(idx);
      const audioEnd = charPosToTime(idx + cleanNar.length);
      const audioDuration = audioEnd - audioStart;
      if (audioDuration > 0.2) {
        // 留白保护：TTS 短于原片段时保留原时长给原声留白
        const origDuration = adjusted[i].endTime - adjusted[i].startTime;
        const finalDuration = audioDuration < origDuration ? origDuration : audioDuration;
        adjusted[i].endTime = adjusted[i].startTime + finalDuration;
      }
    }
  }

  return adjusted;
}

function srtFromWhisperSegments(segments: WhisperSegment[]): string {
  return segments
    .map((seg, i) => {
      const fmt = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        const ms = Math.floor((s % 1) * 1000);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
      };
      return `${i + 1}\n${fmt(seg.start)} --> ${fmt(seg.end)}\n${seg.text}\n`;
    })
    .join("\n");
}

// ====== Phase 4: 剪辑 + 合成 ======

async function executeEditPlan(
  taskId: number,
  clips: ScriptClip[],
  selectedVideoIds: number[],
  muteOriginal: boolean,
  audioPath: string | null
): Promise<string> {
  ensureDirs();

  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 1. 按剪辑计划逐段 trim
  const segmentPaths: string[] = [];
  console.log(`[EditPlan] 开始处理 ${clips.length} 个片段...`);
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const videoId = selectedVideoIds[clip.videoIndex];
    if (!videoId) throw new Error(`片段 ${i} 引用了无效的视频序号: ${clip.videoIndex}`);

    const rows = await db
      .select({ filePath: videos.filePath })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1);

    if (rows.length === 0) throw new Error(`视频 ${videoId} 不存在`);
    const videoPath = rows[0].filePath;
    if (!fs.existsSync(videoPath)) throw new Error(`视频文件不存在: ${videoPath}`);

    const startStr = formatTime(clip.startTime);
    const endStr = formatTime(clip.endTime);
    const segPath = path.join(OUTPUT_DIR, `creator_seg_${taskId}_${i}.mp4`);

    console.log(`[EditPlan] 片段${i}: 视频${videoId} ${startStr}-${endStr}, "${clip.narration.slice(0, 30)}"`);
    await trimVideo(videoPath, segPath, startStr, endStr);
    console.log(`[EditPlan] 片段${i} trim 完成`);
    segmentPaths.push(segPath);
  }

  // 2. 收集相邻片段间的转场（clips[i].transition 表示从 i-1 → i）
  const transitions: SegmentTransition[] = [];
  for (let i = 1; i < clips.length; i++) {
    const t = clips[i].transition;
    transitions.push({
      type: (t || "fade") as TransitionType,
      duration: clips[i].transitionDuration,
    });
  }

  // 3. 合并所有片段（带转场，无转场或全 cut 时自动回退到无损 concat）
  const mergedPath = outputPath(taskId, "merged");
  const hasRealTransition = transitions.some((t) => t.type !== "cut");
  if (hasRealTransition) {
    try {
      await concatVideosWithTransitions(segmentPaths, mergedPath, transitions);
    } catch (e) {
      // 转场合并失败降级为无转场拼接（xfade 对输入流要求苛刻，concat 几乎不会失败）
      console.warn("[AI Creator] 转场合并失败，回退无转场拼接:", String(e));
      if (fs.existsSync(mergedPath)) fs.unlinkSync(mergedPath);
      await concatVideos(segmentPaths, mergedPath);
    }
  } else {
    await concatVideos(segmentPaths, mergedPath);
  }

  // 4. 清理临时片段文件
  for (const seg of segmentPaths) {
    if (fs.existsSync(seg)) fs.unlinkSync(seg);
  }

  // 5. 混入 TTS 音频（如果有）
  const finalPath = outputPath(taskId, "final");
  if (audioPath) {
    await mixAudio(mergedPath, audioPath, finalPath, muteOriginal);
  } else {
    await execAsync(`ffmpeg -i "${mergedPath}" -c copy "${finalPath}" -y`);
  }

  // 6. 清理中间合并文件
  if (fs.existsSync(mergedPath) && mergedPath !== finalPath) {
    fs.unlinkSync(mergedPath);
  }

  return finalPath;
}

async function mixAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  muteOriginal: boolean,
  bgmPath: string | null = null,
  bgmVolume: number = 0.15
): Promise<void> {
  const hasBgm = !!bgmPath && fs.existsSync(bgmPath);

  // 检测视频是否有音频
  let videoHasAudio = false;
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${videoPath}"`
    );
    videoHasAudio = !!stdout.trim();
  } catch { videoHasAudio = false; }

  if (!hasBgm) {
    if (muteOriginal || !videoHasAudio) {
      await execAsync(
        `ffmpeg -stream_loop -1 -i "${videoPath}" -i "${audioPath}" -map 0:v:0 -map 1:a:0 -c:v libx264 -preset fast -crf 23 -c:a aac -shortest "${outputPath}" -y`
      );
    } else {
      await execAsync(
        `ffmpeg -i "${videoPath}" -i "${audioPath}" -filter_complex "[1:a]volume=0.8[tts];[0:a][tts]amix=inputs=2:duration=longest" -c:v copy -c:a aac "${outputPath}" -y`
      );
    }
    return;
  }

  const vol = clamp(bgmVolume, 0.05, 0.5);
  if (muteOriginal || !videoHasAudio) {
    const filter =
      `[2:a]aloop=loop=-1:size=2e9,volume=${vol}[bgm0];` +
      `[bgm0][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[bgmd];` +
      `[1:a][bgmd]amix=inputs=2:duration=first:dropout_transition=2:weights=1.0 0.7[a]`;
    await execAsync(
      `ffmpeg -stream_loop -1 -i "${videoPath}" -i "${audioPath}" -i "${bgmPath}" ` +
      `-filter_complex "${filter}" -map 0:v:0 -map "[a]" ` +
      `-c:v libx264 -preset fast -crf 23 -c:a aac -shortest "${outputPath}" -y`
    );
  } else {
    const filter =
      `[2:a]aloop=loop=-1:size=2e9,volume=${vol}[bgm0];` +
      `[bgm0][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[bgmd];` +
      `[1:a]volume=0.9[tts2];` +
      `[0:a][tts2][bgmd]amix=inputs=3:duration=longest:dropout_transition=2[a]`;
    await execAsync(
      `ffmpeg -i "${videoPath}" -i "${audioPath}" -i "${bgmPath}" ` +
      `-filter_complex "${filter}" -map 0:v:0 -map "[a]" ` +
      `-c:v copy -c:a aac "${outputPath}" -y`
    );
  }
}

/**
 * 视频静音 / 仅 BGM 场景。把无 TTS 的视频 + BGM 混合到一起。
 */
async function mixBgmOnly(
  videoPath: string,
  outputPath: string,
  bgmPath: string,
  bgmVolume: number,
  muteOriginal: boolean
): Promise<void> {
  const vol = clamp(bgmVolume, 0.05, 0.6);

  let hasAudio = false;
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${videoPath}"`,
      { timeout: 5000 }
    );
    hasAudio = !!stdout.trim();
  } catch { hasAudio = false; }

  console.log(`[mixBgmOnly] hasAudio=${hasAudio}, muteOriginal=${muteOriginal}`);
  if (!hasAudio || muteOriginal) {
    console.log("[mixBgmOnly] BGM 单独音轨模式");
    await execAsync(
      `ffmpeg -stream_loop -1 -i "${bgmPath}" -i "${videoPath}" -filter_complex "[0:a]volume=${vol}[bgm]" -map 1:v -map "[bgm]" -c:v copy -c:a aac -shortest "${outputPath}" -y`,
      { timeout: 120000 }
    );
  } else {
    console.log("[mixBgmOnly] BGM + 原声混音模式");
    await execAsync(
      `ffmpeg -stream_loop -1 -i "${bgmPath}" -i "${videoPath}" -filter_complex "[0:a]volume=${vol}[bgm];[1:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[a]" -map 1:v -map "[a]" -c:v copy -c:a aac -shortest "${outputPath}" -y`,
      { timeout: 120000 }
    );
  }
  console.log("[mixBgmOnly] 完成");
}

/**
 * 把视频缩放到目标宽高，采用 cover / center-crop 模式：
 * 先放大到至少覆盖目标尺寸（保持原比例），再居中裁掉多余部分。
 */
async function applyAspectScale(
  inputPath: string,
  outputPath: string,
  width: number,
  height: number
): Promise<void> {
  await execAsync(
    `ffmpeg -i "${inputPath}" -vf "scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1" -c:v libx264 -preset medium -crf 23 -c:a copy "${outputPath}" -y`
  );
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ====== Phase 5: 字幕生成（基于剪辑计划，无需 ASR） ======

function generateSrtFromClips(clips: ScriptClip[]): string {
  let timeline = 0;
  const entries: Array<{ index: number; start: number; end: number; text: string }> = [];

  for (let i = 0; i < clips.length; i++) {
    const duration = clips[i].endTime - clips[i].startTime;
    if (duration <= 0) continue;

    let transDur = 0;
    if (i > 0) {
      const prevDuration = clips[i - 1].endTime - clips[i - 1].startTime;
      const transitionType = clips[i].transition || "fade";
      if (transitionType !== "cut") {
        const requested = clips[i].transitionDuration ?? 0.4;
        const maxAllowed = Math.max(0.1, Math.min(prevDuration / 2, duration / 2, 1.5));
        transDur = Math.min(Math.max(0.15, requested), maxAllowed);
      }
    }

    const start = Math.max(0, timeline - transDur);
    const end = start + duration;

    entries.push({ index: i + 1, start, end, text: clips[i].narration });
    timeline = timeline + duration - transDur;
  }

  return entries
    .map((e) => {
      const fmt = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        const ms = Math.floor((s % 1) * 1000);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
      };
      return `${e.index}\n${fmt(e.start)} --> ${fmt(e.end)}\n${e.text}\n`;
    })
    .join("\n");
}

async function burnSubtitlesToVideo(
  videoPath: string,
  srtContent: string,
  taskId: number,
  outputPath: string,
  style: SubtitleStyle = "default",
  config?: SubtitleConfig,
): Promise<void> {
  const SUBTITLE_DIR = path.resolve("uploads/subtitles");
  if (!fs.existsSync(SUBTITLE_DIR)) fs.mkdirSync(SUBTITLE_DIR, { recursive: true });

  const srtPath = path.join(SUBTITLE_DIR, `creator_sub_${taskId}.srt`);
  fs.writeFileSync(srtPath, srtContent, "utf-8");

  // Windows: 转义盘符冒号避免 FFmpeg 滤镜解析错误
  const safeSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const styleStr = subtitleStyleString(style, config);
  await execAsync(
    `ffmpeg -i "${videoPath}" -vf "subtitles='${safeSrt}':force_style='${styleStr}'" -c:v libx264 -preset medium -crf 23 -c:a aac "${outputPath}" -y`
  );
}

// ====== 审查 Agent ======

interface ReviewResult {
  score: number;          // 1-10
  scriptReview: string;   // 脚本评价
  clipReview: string;     // 片段匹配评价
  suggestions: string[];  // 改进建议
  riskWarnings: string[]; // 风险提示
}

async function reviewPlan(
  prompt: string,
  scriptResult: ScriptResult,
  autoConfig: AutoConfig | null,
): Promise<ReviewResult> {
  const clipsDesc = scriptResult.clips
    .map((c, i) =>
      `  Clip ${i + 1}: source[${c.videoIndex}] ${c.startTime.toFixed(1)}s→${c.endTime.toFixed(1)}s (${(c.endTime - c.startTime).toFixed(1)}s) | transition:${c.transition || "fade"} | narration: "${c.narration}"`
    )
    .join("\n");

  // Detect footage overuse
  const videoUsageCount: Record<number, number> = {};
  const consecutiveViolations: number[] = [];
  scriptResult.clips.forEach((c, i) => {
    videoUsageCount[c.videoIndex] = (videoUsageCount[c.videoIndex] || 0) + 1;
    if (i > 0 && scriptResult.clips[i - 1].videoIndex === c.videoIndex) {
      consecutiveViolations.push(i);
    }
  });
  const overusedVideos = Object.entries(videoUsageCount)
    .filter(([, count]) => count > 3)
    .map(([idx, count]) => `source[${idx}] used ${count}x`);

  const configDesc = autoConfig
    ? `aspect:${autoConfig.aspect} | resolution:${autoConfig.resolution} | voice:${autoConfig.voiceId} | speed:${autoConfig.speed} | BGM:${autoConfig.bgmMood}(vol ${autoConfig.bgmVolume}) | subtitles:${autoConfig.subtitlesEnabled ? (autoConfig.subtitlesBurnIn ? "burn-in(" + autoConfig.subtitleStyle + ")" : "SRT only") : "off"} | noAudio:${autoConfig.noAudio}`
    : "Manual config";

  const systemPrompt = `You are an experienced short-video quality director responsible for professionally reviewing AI-generated editing plans. Your review directly determines final video quality — be objective and strict, do not pass subpar work.

━━━━━━━━━━━━━━━━━━━━━━━
Review Dimensions (with weights)
━━━━━━━━━━━━━━━━━━━━━━━

[1. Request Alignment 30%]
• Does the plan truly understand user intent (not just template application)?
• Does the video type/style match the request?
• Is the target audience clear? Is the content appropriate?

[2. Script Quality 25%]
• Does the opening have a strong hook (can it capture attention in the first 3 seconds)?
• Is the narration conversational and rhythmic?
• Is information density appropriate (neither too dense nor empty)?
• Does the ending have closure or a clear call to action?

[3. Editing Plan Rationality 25%]
• Do clip durations match content pacing?
• Is the clip transition logic natural (visual continuity)?
• Are transition choices appropriate?
• Is total duration close to target?

[4. Footage Usage Compliance 20%]
• Is any single source overused (>3x = penalty)?
• Are there consecutive uses of the same source?
• Are there obvious time range conflicts (same source, same range used twice)?

━━━━━━━━━━━━━━━━━━━━━━━
Scoring Standards
━━━━━━━━━━━━━━━━━━━━━━━
• 9-10: Professional grade, ready to execute, near human-editor quality
• 7-8: Good, minor issues but overall solid, recommend execution
• 5-6: Average, clear problems exist, needs targeted improvement
• 3-4: Poor, core issues prominent, recommend regeneration
• 1-2: Unacceptable, complete rewrite needed

⚠️ STRICT: When scoring below 5, suggestions MUST include per-clip specific rewrite instructions (e.g. "Replace clip 3 with source[0] 2.5-5.0s, current shot is too long and repetitive"). Generic suggestions like "improve engagement" are UNACCEPTABLE.

━━━━━━━━━━━━━━━━━━━━━━━
Output Format (strict JSON, no extra text)
━━━━━━━━━━━━━━━━━━━━━━━
{
  "score": 8,
  "scriptReview": "Script quality assessment in Chinese, under 60 chars — highlight the biggest strength and the biggest issue",
  "clipReview": "Editing plan assessment in Chinese, under 60 chars — point out the core pacing/footage usage issues",
  "suggestions": [
    "Specific actionable suggestion in Chinese (e.g. replace clip 3 with source[0] 2.5-5.0s, current shot is too long and repetitive)",
    "Another specific suggestion"
  ],
  "riskWarnings": [
    "Risk warning in Chinese (e.g. source[2] used 4x exceeds limit; clip 1 transition mismatch with content style)"
  ]
}`;

  const result = await getDeepSeek().chat.completions.create({
    model: ENV.deepseekModel,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          `[User Request] ${prompt}\n\n` +
          `[Production Config] ${configDesc}\n\n` +
          `[Video Title] ${scriptResult.title}\n` +
          `[Full Script] ${scriptResult.script}\n\n` +
          `[Editing Plan] ${scriptResult.clips.length} clips, muteOriginal=${scriptResult.muteOriginal}\n${clipsDesc}\n\n` +
          (overusedVideos.length ? `⚠️ Detected footage overuse: ${overusedVideos.join(", ")}\n` : "") +
          (consecutiveViolations.length ? `⚠️ Detected consecutive same-source clips: #${consecutiveViolations.map((i) => i + 1).join(", ")}\n` : "") +
          `\nPlease review objectively and provide a score.`,
      },
    ],
  });

  const content = result.choices[0]?.message?.content;
  if (!content) {
    return { score: 5, scriptReview: "Review agent returned empty", clipReview: "", suggestions: [], riskWarnings: [] };
  }

  const parsed = parseJsonResponse(content);
  return {
    score: Math.min(10, Math.max(1, Number(parsed.score) || 5)),
    scriptReview: String(parsed.scriptReview || ""),
    clipReview: String(parsed.clipReview || ""),
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    riskWarnings: Array.isArray(parsed.riskWarnings) ? parsed.riskWarnings : [],
  };
}

// ====== 任务处理器 ======

async function runAiVideoCreator(
  task: ProcessingTask,
  updateProgress: (progress: number) => Promise<void>
): Promise<Record<string, unknown>> {
  const params = (task.parameters || {}) as AiCreatorParams;
  const hasApproved = !!params.approvedPlan;
  const isIterate = !!params.previousPlan && !!params.editInstruction;
  console.log(`[AI Creator] ====== 任务 ${task.id} 开始 ======`);
  console.log(`[AI Creator] prompt: "${(params.prompt || "").slice(0, 80)}", approvedPlan=${hasApproved}, iterate=${isIterate}, autoMode=${params.autoMode}`);

  // 迭代模式用 editInstruction 驱动，prompt 可空；其余模式必须有 prompt
  if (!isIterate && (!params.prompt || params.prompt.trim().length === 0)) {
    throw new Error("请提供创作需求描述");
  }

  console.log("[AI Creator] updateProgress(3)...");
  await updateProgress(3);
  console.log("[AI Creator] updateProgress(3) done");

  // 1. 查询用户已分析的视频
  console.log("[AI Creator] 查询已分析视频...");
  const videoSummaries = await getAnalyzedVideos(task.userId, params.projectId);
  console.log(`[AI Creator] 找到 ${videoSummaries.length} 个已分析视频`);
  if (videoSummaries.length === 0) {
    throw new Error("没有已分析的视频素材，请先上传视频并完成 AI 分析后再进行创作");
  }

  await updateProgress(8);

  // 2. Phase 0: AI 自动决策（用户确认/迭代时跳过，参数从上一版继承）
  const isAuto = params.autoMode !== false;
  let autoConfig: AutoConfig | null = null;
  if (isAuto && !params.approvedPlan && !isIterate) {
    console.log("[AI Creator] Phase 0: 自动决策...");
    autoConfig = await phase0AutoConfig(params.prompt);
  } else if (params.approvedPlan) {
    console.log("[AI Creator] Phase 0: 跳过（用户已确认，参数从审查阶段继承）");
  } else if (isIterate) {
    console.log("[AI Creator] Phase 0: 跳过（迭代模式，参数从上一版继承）");
  }

  // 用户显式覆盖优先于自动决策
  const finalVoiceId = params.voiceId || autoConfig?.voiceId || "female-chengshu";
  const finalSpeed = clamp(params.speed ?? autoConfig?.speed ?? 1.0, 0.5, 2.0);
  const finalAspect: AspectRatio = params.aspect || autoConfig?.aspect || "9:16";
  const finalResolution: ResolutionTier = params.resolution || autoConfig?.resolution || "1080p";
  const finalSubtitleStyle: SubtitleStyle = params.subtitleStyle || autoConfig?.subtitleStyle || "default";
  let finalBgmMood: BgmMood = params.bgmMood || autoConfig?.bgmMood || "none";
  const finalBgmVolume = params.bgmVolume ?? autoConfig?.bgmVolume ?? 0.15;

  // 用户提示里明确要求 BGM 但 LLM 返回了 "none" → 兜底选 upbeat
  if (
    finalBgmMood === "none" &&
    /(?:bgm|背景音乐|配乐|音乐|加个bgm|加点bgm|来点bgm)/i.test(params.prompt)
  ) {
    finalBgmMood = "upbeat";
  }

  const noAudio = params.noAudio || autoConfig?.noAudio || false;
  // muteOriginalOverride：用户在 prompt 里明确要求原声静音
  const muteOriginalOverride = params.muteOriginalOverride === true;
  if (noAudio || muteOriginalOverride) {
    console.log(`[AI Creator] noAudio=${noAudio}, muteOriginalOverride=${muteOriginalOverride} → 强制 muteOriginal=true`);
  }

  // 字幕开关
  const subtitlesEnabled = params.subtitles
    ? !!params.subtitles.enabled
    : autoConfig?.subtitlesEnabled ?? true;
  let subtitlesBurnIn = params.subtitles
    ? !!params.subtitles.burnIn
    : autoConfig?.subtitlesBurnIn ?? true;
  if (noAudio && subtitlesEnabled) {
    subtitlesBurnIn = true;
  }

  await updateProgress(12);

  // 3. Phase 1: LLM 理解意图 + 选择视频（确认/迭代时跳过）
  console.log("[AI Creator] Phase 1: 意图分析...");
  let intent: IntentResult;
  if (params.approvedPlan) {
    console.log("[AI Creator] Phase 1: 跳过（用户已确认）");
    intent = {
      topic: "",
      style: "",
      targetDuration: 30,
      selectedVideoIds: [],
      reasoning: "用户已确认方案",
    };
  } else if (isIterate) {
    console.log("[AI Creator] Phase 1: 跳过（迭代模式，沿用上一版选材）");
    intent = {
      topic: "",
      style: "",
      targetDuration: 30,
      selectedVideoIds: params.previousPlan!.selectedVideoIds,
      reasoning: "迭代修改：沿用上一版选中素材",
    };
  } else {
    intent = await phase1Intent(params.prompt, videoSummaries);
    if (intent.selectedVideoIds.length === 0) {
      throw new Error(`AI 未找到合适的视频素材。${intent.reasoning}`);
    }
    // 硬性兜底：素材库充足但选太少 → 自动补足
    const totalAvailable = videoSummaries.length;
    const selected = intent.selectedVideoIds.length;
    const minExpected = totalAvailable >= 10 ? 5 : totalAvailable >= 5 ? 4 : Math.min(3, totalAvailable);
    if (selected < minExpected) {
      console.log(`[AI Creator] Phase 1 仅选 ${selected}/${totalAvailable} 个素材，自动补足至 ${minExpected}...`);
      const allIds = new Set(intent.selectedVideoIds);
      for (const v of videoSummaries) {
        if (allIds.size >= minExpected) break;
        if (!allIds.has(v.id)) allIds.add(v.id);
      }
      intent.selectedVideoIds = Array.from(allIds);
    }
  }

  // Phase 1 的建议覆盖 autoConfig 的默认值
  if (intent.suggestedBgm && finalBgmMood === "none") {
    finalBgmMood = intent.suggestedBgm as BgmMood;
    console.log(`[AI Creator] Phase 1 建议 BGM=${finalBgmMood}，覆盖默认 none`);
  }
  if (intent.suggestedMute !== undefined && !params.noAudio) {
    console.log(`[AI Creator] Phase 1 建议 muteOriginal=${intent.suggestedMute}`);
  }

  await updateProgress(22);

  // selectedVideoIds 必须与 review 阶段返回的子集完全一致，才能让 clips.videoIndex 正确对齐。
  // approvedPlan 继续渲染时使用前端回传的子集；缺失则报错（绝不退回全集——那正是剪错素材的根因）。
  let selectedVideoIds: number[];
  if (params.approvedPlan) {
    if (!params.selectedVideoIds || params.selectedVideoIds.length === 0) {
      throw new Error("继续渲染缺少 selectedVideoIds（方案确认时需回传 review 阶段的选中子集）");
    }
    selectedVideoIds = params.selectedVideoIds;
  } else if (isIterate) {
    selectedVideoIds = params.previousPlan!.selectedVideoIds;
    if (!selectedVideoIds || selectedVideoIds.length === 0) {
      throw new Error("迭代修改缺少上一版选中素材");
    }
  } else {
    selectedVideoIds = intent.selectedVideoIds;
  }
  const selectedVideos = videoSummaries.filter((v) => selectedVideoIds.includes(v.id));

  // 4. Phase 2: 脚本 + 剪辑计划（确认→用已审批方案；迭代→diff 合并；否则全新生成）
  console.log("[AI Creator] Phase 2: 脚本生成...");
  let scriptResult: ScriptResult;
  let iterateSummary: string | null = null;
  if (params.approvedPlan) {
    console.log("[AI Creator] Phase 2: 跳过（使用已审批方案）");
    scriptResult = params.approvedPlan;
    scriptResult.clips = scriptResult.clips.map((c) => ({
      ...c,
      videoIndex: c.videoIndex < selectedVideoIds.length ? c.videoIndex : 0,
    }));
  } else if (isIterate) {
    const prevPlan: ScriptResult = {
      title: params.previousPlan!.title,
      script: params.previousPlan!.script,
      clips: params.previousPlan!.clips,
      muteOriginal: params.previousPlan!.muteOriginal,
    };
    try {
      console.log(`[AI Creator] Phase 2: diff 迭代，指令="${params.editInstruction}"`);
      const diff = await phase2EditPlan(params.editInstruction!, prevPlan, selectedVideos, selectedVideoIds);
      scriptResult = applyPlanDiff(prevPlan, diff);
      iterateSummary = diff.summary || null;
      // 合并后兜底校验 videoIndex 越界
      scriptResult.clips = scriptResult.clips.map((c) => ({
        ...c,
        videoIndex: c.videoIndex >= 0 && c.videoIndex < selectedVideoIds.length ? c.videoIndex : 0,
      }));
    } catch (e) {
      console.warn("[AI Creator] diff 迭代失败，降级为沿用上一版方案 + 提示词重写:", String(e));
      scriptResult = await phase2Script(
        `${params.previousPlan!.script}\n\n【用户要求修改】${params.editInstruction}`,
        intent.topic,
        intent.style,
        30,
        selectedVideos,
        selectedVideoIds,
        undefined,
        noAudio,
      );
    }
  } else {
    scriptResult = await phase2Script(
      params.prompt,
      intent.topic,
      intent.style,
      intent.targetDuration,
      selectedVideos,
      selectedVideoIds,
      intent.creativeBrief,
      noAudio,
    );
  }

  await updateProgress(30);
  await updateProgress(35);

  // 审查 Agent 的结果，带到最终成品里展示 AI 自评分（极速模式也保留）
  let planReview: { score: number; scriptReview: string; clipReview: string; suggestions: string[]; riskWarnings: string[] } | null = null;

  // 审查 Agent：仅在首次生成时运行（用户确认/迭代后跳过，避免覆盖结果或卡住）
  if (!params.approvedPlan && !isIterate) {
    let review = await reviewPlan(params.prompt, scriptResult, autoConfig);
    let retryCount = 0;

    while (review.score < 5 && retryCount < 2) {
      retryCount++;
      console.log(`[AI Creator] 审查仅 ${review.score} 分，自动重试第 ${retryCount} 次...`);
      const enhancedPrompt =
        `${params.prompt}\n\n` +
        `【上次方案不通过，评分${review.score}/10，必须改进以下问题】\n` +
        review.suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n") +
        (review.riskWarnings.length
          ? `\n【风险警告（必须修正）】\n` + review.riskWarnings.map((w) => `• ${w}`).join("\n")
          : "");
      scriptResult = await phase2Script(
        enhancedPrompt,
        intent.topic,
        intent.style,
        intent.targetDuration,
        selectedVideos,
        selectedVideoIds,
        intent.creativeBrief,
      );
      review = await reviewPlan(params.prompt, scriptResult, autoConfig);
      console.log(`[AI Creator] 重试后评分: ${review.score}/10`);
    }

    planReview = {
      score: review.score,
      scriptReview: review.scriptReview,
      clipReview: review.clipReview,
      suggestions: review.suggestions,
      riskWarnings: review.riskWarnings,
    };

    // 方案确认模式（planOnly=true）：停在 review，返回方案让用户确认/微调。
    // 极速一键模式（planOnly 缺省/false）：不中断，带着已审查的方案继续 Phase 3-5。
    if (params.planOnly) {
      return {
        phase: "review",
        title: scriptResult.title,
        script: scriptResult.script,
        clips: scriptResult.clips.map((c) => ({
          videoIndex: c.videoIndex,
          startTime: c.startTime,
          endTime: c.endTime,
          narration: c.narration,
          transition: c.transition || "fade",
          transitionDuration: c.transitionDuration ?? 0.4,
        })),
        muteOriginal: scriptResult.muteOriginal,
        review: planReview,
        topic: intent.topic,
        style: intent.style,
        selectedVideoIds: selectedVideoIds,
        voiceId: finalVoiceId,
        speed: finalSpeed,
        aspect: finalAspect,
        resolution: finalResolution,
        subtitleStyle: finalSubtitleStyle,
        bgmMood: finalBgmMood,
        bgmVolume: finalBgmVolume,
        noAudio,
        subtitlesEnabled,
        subtitlesBurnIn,
        autoMode: isAuto,
        autoReasoning: autoConfig?.reasoning || null,
        message: `审查完成 · ${review.score >= 7 ? "建议通过" : "建议修改"}（${review.score}/10分）`,
      };
    }
    console.log(`[AI Creator] 极速模式：审查 ${review.score}/10，不中断，继续渲染`);
  }

  // ====== 用户已确认，继续执行 Phase 3-5 ======
  console.log("[AI Creator] 开始 Phase 3-5 管线...");
  const finalVideoIds = selectedVideoIds;

  // 容错降级记录：任一非关键 Phase 失败时回退而非整任务失败，把降级项带回前端展示
  const degradations: string[] = [];

  // 5. Phase 3: TTS 生成配音
  let audioPath: string | null = null;
  console.log(`[AI Creator] Phase 3: TTS, noAudio=${noAudio}, voice=${finalVoiceId}, speed=${finalSpeed}, scriptLen=${scriptResult.script.length}`);
  if (!noAudio) {
    console.log("[AI Creator] 调用 TTS 网关 submitGatewayTask...");
    try {
      audioPath = await generateTtsAudio(
        scriptResult.script,
        finalVoiceId,
        finalSpeed,
        task.id,
      );
      console.log(`[AI Creator] TTS 完成: ${audioPath}`);
    } catch (e) {
      console.warn("[AI Creator] TTS 失败，降级为无配音（保留原声/字幕传达）:", String(e));
      degradations.push("audio:tts-failed");
      audioPath = null;
    }
  } else {
    console.log("[AI Creator] Phase 3: 跳过 TTS（noAudio=true）");
  }

  await updateProgress(48);

  // 5.5 Phase 3.5: Whisper 转写 + 用音频时长修正 clip 时长（让视频时间轴对齐音频）
  let whisperSegments: WhisperSegment[] = [];
  if (audioPath) {
    try {
      whisperSegments = await transcribeTtsAudio(audioPath);
      if (whisperSegments.length > 0) {
        scriptResult.clips = adjustClipsToAudio(scriptResult.clips, whisperSegments);
      }
    } catch (e) {
      console.warn("[AI Creator] Whisper 转写失败，降级为脚本时轴字幕:", String(e));
      degradations.push("subtitle:script-timeline");
      whisperSegments = [];
    }
  }

  await updateProgress(55);
  console.log(`[AI Creator] Phase 4: 剪辑合成, ${scriptResult.clips.length} 个片段, muteOriginal=${scriptResult.muteOriginal}`);

  // noAudio=true 时强制覆盖 LLM 的 muteOriginal 决策
  const effectiveMuteOriginal = noAudio ? true : scriptResult.muteOriginal;
  if (noAudio && !scriptResult.muteOriginal) {
    console.log("[AI Creator] noAudio=true 强制覆盖 muteOriginal: false → true");
    scriptResult.muteOriginal = true;
  }

  // 6. Phase 4: 剪辑 + 合成
  const editedPath = await executeEditPlan(
    task.id,
    scriptResult.clips,
    selectedVideoIds,
    effectiveMuteOriginal,
    null, // 暂不在这里混音，下面统一处理 BGM
  );
  console.log(`[AI Creator] Phase 4 完成: ${editedPath}`);

  console.log("[AI Creator] updateProgress(70)...");
  await updateProgress(70);
  console.log("[AI Creator] updateProgress(70) done");

  // 7. 混音：TTS + BGM ducking（或仅 BGM / 仅 TTS）
  console.log(`[AI Creator] Phase 7: 混音, bgmMood=${finalBgmMood}, muteOriginal=${effectiveMuteOriginal}, audioPath=${!!audioPath}`);
  const bgmPath = pickBgmByMood(finalBgmMood);
  console.log(`[AI Creator] BGM 路径: ${bgmPath || "无"}`);
  const mixedPath = outputPath(task.id, "mixed");
  try {
    if (audioPath) {
      console.log("[AI Creator] 混音模式: TTS + BGM");
      await mixAudio(editedPath, audioPath, mixedPath, effectiveMuteOriginal, bgmPath, finalBgmVolume);
    } else if (bgmPath) {
      console.log("[AI Creator] 混音模式: 仅BGM");
      await mixBgmOnly(editedPath, mixedPath, bgmPath, finalBgmVolume, effectiveMuteOriginal);
    } else if (effectiveMuteOriginal) {
      console.log("[AI Creator] 混音模式: 静音");
      await execAsync(`ffmpeg -i "${editedPath}" -an -c:v copy "${mixedPath}" -y`, { timeout: 60000 });
    } else {
      console.log("[AI Creator] 混音模式: 直通");
      await execAsync(`ffmpeg -i "${editedPath}" -c copy "${mixedPath}" -y`, { timeout: 60000 });
    }
  } catch (e) {
    // 混音失败降级：优先保住解说(TTS)，否则仅BGM，再否则直通原声，绝不让任务失败
    console.warn("[AI Creator] 混音失败，尝试降级音轨:", String(e));
    if (fs.existsSync(mixedPath)) fs.unlinkSync(mixedPath);
    try {
      if (audioPath) {
        console.log("[AI Creator] 降级: 仅 TTS（保留解说）");
        await execAsync(`ffmpeg -i "${editedPath}" -i "${audioPath}" -map 0:v -map 1:a -c:v copy -shortest "${mixedPath}" -y`, { timeout: 60000 });
        degradations.push("audio:tts-only");
      } else if (bgmPath) {
        console.log("[AI Creator] 降级: 仅 BGM");
        await mixBgmOnly(editedPath, mixedPath, bgmPath, finalBgmVolume, true);
        degradations.push("audio:bgm-only");
      } else {
        throw e;
      }
    } catch (e2) {
      // 最终兜底：直通（保留原视频音轨），保证一定有产出
      console.warn("[AI Creator] 降级混音仍失败，直通原视频:", String(e2));
      if (fs.existsSync(mixedPath)) fs.unlinkSync(mixedPath);
      await execAsync(`ffmpeg -i "${editedPath}" -c copy "${mixedPath}" -y`, { timeout: 60000 });
      degradations.push("audio:passthrough");
    }
  }
  console.log("[AI Creator] 混音完成");
  if (fs.existsSync(editedPath) && editedPath !== mixedPath) {
    fs.unlinkSync(editedPath);
  }

  console.log("[AI Creator] updateProgress(78)...");
  await updateProgress(78);
  console.log("[AI Creator] updateProgress(78) done");

  // 8. 应用画幅比例 / 分辨率
  const { w, h } = aspectToWH(finalAspect, finalResolution);
  const scaledPath = outputPath(task.id, "scaled");
  await applyAspectScale(mixedPath, scaledPath, w, h);
  if (fs.existsSync(mixedPath) && mixedPath !== scaledPath) {
    fs.unlinkSync(mixedPath);
  }

  await updateProgress(85);

  // 9. Phase 5: 字幕生成与烧录
  let finalPathWithSubs = scaledPath;
  let srtContent: string | null = null;

  if (subtitlesEnabled) {
    if (whisperSegments.length > 0) {
      try {
        const merged = await mergeToSentences(whisperSegments);
        srtContent = srtFromWhisperSegments(merged);
        console.log(`[AI Creator] 字幕: 基于 TTS Whisper 转录生成, ${merged.length} 条`);
      } catch (e) {
        console.warn("[AI Creator] 字幕合并失败，使用原始片段:", String(e));
        srtContent = srtFromWhisperSegments(whisperSegments);
      }
    } else {
      // 无 TTS → 基于剪辑方案生成，时间轴与视频片段对齐
      srtContent = generateSrtFromClips(scriptResult.clips);
      console.log(`[AI Creator] 字幕: 基于剪辑方案生成(无TTS), ${scriptResult.clips.length} 条`);
    }

    if (subtitlesBurnIn && srtContent) {
      const burntPath = outputPath(task.id, "final");
      await burnSubtitlesToVideo(
        scaledPath,
        srtContent,
        task.id,
        burntPath,
        finalSubtitleStyle,
        params.subtitleConfig,
      );
      finalPathWithSubs = burntPath;
      if (fs.existsSync(scaledPath) && scaledPath !== burntPath) {
        fs.unlinkSync(scaledPath);
      }
    } else {
      const finalPath = outputPath(task.id, "final");
      if (scaledPath !== finalPath) {
        fs.renameSync(scaledPath, finalPath);
        finalPathWithSubs = finalPath;
      }
    }
  } else {
    const finalPath = outputPath(task.id, "final");
    if (scaledPath !== finalPath) {
      fs.renameSync(scaledPath, finalPath);
      finalPathWithSubs = finalPath;
    }
  }

  await updateProgress(95);

  const stats = fs.statSync(finalPathWithSubs);

  await updateProgress(100);

  const result: Record<string, unknown> = {
    outputPath: finalPathWithSubs,
    fileSize: stats.size,
    title: scriptResult.title,
    script: scriptResult.script,
    clips: scriptResult.clips.map((c) => ({
      videoIndex: c.videoIndex,
      startTime: c.startTime,
      endTime: c.endTime,
      narration: c.narration,
      transition: c.transition || "fade",
      transitionDuration: c.transitionDuration ?? 0.4,
    })),
    muteOriginal: scriptResult.muteOriginal,
    topic: intent.topic,
    style: intent.style,
    selectedVideoIds: selectedVideoIds,
    voiceId: finalVoiceId,
    speed: finalSpeed,
    aspect: finalAspect,
    resolution: finalResolution,
    subtitleStyle: finalSubtitleStyle,
    bgmMood: finalBgmMood,
    bgmVolume: finalBgmVolume,
    bgmApplied: !!bgmPath,
    bgmFile: bgmPath ? path.basename(bgmPath) : null,
    autoMode: isAuto,
    autoReasoning: autoConfig?.reasoning || null,
    noAudio,
    review: planReview,
    degradations,
    iterated: isIterate,
    iterateSummary,
    explanation: isIterate
      ? `${scriptResult.title} — 已按修改要求更新${iterateSummary ? "：" + iterateSummary : ""}`
      : `${scriptResult.title} — ${intent.reasoning}`,
    transitions: scriptResult.clips.slice(1).map((c) => ({
      type: c.transition || "fade",
      duration: c.transitionDuration ?? 0.4,
    })),
  };

  if (srtContent) {
    const srtPath = path.resolve("uploads/subtitles", `creator_sub_${task.id}.srt`);
    result.srtPath = srtPath;
    result.srtContent = srtContent;
  }

  return result;
}

// 注册任务处理器
registerTaskHandler("ai_video_creator", runAiVideoCreator);

export { runAiVideoCreator, applyPlanDiff, type AiCreatorParams };
