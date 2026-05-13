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
  // 尝试直接解析
  try { return JSON.parse(content); } catch {}
  // 尝试提取 markdown 代码块中的 JSON
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  // 尝试找到第一个 { 到最后一个 }
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
  /** true = 口播视频,跳过 TTS,只靠字幕传达;此时字幕必须开启且烧录 */
  noAudio: boolean;
  subtitlesEnabled: boolean;
  subtitlesBurnIn: boolean;
  subtitleStyle: SubtitleStyle;
  bgmMood: BgmMood;
  bgmVolume: number;       // 0.05-0.4
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
  /** 字幕样式细粒度覆盖：在 subtitleStyle 预设上叠加（颜色/字号/字体/位置 等） */
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
  }> | null;
}

interface IntentResult {
  topic: string;
  style: string;
  targetDuration: number;
  selectedVideoIds: number[];
  reasoning: string;
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
    return {
      id: r.id,
      fileName: r.fileName,
      duration: r.duration ? parseFloat(String(r.duration)) : null,
      category: (meta.category as string) || null,
      keywords: (r.keywords as string[]) || null,
      summary: (meta.summary as string) || null,
      scenes: ((r.sceneDescriptions || []) as Array<{
        startTime: number;
        endTime: number;
        description: string;
        tags: string[];
      }>),
    };
  });
}

// ====== Phase 0: LLM 自动决策（音色/比例/字幕样式/BGM 等） ======

const VOICE_CATALOG: Array<{ id: string; tone: string; suit: string }> = [
  { id: "female-chengshu",                                      tone: "甜美女声",   suit: "美食/亲子/治愈/日常 vlog" },
  { id: "female-yujie",                                        tone: "御姐女声",   suit: "美妆/穿搭/品质感产品/职场" },
  { id: "female-shaonv",                                       tone: "少女女声",   suit: "学生/萌系/二次元/年轻潮流" },
  { id: "female-chengshu",                                     tone: "成熟女性",   suit: "知识科普/商业/专业讲解" },
  { id: "Chinese (Mandarin)_News_Anchor",                      tone: "新闻女声",   suit: "新闻播报/严肃话题/事件解读" },
  { id: "Chinese (Mandarin)_Sweet_Lady",                       tone: "甜美女声",   suit: "广告/产品/亲和力开场" },
  { id: "Chinese (Mandarin)_Warm_Bestie",                      tone: "温暖闺蜜",   suit: "情感共鸣/Vlog/生活记录" },
  { id: "male-qn-jingying",                                    tone: "精英青年",   suit: "商业/科技/专业讲解/B 端" },
  { id: "male-qn-badao",                                       tone: "霸道青年",   suit: "汽车/数码/极致体验/带货" },
  { id: "male-qn-qingse",                                      tone: "青涩青年",   suit: "校园/治愈/情感故事" },
  { id: "Chinese (Mandarin)_Gentleman",                        tone: "温润男声",   suit: "纪录片/旅行/人文" },
  { id: "Chinese (Mandarin)_Male_Announcer",                   tone: "播报男声",   suit: "硬广/赛事/氛围旁白" },
  { id: "Chinese (Mandarin)_Reliable_Executive",               tone: "沉稳高管",   suit: "金融/政经/严肃商业" },
];

const AUTO_CONFIG_SCHEMA_DESC = `
{
  "aspect": "16:9 | 9:16 | 1:1",
  "resolution": "1080p | 720p",
  "voiceId": "音色 ID（必须从下面音色清单中选）",
  "speed": 0.9 - 1.3,
  "noAudio": true | false,
  "subtitlesEnabled": true | false,
  "subtitlesBurnIn": true | false,
  "subtitleStyle": "default | bold_caption | minimal | tiktok_yellow",
  "bgmMood": "upbeat | calm | dramatic | warm | energetic | cinematic | none",
  "bgmVolume": 0.05 - 0.4,
  "reasoning": "中文说明你为什么这么选"
}`;

