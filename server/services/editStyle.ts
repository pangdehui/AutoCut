/**
 * 剪辑风格模板系统
 *
 * 定义了一系列"爆款视频公式"的结构化模板，用于约束 AI 的剪辑决策。
 * 每个模板包含：
 * 1. Prompt 规则 — 注入到大模型的 System Prompt 中
 * 2. 硬约束 — 在 AI 返回 JSON 后执行的代码级强制规则
 *
 * 参考 subtitleStyle.ts 的 PRESETS 模式。
 */

// ====== 类型定义 ======

export type EditStyle = "auto" | "ecommerce_matrix" | "knowledge_talk" | "emotional_story";

export const EDIT_STYLES: EditStyle[] = [
  "auto",
  "ecommerce_matrix",
  "knowledge_talk",
  "emotional_story",
];

// ====== 配置接口 ======

export interface EditStyleConfig {
  label: string;
  /** 中文显示名称 */
  labelZh: string;
  description: string;
  /** UI 中的中文描述 */
  descriptionZh: string;
  /** 注入到 System Prompt 中的规则文本 */
  promptRules: string;
  /** 硬约束：单切片最大时长（秒） */
  maxSegmentDuration: number;
  /** 硬约束：单切片最小时长（秒） */
  minSegmentDuration: number;
  /** 总时长范围 [最小, 最大]，null = 不覆盖 */
  totalDurationRange?: [number, number];
  /** 首段效果：如为 true，强制首段使用 zoomin 转场 */
  forceFirstSegmentEffect?: boolean;
  /** 超过此值的切片会被自动一分为二，0 = 不拆分 */
  splitSegmentsLongerThan: number;
  /** 同源视频最多出现次数限制 */
  enforceSourceVariety?: boolean;
}

// ====== 预设定义 ======

