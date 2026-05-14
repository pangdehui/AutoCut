import { getDb } from "../db";
import { videos, videoAnalysis } from "../../drizzle/schema";
import { eq, and, isNotNull } from "drizzle-orm";
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
  /** 仅生成方案+审查，不执行剪辑（用户确认后再继续） */
  planOnly?: boolean;
  /** 用户确认后传入，跳过 Phase 0-2，直接执行 Phase 3-5 */
  approvedPlan?: ScriptResult;
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
    })
    .from(videos)
    .innerJoin(videoAnalysis, eq(videos.id, videoAnalysis.videoId))
    .where(and(...conditions));

  return rows.map((r) => {
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
    .map((v) => `  • ${v.id} → ${v.tone}（适合：${v.suit}）`)
    .join("\n");

  const systemPrompt = `你是资深短视频后期统筹，负责根据创作需求一次性确定所有制作参数。你的决策将直接影响成片质量，每个参数都要认真匹配内容特性。

━━━━━━━━━━━━━━━━━━━━━━━
一、画幅选择（aspect）
━━━━━━━━━━━━━━━━━━━━━━━
• 9:16  竖屏 → 抖音/快手/视频号/Reels（移动端刷屏场景，默认首选）
• 16:9  横屏 → B站/YouTube/教程/纪录片/企业宣传
• 1:1   方形 → 小红书图文视频/品牌贴片
判断依据：用户提到平台名称优先；无平台信息时看内容类型（带货/Vlog→9:16；教程/纪录→16:9）

━━━━━━━━━━━━━━━━━━━━━━━
二、分辨率（resolution）
━━━━━━━━━━━━━━━━━━━━━━━
• 1080p → 精品内容、有品牌背书、产品展示（默认）
• 720p  → 快速日常 Vlog、追求文件体积小

━━━━━━━━━━━━━━━━━━━━━━━
三、音色选择（voiceId）⚠️ 最重要
━━━━━━━━━━━━━━━━━━━━━━━
必须从以下清单严格选取，错误音色会毁掉整条视频：
${voiceCatalogText}

匹配逻辑（按优先级）：
1. 用户明确指定性别/风格 → 直接匹配
2. 内容类型匹配：
   - 美食/探店/日常生活 → female-chengshu 或 Chinese (Mandarin)_Warm_Bestie
   - 带货/种草/产品推广 → male-qn-badao 或 female-yujie
   - 知识/科普/深度解析 → male-qn-jingying 或 female-yujie
   - 情感/故事/治愈系   → Chinese (Mandarin)_Warm_Bestie 或 male-qn-qingse
   - 潮流/年轻/二次元   → female-shaonv 或 male-qn-qingse
   - 旅行/人文/纪录片   → Chinese (Mandarin)_Gentleman
   - 新闻/时事/严肃话题 → Chinese (Mandarin)_News_Anchor
   - 商业/金融/企业宣传 → Chinese (Mandarin)_Reliable_Executive
3. 兜底（实在无法判断）→ female-chengshu

━━━━━━━━━━━━━━━━━━━━━━━
四、语速（speed）
━━━━━━━━━━━━━━━━━━━━━━━
• 0.85-0.95 → 治愈/纪录片/情感叙事（留白感）
• 1.0       → 标准，通用场景
• 1.05-1.15 → 信息密度高的知识内容
• 1.15-1.25 → 带货/快节奏/促销（急迫感）
注意：语速影响用户体验，不要超过 1.25，过快会疲劳

━━━━━━━━━━━━━━━━━━━━━━━
五、字幕配置
━━━━━━━━━━━━━━━━━━━━━━━
subtitleStyle 选择：
• default       → 白字黑边，通用，95% 场景适用
• bold_caption  → 大字加粗，带货/口播/强调型内容
• minimal       → 半透明细字，纪录片/Vlog/艺术风格
• tiktok_yellow → 黄底黑字，潮流/娱乐/高能混剪
大多数内容：subtitlesEnabled=true, subtitlesBurnIn=true（烧录进视频）
noAudio=true 时：字幕是唯一信息载体，必须开启且烧录

━━━━━━━━━━━━━━━━━━━━━━━
六、BGM 情绪（bgmMood）
━━━━━━━━━━━━━━━━━━━━━━━
• upbeat    → 轻快活力（日常/打卡/好消息）
• calm      → 舒缓治愈（美食/自然/睡前）
• dramatic  → 戏剧张力（反转/揭秘/冲突）
• warm      → 温情暖意（亲情/回忆/成长）
• energetic → 激情澎湃（运动/挑战/励志）
• cinematic → 史诗大片（旅行大片/品牌宣传）
• none      → 无 BGM（纯讲解/正式访谈/用户要求）
bgmVolume 参考：有配音时 0.10-0.18；无配音时 0.25-0.40

━━━━━━━━━━━━━━━━━━━━━━━
七、noAudio（是否跳过配音）
━━━━━━━━━━━━━━━━━━━━━━━
仅当用户明确说"不要配音/纯字幕/静音版/只要BGM"时设为 true，其余一律 false

━━━━━━━━━━━━━━━━━━━━━━━
输出严格 JSON，不要任何多余文字：
{
  "aspect": "9:16",
  "resolution": "1080p",
  "voiceId": "音色ID",
  "speed": 1.0,
  "noAudio": false,
  "subtitlesEnabled": true,
  "subtitlesBurnIn": true,
  "subtitleStyle": "default",
  "bgmMood": "upbeat",
  "bgmVolume": 0.15,
  "reasoning": "简述每个关键参数的选择理由（中文，100字内）"
}`;

  const result = await getDeepSeek().chat.completions.create({
    model: ENV.deepseekModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `创作需求：${prompt}` },
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
      topic: { type: "string", description: "视频主题" },
      style: { type: "string", description: "视频风格，如 promotional/tutorial/vlog/review" },
      targetDuration: { type: "number", description: "目标视频时长（秒）" },
      selectedVideoIds: {
        type: "array",
        items: { type: "number" },
        description: "选中用于创作的相关视频 ID 列表",
      },
      reasoning: { type: "string", description: "选择这些视频的理由（中文）" },
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
      const kw = (v.keywords || []).join("、");
      const sceneCount = (v.scenes || []).length;
      const dur = v.duration?.toFixed(0) ?? "?";
      return `  [ID:${v.id}] 《${v.fileName}》时长${dur}秒 | 分类:${v.category || "未知"} | 关键词:${kw || "无"} | 场景数:${sceneCount}`;
    })
    .join("\n");

  const systemPrompt = `你是资深短视频创意总监，擅长从素材库中挑选最合适的素材，并为剪辑师提供精准的创意方向。

## 你的任务

**第一步：深度解读用户意图**
- 用户真正想要什么？（不只是字面意思，更要理解情感诉求和传播目标）
- 目标受众是谁？他们的痛点/兴趣是什么？
- 核心信息是什么？用一句话概括这个视频要说的最重要的事

**第二步：智能选材（⚠️ 素材多样性是硬要求）**
选材原则（按优先级）：
1. 内容相关性：素材主题/关键词是否匹配需求
2. 画面多样性：优先选不同场景、不同景别、不同氛围的素材，避免单调
3. 时长充裕度：素材时长要足够剪出目标时长，宁可多选不要少选
4. 质量优先：有"模糊/晃动/黑屏"标记的素材降低优先级

⚠️ 硬性选材数量要求：
- 素材库有 ≥10 个相关素材 → 至少选 6 个，理想 8-10 个
- 素材库有 5-9 个相关素材 → 至少选 4 个，理想 5-7 个
- 素材库有 3-4 个相关素材 → 全选
- 不要强行凑数，但也不要为了精简而砍掉有价值的素材。素材够多的情况下选太少会导致剪辑师只能反复用同一素材，视觉疲劳。

**第三步：创意简报**
给剪辑师一份可直接执行的创意简报，包含：
- 开头钩子设计（前3秒如何抓住观众）
- 叙事节奏（快切/慢镜/情绪起伏节点）
- 情绪弧线（从什么情绪出发，经历什么转变，以什么情绪结束）
- 视觉语言建议（景别组合、颜色基调）
- 结尾设计（呼吁行动/情感收尾/留下悬念）

## 可用素材库
${videoListText}

## 目标时长参考
• 15-30秒：快节奏爆款（带货/挑战/搞笑）
• 30-60秒：标准内容（Vlog/测评/教程）
• 60-120秒：深度内容（纪录/故事/详细教程）
• 未指定时：根据内容类型判断，带货默认30秒，Vlog默认45秒，教程默认60秒

## 输出 JSON（严格格式，不要额外文字）
{
  "topic": "视频核心主题（一句话，10字内）",
  "style": "风格类型（带货/美食Vlog/知识科普/情感故事/产品测评/旅行记录/混剪/其他）",
  "targetDuration": 45,
  "selectedVideoIds": [1, 3, 5],
  "reasoning": "选材理由（简明扼要，说清楚选了什么、为什么选、多样性如何保证）",
  "creativeBrief": "给剪辑师的创意简报（150字内，包含开头钩子/叙事节奏/情绪弧线/结尾设计）",
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
          `\n\n⚠️ 严格要求：只输出合法 JSON，不要任何 Markdown 标记或说明文字。`,
      },
      { role: "user", content: `创作需求：${prompt}` },
    ],
  });

  const content = result.choices[0]?.message?.content;
  if (!content) throw new Error("LLM 返回格式异常");
  return parseJsonResponse(content) as IntentResult;
}

// ====== Phase 2: LLM 生成脚本 + 剪辑计划 ======

const TRANSITION_TYPES: TransitionType[] = [
  "cut", "fade", "fadeblack", "fadewhite", "dissolve",
  "slideleft", "slideright", "slideup", "slidedown",
  "wipeleft", "wiperight", "circleopen", "circleclose", "zoomin",
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
              description: "进入此片段时使用的转场（首片段会被忽略）。cut=硬切；fade/dissolve=淡入；fadeblack/fadewhite=黑场/白场；slide*=滑动；wipe*=擦除；circle*=圆形开合；zoomin=推近",
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
): Promise<ScriptResult> {
  const sceneDetails = selectedVideos
    .map((v) => {
      const vidx = selectedVideoIds.indexOf(v.id);
      const scenes = (v.scenes || [])
        .map(
          (s) =>
            `    [${s.startTime.toFixed(1)}s → ${s.endTime.toFixed(1)}s] ${s.description}` +
            (s.shotType ? ` | 景别:${s.shotType}` : "") +
            (s.motion ? ` | 运动:${s.motion}` : "") +
            (s.quality ? ` | 质量:${s.quality}` : "") +
            (s.tags?.length ? ` | 标签:${s.tags.join(",")}` : "")
        )
        .join("\n");
      return (
        `【序号:${vidx} | ID:${v.id}】${v.fileName}\n` +
        `  时长:${v.duration?.toFixed(1) ?? "?"}秒 | 类型:${v.category || "未知"}\n` +
        `  场景明细:\n${scenes}`
      );
    })
    .join("\n\n");

  const systemPrompt = `你是一位拥有15年经验的顶级短视频剪辑大师，同时精通广告文案、叙事设计和观众心理。你的作品在各大平台斩获千万播放，深知每一帧都要"值钱"。

━━━━━━━━━━━━━━━━━━━━━━━
核心工作哲学
━━━━━━━━━━━━━━━━━━━━━━━
• 每个镜头都必须有存在的理由：信息量、情绪价值、视觉冲击，三选一必须满足
• 开头3秒决定留存率，中段节奏决定完播率，结尾决定转化率
• 宁可少一个片段，不要用一个无聊的镜头填充时间
• narration 是画面的灵魂，不是画面的说明书

━━━━━━━━━━━━━━━━━━━━━━━
一、素材精读（必做，不能跳过）
━━━━━━━━━━━━━━━━━━━━━━━
逐个分析每个可用场景：
✓ 标记：精彩瞬间 / 情绪高潮 / 视觉冲击 / 特写/慢镜机会
✗ 排除：模糊画面 / 剧烈抖动（如必须用，限1.5秒内）/ 黑屏/闪白 / 无关内容

━━━━━━━━━━━━━━━━━━━━━━━
二、叙事结构设计
━━━━━━━━━━━━━━━━━━━━━━━
【开头 0-5秒：强钩子区】
  必须满足以下之一：
  • 视觉钩子：震撼画面/反常识画面/强烈色彩/快速动作
  • 悬念钩子：问句/未解之谜/意外结果先展示
  • 情绪钩子：共鸣痛点/强烈情感/幽默冲突
  ❌ 绝对禁止："大家好"/"欢迎观看"/"今天给大家"这类平淡开场

【中段：信息推进区】
  • 围绕核心信息展开，每个片段都要推进故事/论点
  • 节奏要有变化：快切制造紧张感，停留制造情绪感
  • 适时插入特写/细节镜头，增加画面层次
  • 信息要分层：先抛问题，再给证据，最后给结论

【结尾：转化区】
  • 情感/故事：有回味，情绪完整落地
  • 带货/推广：明确 CTA（行动召唤），价值感拉满
  • 知识/科普：总结升华，留下一个"记忆点"
  • 可以设置悬念引导关注/留言

━━━━━━━━━━━━━━━━━━━━━━━
三、Narration 写作规范
━━━━━━━━━━━━━━━━━━━━━━━
• 每段 15-35 字，口语化，有节奏感，可以朗读出来
• 不要复述画面（"你看这里有一个..."），要解读/升华/情绪化
• 关键信息前可用停顿强调（用"……"表示）
• 数字/价格/核心卖点要清晰说出
• narration 拼接即完整 script，要逻辑连贯，不能断层

━━━━━━━━━━━━━━━━━━━━━━━
四、剪辑节奏规范
━━━━━━━━━━━━━━━━━━━━━━━
镜头时长：
• 快切区（动作/节奏/爆点）：0.8-2.0 秒
• 标准区（信息/叙述）：2.0-4.0 秒
• 情绪停留区（高潮/反转/感动）：3.0-6.0 秒
• 单镜头不超过 8 秒（极特殊情况除外）

转场使用原则：
• 同场景/快节奏 → cut（硬切，最常用）
• 段落切换/情绪转折 → fadeblack（黑场，庄重感）
• 梦境/回忆/情绪溶解 → dissolve 或 fade
• 动感/年轻内容 → slideleft / slideright（动态感）
• 高能/潮流内容 → wipeleft / zoomin

素材使用约束（⚠️ 严格执行）：
• 同一 videoIndex 在整片中最多使用 3 次
• 同一 videoIndex 不得连续使用（必须间隔至少 2 个其他片段）
• 同一素材的同一时间段不得重复截取
• 剧烈抖动/眩晕感镜头单段不超过 1.5 秒，全片不超过 2 次
• 优先使用场景列表中有明确描述的时间段

muteOriginal 判断：
• 带货/口播/解说/知识类 → true（原声会干扰配音）
• 短剧/采访/纪录/现场还原类 → false（原声有价值）

━━━━━━━━━━━━━━━━━━━━━━━
五、输出格式要求
━━━━━━━━━━━━━━━━━━━━━━━
严格输出以下 JSON，不要任何额外说明：
{
  "title": "吸引人的视频标题（15字内，有悬念或价值感）",
  "script": "全部narration顺序拼接，即完整配音文本",
  "clips": [
    {
      "videoIndex": 0,
      "startTime": 2.5,
      "endTime": 5.0,
      "narration": "这段画面对应的配音文字",
      "transition": "cut",
      "transitionDuration": 0.4
    }
  ],
  "muteOriginal": true
}

videoIndex 从 0 开始，对应传入素材的序号。startTime/endTime 精确到 0.1 秒。`;

  const result = await getDeepSeek().chat.completions.create({
    model: ENV.deepseekModel,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          `【创作需求】${prompt}\n` +
          (creativeBrief ? `【创意简报】${creativeBrief}\n` : "") +
          `【主题】${topic}\n` +
          `【风格】${style}\n` +
          `【目标时长】${targetDuration}秒（允许±10秒浮动）\n\n` +
          `【可用素材详情】\n${sceneDetails}\n\n` +
          `⚠️ 重要提示：严格遵守素材使用约束，同一素材最多用3次且不得连续；只输出合法 JSON。`,
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

// ====== Phase 3: TTS 生成 ======

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
    await concatVideosWithTransitions(segmentPaths, mergedPath, transitions);
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
      `  片段${i + 1}：素材[${c.videoIndex}] ${c.startTime.toFixed(1)}s→${c.endTime.toFixed(1)}s（${(c.endTime - c.startTime).toFixed(1)}秒）| 转场:${c.transition || "fade"} | 配音："${c.narration}"`
    )
    .join("\n");

  // 检测素材重复使用情况
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
    .map(([idx, count]) => `素材[${idx}]用了${count}次`);

  const configDesc = autoConfig
    ? `画幅:${autoConfig.aspect} | 分辨率:${autoConfig.resolution} | 音色:${autoConfig.voiceId} | 语速:${autoConfig.speed} | BGM:${autoConfig.bgmMood}(音量${autoConfig.bgmVolume}) | 字幕:${autoConfig.subtitlesEnabled ? (autoConfig.subtitlesBurnIn ? "烧录(" + autoConfig.subtitleStyle + ")" : "仅SRT") : "关闭"} | noAudio:${autoConfig.noAudio}`
    : "手动配置";

  const systemPrompt = `你是一位经验丰富的短视频质量总监，负责对 AI 生成的剪辑方案进行专业审查。你的审查直接影响成片质量，必须客观严格，不能放水。

━━━━━━━━━━━━━━━━━━━━━━━
审查维度（各维度权重）
━━━━━━━━━━━━━━━━━━━━━━━

【1. 需求贴合度 30%】
• 是否真正理解用户意图（而非套用模板）
• 视频类型/风格是否匹配需求
• 目标受众是否清晰，内容是否对口

【2. 脚本质量 25%】
• 开头是否有强钩子（前3秒能抓住人吗？）
• narration 是否口语化、有节奏感
• 信息密度是否合适（不过密也不空洞）
• 结尾是否有收束感/行动引导

【3. 剪辑方案合理性 25%】
• 片段时长是否符合内容节奏
• 镜头切换逻辑是否自然（有视觉呼应吗？）
• 转场选择是否合适
• 总时长是否接近目标时长

【4. 素材使用规范 20%】
• 同一素材是否过度重复（>3次扣分）
• 是否有连续使用同一素材的情况
• 是否存在明显的时间段冲突（同素材同时段重复截取）

━━━━━━━━━━━━━━━━━━━━━━━
评分标准
━━━━━━━━━━━━━━━━━━━━━━━
• 9-10分：专业级，可直接执行，接近人工剪辑水平
• 7-8分：良好，有小瑕疵但不影响整体，建议执行
• 5-6分：一般，存在明显问题，需要针对性改进
• 3-4分：较差，核心问题突出，建议重新生成
• 1-2分：无法接受，需要完全重写

⚠️ 严格要求：评分低于 5 时，suggestions 必须给出逐片段的具体改写指令（"第X片段建议改为..."），不接受笼统的"需要提升吸引力"这类无效建议。

━━━━━━━━━━━━━━━━━━━━━━━
输出格式（严格 JSON，不要额外文字）
━━━━━━━━━━━━━━━━━━━━━━━
{
  "score": 8,
  "scriptReview": "脚本质量评价（60字内，指出最大亮点和最大问题）",
  "clipReview": "剪辑方案评价（60字内，指出节奏/素材使用的核心问题）",
  "suggestions": [
    "具体可执行的改进建议1（如：片段3建议换用[0]素材2.5-5.0s，当前镜头过长且内容重复）",
    "具体改进建议2"
  ],
  "riskWarnings": [
    "风险提示（如：素材[2]被使用4次，超出限制；第1片段转场与内容风格不符）"
  ]
}`;

  const result = await getDeepSeek().chat.completions.create({
    model: ENV.deepseekModel,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          `【用户需求】${prompt}\n\n` +
          `【制作配置】${configDesc}\n\n` +
          `【视频标题】${scriptResult.title}\n` +
          `【完整脚本】${scriptResult.script}\n\n` +
          `【剪辑方案】共 ${scriptResult.clips.length} 段，muteOriginal=${scriptResult.muteOriginal}\n${clipsDesc}\n\n` +
          (overusedVideos.length ? `⚠️ 检测到素材过度使用：${overusedVideos.join("、")}\n` : "") +
          (consecutiveViolations.length ? `⚠️ 检测到连续使用同一素材：第 ${consecutiveViolations.map((i) => i + 1).join("、")} 片段\n` : "") +
          `\n请客观审查并给出评分。`,
      },
    ],
  });

  const content = result.choices[0]?.message?.content;
  if (!content) {
    return { score: 5, scriptReview: "审查 Agent 未返回结果", clipReview: "", suggestions: [], riskWarnings: [] };
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
  console.log(`[AI Creator] ====== 任务 ${task.id} 开始 ======`);
  console.log(`[AI Creator] prompt: "${(params.prompt || "").slice(0, 80)}", approvedPlan=${hasApproved}, autoMode=${params.autoMode}`);

  if (!params.prompt || params.prompt.trim().length === 0) {
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

  // 2. Phase 0: AI 自动决策（用户确认后跳过，参数已在审查阶段确定）
  const isAuto = params.autoMode !== false;
  let autoConfig: AutoConfig | null = null;
  if (isAuto && !params.approvedPlan) {
    console.log("[AI Creator] Phase 0: 自动决策...");
    autoConfig = await phase0AutoConfig(params.prompt);
  } else if (params.approvedPlan) {
    console.log("[AI Creator] Phase 0: 跳过（用户已确认，参数从审查阶段继承）");
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

  // 3. Phase 1: LLM 理解意图 + 选择视频（有确认方案则跳过）
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

  const selectedVideoIds = params.approvedPlan
    ? videoSummaries.map((v) => v.id)
    : intent.selectedVideoIds;
  const selectedVideos = videoSummaries.filter((v) => selectedVideoIds.includes(v.id));

  // 4. Phase 2: 脚本 + 剪辑计划（用户确认后直接用已审批方案）
  console.log("[AI Creator] Phase 2: 脚本生成...");
  let scriptResult: ScriptResult;
  if (params.approvedPlan) {
    console.log("[AI Creator] Phase 2: 跳过（使用已审批方案）");
    scriptResult = params.approvedPlan;
    scriptResult.clips = scriptResult.clips.map((c) => ({
      ...c,
      videoIndex: c.videoIndex < selectedVideoIds.length ? c.videoIndex : 0,
    }));
  } else {
    scriptResult = await phase2Script(
      params.prompt,
      intent.topic,
      intent.style,
      intent.targetDuration,
      selectedVideos,
      selectedVideoIds,
      intent.creativeBrief,
    );
  }

  await updateProgress(30);
  await updateProgress(35);

  // 审查 Agent：仅在首次生成时运行（用户确认后跳过，避免卡住）
  if (!params.approvedPlan) {
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

    // 返回方案让用户审查
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
      review: {
        score: review.score,
        scriptReview: review.scriptReview,
        clipReview: review.clipReview,
        suggestions: review.suggestions,
        riskWarnings: review.riskWarnings,
      },
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

  // ====== 用户已确认，继续执行 Phase 3-5 ======
  console.log("[AI Creator] 开始 Phase 3-5 管线...");
  const finalVideoIds = selectedVideoIds;

  // 5. Phase 3: TTS 生成配音
  let audioPath: string | null = null;
  console.log(`[AI Creator] Phase 3: TTS, noAudio=${noAudio}, voice=${finalVoiceId}, speed=${finalSpeed}, scriptLen=${scriptResult.script.length}`);
  if (!noAudio) {
    console.log("[AI Creator] 调用 TTS 网关 submitGatewayTask...");
    audioPath = await generateTtsAudio(
      scriptResult.script,
      finalVoiceId,
      finalSpeed,
      task.id,
    );
    console.log(`[AI Creator] TTS 完成: ${audioPath}`);
  } else {
    console.log("[AI Creator] Phase 3: 跳过 TTS（noAudio=true）");
  }

  await updateProgress(48);

  // 5.5 Phase 3.5: Whisper 转写 + 用音频时长修正 clip 时长（让视频时间轴对齐音频）
  let whisperSegments: WhisperSegment[] = [];
  if (audioPath) {
    whisperSegments = await transcribeTtsAudio(audioPath);
    if (whisperSegments.length > 0) {
      scriptResult.clips = adjustClipsToAudio(scriptResult.clips, whisperSegments);
    }
  }

  await updateProgress(55);
  console.log(`[AI Creator] Phase 4: 剪辑合成, ${scriptResult.clips.length} 个片段, muteOriginal=${scriptResult.muteOriginal}`);

  // 6. Phase 4: 剪辑 + 合成
  const editedPath = await executeEditPlan(
    task.id,
    scriptResult.clips,
    selectedVideoIds,
    scriptResult.muteOriginal,
    null, // 暂不在这里混音，下面统一处理 BGM
  );
  console.log(`[AI Creator] Phase 4 完成: ${editedPath}`);

  console.log("[AI Creator] updateProgress(70)...");
  await updateProgress(70);
  console.log("[AI Creator] updateProgress(70) done");

  // 7. 混音：TTS + BGM ducking（或仅 BGM / 仅 TTS）
  console.log(`[AI Creator] Phase 7: 混音, bgmMood=${finalBgmMood}, muteOriginal=${scriptResult.muteOriginal}, audioPath=${!!audioPath}`);
  const bgmPath = pickBgmByMood(finalBgmMood);
  console.log(`[AI Creator] BGM 路径: ${bgmPath || "无"}`);
  const mixedPath = outputPath(task.id, "mixed");
  if (audioPath) {
    console.log("[AI Creator] 混音模式: TTS + BGM");
    await mixAudio(editedPath, audioPath, mixedPath, scriptResult.muteOriginal, bgmPath, finalBgmVolume);
  } else if (bgmPath) {
    console.log("[AI Creator] 混音模式: 仅BGM");
    await mixBgmOnly(editedPath, mixedPath, bgmPath, finalBgmVolume, scriptResult.muteOriginal);
  } else if (scriptResult.muteOriginal) {
    console.log("[AI Creator] 混音模式: 静音");
    await execAsync(`ffmpeg -i "${editedPath}" -an -c:v copy "${mixedPath}" -y`, { timeout: 60000 });
  } else {
    console.log("[AI Creator] 混音模式: 直通");
    await execAsync(`ffmpeg -i "${editedPath}" -c copy "${mixedPath}" -y`, { timeout: 60000 });
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
    explanation: `${scriptResult.title} — ${intent.reasoning}`,
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

export { runAiVideoCreator, type AiCreatorParams };