async function phase0AutoConfig(prompt: string): Promise<AutoConfig> {
  const voiceCatalogText = VOICE_CATALOG
    .map((v) => `- ${v.id}：${v.tone}（${v.suit}）`)
    .join("\n");

  const systemPrompt = `你是专业后期统筹。根据用户需求决定视频技术参数。

## 音色选择（重要）
必须从以下清单选，根据内容类型匹配。选错音色会毁掉整条视频。
${voiceCatalogText}

匹配原则：
- 美食/探店 → female-chengshu 或 Chinese (Mandarin)_Warm_Bestie（温暖亲和）
- 带货/推广 → male-qn-badao 或 female-chengshu（信任感）
- 知识/科普 → female-chengshu 或 male-qn-jingying（专业沉稳）
- 故事/短剧 → Chinese (Mandarin)_Warm_Bestie（情感共鸣）
- 潮流/年轻 → female-shaonv 或 male-qn-qingse（活力）
- 纪录片/旅行 → Chinese (Mandarin)_Gentleman（温润）
- 新闻/严肃 → Chinese (Mandarin)_News_Anchor（端庄）
- 不确定时 → female-chengshu

## 画幅
9:16竖屏(抖音/快手) | 16:9横屏(B站/YouTube/教程) | 1:1方形(小红书)

## 语速
1.0标准 | 1.1-1.2偏快(带货/快节奏) | 0.85-0.95偏慢(治愈/纪录片)

## 字幕
subtitleStyle: default(通用白字黑边) | bold_caption(大字带货) | minimal(纪录片/vlog) | tiktok_yellow(潮流)
大部分场景 subtitlesEnabled=true, subtitlesBurnIn=true

## BGM
upbeat(活力) calm(治愈) dramatic(戏剧) warm(美食/温情) energetic(运动) cinematic(大片) none(纯讲解)
有配音时 bgmVolume=0.12-0.18，无配音时 0.25-0.4

## noAudio
用户说"不要配音/纯字幕/静音" → true，其他 → false

回复JSON：${AUTO_CONFIG_SCHEMA_DESC}`;

  const result = await getDeepSeek().chat.completions.create({
    model: ENV.deepseekModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
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
      return `[ID:${v.id}] ${v.fileName} (时长:${v.duration?.toFixed(0) ?? "?"}秒, 分类:${v.category || "未知"}, 关键词:${kw}, 场景数:${sceneCount})`;
    })
    .join("\n");

  const systemPrompt = `你是一个专业的视频创作导演。用户想要创建一个视频，你需要：
1. 理解用户的创作意图
2. 从可用视频素材库中选择最相关的视频

可用视频素材：
${videoListText}

请根据用户需求选择视频。如果素材都不相关，返回空数组并说明需要什么素材。回复使用中文。`;

  const result = await getDeepSeek().chat.completions.create({
    model: ENV.deepseekModel,
    messages: [
      { role: "system", content: systemPrompt + `\n\n你必须严格按照以下 JSON 格式回复，不要包含其他文字：\n${JSON.stringify(INTENT_SCHEMA.schema)}` },
      { role: "user", content: prompt },
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
  selectedVideoIds: number[]
): Promise<ScriptResult> {
  const sceneDetails = selectedVideos
    .map((v) => {
      const vidx = selectedVideoIds.indexOf(v.id);
      const scenes = (v.scenes || [])
        .map((s) => `  [${s.startTime}s-${s.endTime}s] ${s.description} (标签:${(s.tags || []).join(",")})`)
        .join("\n");
      return `[序号:${vidx}, ID:${v.id}] ${v.fileName} (时长:${v.duration?.toFixed(0) ?? "?"}秒)\n场景列表:\n${scenes}`;
    })
    .join("\n\n");

  const systemPrompt = `你是拥有10年经验的资深剪辑师。阅读素材清单，理解用户需求，像一个真正的剪辑师那样工作。

## 工作流程
1. 快速扫描所有素材，了解你有什么画面可用
2. 决定这条视频的叙事结构：开头怎么抓人？中间怎么推进？结尾怎么收？
3. 为每个关键画面配一段 narration（TTS 配音文案），确保画面和文案同步
4. 决定节奏：哪里快切制造张力，哪里慢镜让观众呼吸

## 专业规范
- 片头5秒必须有钩子（冲突/悬念/精彩画面），禁止"大家好欢迎来到"式开场
- narration 每段15-35字，口语化，描述画面+传递信息
- 镜头2-4秒为主，动作/冲突0.5-1.5秒快切，情绪高点3-5秒停留
- 默认硬切(cut)，段落切换用 fadeblack
- 跳过黑屏/闪白/晃动/模糊/无关画面
- 带货/口播类 muteOriginal=true；短剧/解说类 muteOriginal=false
- BGM 情绪匹配内容，有配音时音量压低到0.12-0.18

## 输出
{"title":"标题","script":"全部narration拼接","clips":[{"videoIndex":0,"startTime":2.5,"endTime":6.0,"narration":"文案","transition":"cut","transitionDuration":0.4}],"muteOriginal":true}
- videoIndex=素材[序号:X]，必须对应真实素材
- startTime/endTime 基于素材 scene 列表中标注的时间，精确到0.1秒
- narration 拼接=script
- 只输出JSON`;

  const result = await getDeepSeek().chat.completions.create({
    model: ENV.deepseekModel,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `用户需求：${prompt}\n主题：${topic}\n风格：${style}\n目标时长：${targetDuration}秒\n\n视频素材详情：\n${sceneDetails}`,
      },
    ],
  });

  const content = result.choices[0]?.message?.content;
  if (!content) throw new Error("LLM 返回格式异常");
  console.log("[Phase2] DeepSeek 原始返回(前500字):", content.slice(0, 500));
  const parsed = parseJsonResponse(content) as ScriptResult;
  console.log(`[Phase2] 解析结果: title="${parsed.title}", script=${(parsed.script||"").length}字, clips=${(parsed.clips||[]).length}个, muteOriginal=${parsed.muteOriginal}`);
  if (parsed.clips) {
    parsed.clips.forEach((c, i) => console.log(`  clip[${i}]: vid=${c.videoIndex}, ${c.startTime}-${c.endTime}s, narration="${(c.narration||"").slice(0, 40)}"`));
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

  // 先累积 Whisper 文本中每个字符的时间偏移，用于将文本位置映射回时间
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
        const frac = (pos - charTimeMap[i].pos) / Math.max(1, charTimeMap[i + 1].pos - charTimeMap[i].pos);
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
        // 留白保护：TTS 很短时不要缩视频片段，让人物原声能被听到
        const origDuration = adjusted[i].endTime - adjusted[i].startTime;
        // TTS 比原片段短 → 保留原时长给原声留白；TTS 更长 → 用 TTS 时长
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

    await trimVideo(videoPath, segPath, startStr, endStr);
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
    // 无音频，直接复制视频
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

  if (!hasBgm) {
    // 无 BGM 路径：维持旧行为
    if (muteOriginal) {
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

  // 有 BGM：用 sidechaincompress 在配音时压低背景音乐（ducking）
  const vol = clamp(bgmVolume, 0.05, 0.5);
  if (muteOriginal) {
    // 视频原声丢弃；输入：[0]video, [1]tts, [2]bgm
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
    // 保留原声 + TTS + BGM 三轨
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
  if (muteOriginal) {
    await execAsync(
      `ffmpeg -i "${videoPath}" -i "${bgmPath}" -filter_complex "[1:a]aloop=loop=-1:size=2e9,volume=${vol}[bgm]" -map 0:v:0 -map "[bgm]" -c:v copy -c:a aac -shortest "${outputPath}" -y`
    );
  } else {
    await execAsync(
      `ffmpeg -i "${videoPath}" -i "${bgmPath}" -filter_complex "[1:a]aloop=loop=-1:size=2e9,volume=${vol}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[a]" -map 0:v:0 -map "[a]" -c:v copy -c:a aac "${outputPath}" -y`
    );
  }
}

/**
 * 把视频缩放到目标宽高，采用 cover / center-crop 模式：
 * 先放大到至少覆盖目标尺寸（保持原比例），再居中裁掉多余部分。
 * 不补黑边，画面始终填满；多余内容会被裁剪。
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

  // 保留 srt 文件供下载，清理临时视频
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
      `片段${i + 1}: "${c.narration}" (视频源${c.videoIndex}, ${c.startTime.toFixed(1)}s-${c.endTime.toFixed(1)}s, 转场:${c.transition || "fade"} ${(c.transitionDuration ?? 0.4).toFixed(1)}s)`
    )
    .join("\n");

  const configDesc = autoConfig
    ? `画幅:${autoConfig.aspect} 音色:${autoConfig.voiceId} 语速:${autoConfig.speed} BGM:${autoConfig.bgmMood} 字幕:${autoConfig.subtitlesEnabled ? (autoConfig.subtitlesBurnIn ? "烧录" : "仅SRT") : "关"}`
    : "手动配置";

  const systemPrompt = `你是一个专业视频质量审核员。审查 AI 生成的脚本和剪辑方案，给出客观评分和具体可执行的修改建议。

审查维度：
1. 贴合度：是否真正理解并响应用户需求（而不是套模板）
2. 脚本质量：是否有画面叙事逻辑、信息密度是否合理、文案是否适配类型
3. 剪辑方案：片段时长是否合理、画面匹配是否有逻辑、转场是否合适
4. 可执行性：选用的素材是否真实可用、参数是否正确

评分：
- 8-10：可直接执行
- 5-7：需要小幅修改
- 1-4：需要大幅重写（并给出明确的重写方向）

重要：如果评分低于 5，suggestions 必须给出具体到每个片段的重写方向，不能只说"吸引力不足"这种空话。

返回 JSON：
{
  "score": 8,
  "scriptReview": "具体评价（50字内）",
  "clipReview": "片段问题（50字内）",
  "suggestions": ["具体可执行的改进1", "改进2"],
  "riskWarnings": ["风险提示"]
}`;

  const result = await getDeepSeek().chat.completions.create({
    model: ENV.deepseekModel,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `用户需求：${prompt}\n\nAI 配置：${configDesc}\n\n脚本标题：${scriptResult.title}\n完整脚本：${scriptResult.script}\n\n剪辑方案（${scriptResult.clips.length} 段）：\n${clipsDesc}\n\n请审查并打分。`,
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

  if (!params.prompt || params.prompt.trim().length === 0) {
    throw new Error("请提供创作需求描述");
  }

  await updateProgress(3);

  // 1. 查询用户已分析的视频
  const videoSummaries = await getAnalyzedVideos(task.userId, params.projectId);
  if (videoSummaries.length === 0) {
    throw new Error("没有已分析的视频素材，请先上传视频并完成 AI 分析后再进行创作");
  }

  await updateProgress(8);

  // 2. Phase 0: AI 自动决策（autoMode=true 或缺少关键参数时执行）
  const isAuto = params.autoMode !== false;
  let autoConfig: AutoConfig | null = null;
  if (isAuto) {
    autoConfig = await phase0AutoConfig(params.prompt);
  }

  // 用户显式覆盖优先于自动决策
  const finalVoiceId =
    params.voiceId || autoConfig?.voiceId || "female-chengshu";
  const finalSpeed = clamp(
    params.speed ?? autoConfig?.speed ?? 1.0,
    0.5, 2.0,
  );
  const finalAspect: AspectRatio =
    params.aspect || autoConfig?.aspect || "9:16";
  const finalResolution: ResolutionTier =
    params.resolution || autoConfig?.resolution || "1080p";
  const finalSubtitleStyle: SubtitleStyle =
    params.subtitleStyle || autoConfig?.subtitleStyle || "default";
  let finalBgmMood: BgmMood =
    params.bgmMood || autoConfig?.bgmMood || "none";
  const finalBgmVolume =
    params.bgmVolume ?? autoConfig?.bgmVolume ?? 0.15;

  // 用户提示里明确要求 BGM 但 LLM 返回了 "none" → 兜底选 upbeat
  if (finalBgmMood === "none" && /(?:bgm|背景音乐|配乐|音乐|加个bgm|加点bgm|来点bgm)/i.test(params.prompt)) {
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
  let intent: IntentResult;
  if (params.approvedPlan) {
    intent = { topic: "", style: "", targetDuration: 30, selectedVideoIds: [], reasoning: "用户已确认方案" };
  } else {
    intent = await phase1Intent(params.prompt, videoSummaries);
    if (intent.selectedVideoIds.length === 0) {
      throw new Error(`AI 未找到合适的视频素材。${intent.reasoning}`);
    }
  }

  await updateProgress(22);

  const selectedVideoIds = params.approvedPlan
    ? videoSummaries.map((v) => v.id)
    : intent.selectedVideoIds;
  const selectedVideos = videoSummaries.filter((v) =>
    selectedVideoIds.includes(v.id)
  );

  // 4. Phase 2: 脚本 + 剪辑计划（用户确认后直接用已审批方案）
  let scriptResult: ScriptResult;
  if (params.approvedPlan) {
    scriptResult = params.approvedPlan;
    // 确保 clips 中的 videoIndex 在 selectedVideoIds 范围内
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
      selectedVideoIds
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
      const enhancedPrompt = `${params.prompt}\n\n【额外要求】上次方案审查不通过（${review.score}分），请改进：${review.suggestions.join("；")}`;
      scriptResult = await phase2Script(enhancedPrompt, intent.topic, intent.style, intent.targetDuration, selectedVideos, selectedVideoIds);
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
        message: `审查完成 · ${review.score >= 7 ? "建议通过" : "建议修改"}`,
      };
    }

  // ====== 用户已确认，继续执行 Phase 3-5 ======
  const finalVideoIds = selectedVideoIds;

  // 5. Phase 3: TTS 生成配音
  let audioPath: string | null = null;
  if (!noAudio) {
    audioPath = await generateTtsAudio(
      scriptResult.script,
      finalVoiceId,
      finalSpeed,
      task.id
    );
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

  // 6. Phase 4: 剪辑 + 合成（使用已对齐音频时长的 clip）
  const editedPath = await executeEditPlan(
    task.id,
    scriptResult.clips,
    selectedVideoIds,
    scriptResult.muteOriginal,
    null // 暂不在这里混音，下面统一处理 BGM
  );

  await updateProgress(70);

  // 7. 混音：TTS + BGM ducking（或仅 BGM / 仅 TTS）
  const bgmPath = pickBgmByMood(finalBgmMood);
  const mixedPath = outputPath(task.id, "mixed");
  if (audioPath) {
    await mixAudio(editedPath, audioPath, mixedPath, scriptResult.muteOriginal, bgmPath, finalBgmVolume);
  } else if (bgmPath) {
    await mixBgmOnly(editedPath, mixedPath, bgmPath, finalBgmVolume, scriptResult.muteOriginal);
  } else if (scriptResult.muteOriginal) {
    await execAsync(`ffmpeg -i "${editedPath}" -an -c:v copy "${mixedPath}" -y`);
  } else {
    await execAsync(`ffmpeg -i "${editedPath}" -c copy "${mixedPath}" -y`);
  }
  if (fs.existsSync(editedPath) && editedPath !== mixedPath) {
    fs.unlinkSync(editedPath);
  }

  await updateProgress(78);

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
      // 复用 Phase 3.5 的 Whisper 结果，合并为完整句子再生成字幕
      try {
        const merged = await mergeToSentences(whisperSegments);
        srtContent = srtFromWhisperSegments(merged);
      } catch (e) {
        console.warn("[AI Creator] 字幕合并失败，使用原始片段:", String(e));
        srtContent = srtFromWhisperSegments(whisperSegments);
      }
    } else {
      srtContent = generateSrtFromClips(scriptResult.clips);
    }

    if (subtitlesBurnIn && srtContent) {
      const burntPath = outputPath(task.id, "final");
      await burnSubtitlesToVideo(scaledPath, srtContent, task.id, burntPath, finalSubtitleStyle, params.subtitleConfig);
      finalPathWithSubs = burntPath;
      if (fs.existsSync(scaledPath) && scaledPath !== burntPath) {
        fs.unlinkSync(scaledPath);
      }
    } else {
      // 不烧录：把 scaled 作为最终输出
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