const PRESETS: Record<EditStyle, EditStyleConfig> = {
  auto: {
    label: "Auto",
    labelZh: "智能自动",
    description: "AI determines the best style based on content analysis",
    descriptionZh: "由 AI 根据内容自动选择最合适的剪辑风格",
    promptRules: "",
    maxSegmentDuration: 8,
    minSegmentDuration: 0.8,
    forceFirstSegmentEffect: false,
    splitSegmentsLongerThan: 0,
    enforceSourceVariety: false,
  },

  ecommerce_matrix: {
    label: "E-commerce Matrix",
    labelZh: "电商带货",
    description: "Fast-paced product showcase with short segments, frequent cuts, and urgency-driven pacing",
    descriptionZh: "快节奏带货风格：短片段+高频切换+紧迫感节奏，适合商品展示和直播切片",
    promptRules: `### E-Commerce Matrix Style (以下规则优先级高于默认规则)

**切片架构（硬性要求）：**
- 钩子 (0-2s): 痛点或结果先行 — 产品最震撼的 before/after 或最 compelling 的特性。必须在 ≤2.5s 内抓住眼球。
- 问题放大 (2-25%): 2-3 个快速切片 (1.5-2.5s 每个)，展示该产品解决的问题场景。
- 产品展示 (25-65%): 交替特写 (1.5-3s) 和使用场景 (2-4s)。每隔一个切片必须是特写镜头。
- 社会证明 (65-80%): 快速口碑、使用成果、数据。2-3 个切片，每个 2-3s。
- 稀缺性 + 行动号召 (80-100%): 紧迫感文字、价格锚点、行动号召。总计 3-5s。

**时长规则（硬性）：**
- 总时长: 25-40s（硬限制）。如用户指定了时长则以用户为准，否则默认 30s
- 单切片最大: 6s（覆盖默认的 8s）。任何 >6s 的切片必须拆分
- 钩子切片: 1.0-2.5s。主体切片: 1.5-4.0s。最大不超过 6s

**转场规则：**
- >70% 必须是 "cut"（硬切制造紧迫感）
- 仅在产品揭晓时刻使用 "zoomin"（全片最多 2 次）
- 禁止使用 "fadeblack" 和 "fadewhite" — 会消除紧迫感
- before/after 对比时允许使用 "slideleft"/"slideright"

**视觉规则：**
- 每次提到产品时必须有产品特写画面
- 至少 40% 的切片必须是特写或细节镜头
- 产品包装展示不超过 2s — 快速切到产品本身

**文案节奏：**
- 多用数字和具体信息："降价300元" 而非 "便宜了好多"
- 短句，每段 5-15 字
- 紧迫感词汇："限时", "仅限今天", "点击下方", "错过等一年"
- 不要慢节奏情感铺垫 — 每个切片都必须推动销售转化`,
    maxSegmentDuration: 6,
    minSegmentDuration: 1.0,
    totalDurationRange: [25, 40],
    forceFirstSegmentEffect: false,
    splitSegmentsLongerThan: 6,
    enforceSourceVariety: true,
  },

  knowledge_talk: {
    label: "Knowledge Talk",
    labelZh: "知识口播",
    description: "Informative talking-head style with zoom-in opening, clear pacing, and explanatory visuals",
    descriptionZh: "知识科普风格：开篇放大强调+清晰节奏+讲解型画面，适合教程/知识分享",
    promptRules: `### Knowledge Talk Style（以下规则优先级高于默认规则）

**切片架构（硬性要求）：**
- 钩子 (0-3s): 必须以一个令人惊讶的事实、反直觉问题或挑衅性陈述开场。**首段必须使用 "zoomin" 转场** 来强调开场陈述。
- 背景 (3-20%): 为什么这个话题重要，大多数人的误解是什么（2-3 切片，2-3s 每个）
- 证据链 (20-75%): 3-5 个切片展示数据、示例、演示。每个 3-5s
- 顿悟时刻 (75-90%): 核心洞察，让观众"原来如此"的关键揭示。3-6s
- 互动结尾 (90-100%): "你觉得呢？", "评论区告诉我" 或引导思考的问题。2-4s

**时长规则：**
- 总时长: 40-90s（知识内容需要更深入的展开）
- 钩子: 1.5-3.5s 每段。证据切片: 2.5-5s。顿悟: 3-6s
- 单切片最大: 8s（保持默认）

**转场规则：**
- **首段必须使用 "zoomin"** 作为进入转场（从黑场/前一画面推近）
- >50% 使用 "cut"（干净、专业）
- 同段内主题切换使用 "dissolve"（0.3-0.4s）
- "fadeblack" 全片最多 1 次，仅在顿悟时刻前的大章节切换时使用
- 禁止使用 "slideleft"/"slideright" — 对知识内容来说过于随意

**视觉规则：**
- 如有口播画面，至少 30% 的切片应包含口播者面部（面部=信任感）
- 在口播画面之间穿插 B-roll/演示切片
- 文字/数据/图表切片保留 3-5s（需要阅读时间）
- 每 3 个切片至少包含 1 个特写

**文案节奏：**
- 用好奇缺口引导："你知道吗？", "很多人以为...但其实..."
- 用类比和具体例子代替抽象陈述
- 钩子句 10-20 字，主体句 15-25 字
- 对话式但有权威感`,
    maxSegmentDuration: 8,
    minSegmentDuration: 1.5,
    totalDurationRange: [40, 90],
    forceFirstSegmentEffect: true,
    splitSegmentsLongerThan: 0,
    enforceSourceVariety: false,
  },

  emotional_story: {
    label: "Emotional Story",
    labelZh: "情感叙事",
    description: "Slow-paced storytelling with longer clips, gentle transitions, and emotional resonance",
    descriptionZh: "情感叙事风格：慢节奏+长片段+柔和转场+情感共鸣，适合 Vlog/故事/治愈内容",
    promptRules: `### Emotional Story Style（以下规则优先级高于默认规则）

**切片架构（硬性要求）：**
- 钩子 (0-4s): 一个情感锚点 — 一张脸、一个引人注目的细节、一个传达情绪的瞬间。**不是快切或提问式钩子**。让情绪自然展开。
- 铺垫 (4-60%): 分层叙事，节奏放慢。混合环境定场镜头和情感特写。3-5s 每个切片。
- 突破 (60-85%): 情感高峰 — 启示、领悟或情感释放。单个切片，4-8s。让它停留，不要急着切。
- 共鸣结尾 (85-100%): 一个普世真理、反思时刻或安静的收尾。3-5s。不要生硬的行动号召。

**时长规则：**
- 总时长: 45-90s（情感节奏需要空间）
- 钩子: 2-4s。铺垫: 3-6s。突破: 4-8s。结尾: 3-5s
- 单切片最大: 10s（覆盖默认的 8s，给情感时刻留空间）
- 至少 40% 的切片时长 ≥4s（慢节奏，可呼吸的节奏）

**转场规则：**
- >40% 使用 "dissolve"（平滑柔和的转场 — 情感叙事的标志）
- 时间流逝或反思停顿使用 "fade"（0.4-0.7s）
- 重大情感重置使用 "fadeblack"（全片最多 2 次，0.6-0.8s）
- "cut" 仅用于对比时刻（回忆闪回、醒悟瞬间）
- **禁止使用** "slideleft"/"slideright"、"wipeleft"/"wiperight" — 过于突兀

**视觉规则：**
- 优先选择"优质"评级的画面 — 颗粒感、抖动或糟糕构图会破坏情感沉浸
- 用全景建立场景，用特写传达情感
- 避免快速切换镜头 — 每个切片至少停留 2.5s
- 相邻切片的色彩和亮度保持一致（无刺眼的亮度跳跃）
- 如有人物，面部应出现在 >50% 的切片中

**文案节奏：**
- 更长的、更诗意的句子：15-25 字每段
- 情感语言："那一刻", "原来", "终于明白"
- 允许在叙事段落之间留白/长停顿
- 以一个超越具体故事的普世真理结尾`,
    maxSegmentDuration: 10,
    minSegmentDuration: 2.0,
    totalDurationRange: [45, 90],
    forceFirstSegmentEffect: false,
    splitSegmentsLongerThan: 0,
    enforceSourceVariety: false,
  },
};

// ====== 公开 API ======

export function getEditStyle(style?: string): EditStyleConfig {
  if (style && style in PRESETS) {
    return PRESETS[style as EditStyle];
  }
  return PRESETS.auto;
}

export function getEditStyleLabel(style?: string): string {
  return getEditStyle(style).labelZh;
}

/**
 * 将风格特定的 Prompt 规则注入到已有 prompt 中。
 * 这是**追加式**操作 — 不替换已有 prompt 内容。
 * 当 style 为 "auto" 或未定义时，原样返回。
 */
export function injectStyleRules(prompt: string, style?: string): string {
  if (!style || style === "auto") return prompt;
  const config = getEditStyle(style);
  if (!config.promptRules) return prompt;
  return `${prompt}\n\n## Style Rules (${config.labelZh})\n${config.promptRules}`;
}

/**
 * 后处理：对已解析的 EditPlan 执行硬约束。
 * 在 AI JSON 解析后、FFmpeg 执行前调用。
 * 直接修改 editPlan 并返回修改记录。
 */
export function applyHardConstraints(
  editPlan: { operation: string; params: Record<string, unknown> },
  style?: string,
): { modified: boolean; constraints: string[] } {
  if (!style || style === "auto") return { modified: false, constraints: [] };
  const config = getEditStyle(style);
  const constraints: string[] = [];

  if (editPlan.operation !== "slice") return { modified: false, constraints: [] };

  const slices = (editPlan.params.slices as any[]) || [];
  if (slices.length === 0) return { modified: false, constraints: [] };

  let modified = false;

  // 约束1：拆分超出 splitSegmentsLongerThan 的切片
  if (config.splitSegmentsLongerThan > 0) {
    const newSlices: any[] = [];
    for (const slice of slices) {
      const dur = timeToSeconds(slice.end) - timeToSeconds(slice.start);
      if (dur > config.splitSegmentsLongerThan) {
        const mid = timeToSeconds(slice.start) + dur / 2;
        newSlices.push({
          ...slice,
          end: secondsToTime(mid),
        });
        newSlices.push({
          ...slice,
          start: secondsToTime(mid),
          transition: "cut",
          transitionDuration: undefined,
        });
        modified = true;
        constraints.push(
          `拆分切片 [${slice.start}-${slice.end}]（${dur.toFixed(1)}s > ${config.splitSegmentsLongerThan}s 限制）为两段`,
        );
      } else {
        newSlices.push(slice);
      }
    }
    if (modified) {
      (editPlan.params.slices as any[]) = newSlices;
    }
  }

  // 约束2：强制首段效果标记（如 zoomin）
  if (config.forceFirstSegmentEffect && slices.length > 0) {
    (editPlan.params as any)._style_firstEffect = "zoomin";
    constraints.push("首段转场强制为 zoomin（风格要求）");
    modified = true;
  }

  // 约束3：钳制每个切片的时长在 [min, max] 范围内
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const dur = timeToSeconds(s.end) - timeToSeconds(s.start);
    if (dur < config.minSegmentDuration - 0.01) {
      const newEnd = secondsToTime(timeToSeconds(s.start) + config.minSegmentDuration);
      constraints.push(
        `切片 ${i + 1}: 从 ${dur.toFixed(1)}s 延长到 ${config.minSegmentDuration}s（最短时长限制）`,
      );
      s.end = newEnd;
      modified = true;
    }
    if (dur > config.maxSegmentDuration + 0.01) {
      const newEnd = secondsToTime(timeToSeconds(s.start) + config.maxSegmentDuration);
      constraints.push(
        `切片 ${i + 1}: 从 ${dur.toFixed(1)}s 裁剪到 ${config.maxSegmentDuration}s（最长时长限制）`,
      );
      s.end = newEnd;
      modified = true;
    }
  }

  return { modified, constraints };
}

// ====== 工具函数（自包含，避免循环依赖） ======

function timeToSeconds(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function secondsToTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
