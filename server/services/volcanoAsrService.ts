import { openai } from "../_core/openai";
import { ENV } from "../_core/env";
import fs from "node:fs";
import path from "node:path";

export interface AsrSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * 将 ASR 片段合并为字幕级别的短句。
 * 策略：按标点拆开每个片段内部的子句，然后合并过短的相邻子句。
 * 不用 LLM —— 确定性规则，快速稳定。
 */
export async function mergeToSentences(segments: AsrSegment[]): Promise<AsrSegment[]> {
  if (segments.length <= 1) return segments;
  console.log(`[mergeToSentences] 输入 ${segments.length} 段`);

  // 第一步：按标点拆分每个片段内部的子句
  const atoms = splitByPunctuation(segments);

  // 第二步：合并过短的相邻子句
  const result = mergeShortAtoms(atoms);

  console.log(`[mergeToSentences] 输出 ${result.length} 条`);
  result.forEach((s, i) => console.log(`  [${i}] ${s.start.toFixed(1)}s-${s.end.toFixed(1)}s (${(s.end-s.start).toFixed(1)}s): "${s.text}"`));
  return result;
}

interface Atom extends AsrSegment {
  segIdx: number; // 来自哪个原始片段
}

interface Atom extends AsrSegment {
  segIdx: number;
  punct: "" | "soft" | "hard"; // 结尾标点类型
}

const SOFT_PUNCT = new Set(["，", "、", ",", ";"]);
const HARD_PUNCT = new Set(["。", "！", "？", ".", "!", "?"]);

/** 按标点拆分片段，标记每个子句结尾的标点类型 */
function splitByPunctuation(segments: AsrSegment[]): Atom[] {
  const punctRE = /[。！？，、.!?;,;]/g;
  const atoms: Atom[] = [];

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const text = seg.text.trim();
    if (!text) continue;

    const breaks: Array<{ pos: number; ch: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = punctRE.exec(text)) !== null) {
      breaks.push({ pos: m.index + 1, ch: m[0] });
    }

    if (breaks.length === 0) {
      atoms.push({ ...seg, segIdx: si, punct: "" });
      continue;
    }

    const totalLen = text.length;
    const duration = seg.end - seg.start;
    let prev = 0;
    for (let bi = 0; bi < breaks.length; bi++) {
      const bp = breaks[bi].pos;
      const lastCh = breaks[bi].ch;
      const subText = text.slice(prev, bp).trim();
      if (subText) {
        const punctType = HARD_PUNCT.has(lastCh) ? "hard" : SOFT_PUNCT.has(lastCh) ? "soft" : "";
        atoms.push({
          start: seg.start + (prev / totalLen) * duration,
          end: seg.start + (bp / totalLen) * duration,
          text: subText,
          segIdx: si,
          punct: punctType,
        });
      }
      prev = bp;
    }
    if (prev < text.length) {
      const rest = text.slice(prev).trim();
      if (rest) {
        atoms.push({ start: seg.start + (prev / totalLen) * duration, end: seg.end, text: rest, segIdx: si, punct: "" });
      }
    }
  }

  console.log(`[splitByPunctuation] ${segments.length} 段 → ${atoms.length} 个原子子句`);
  return atoms;
}

/**
 * 将原子子句分组为字幕条目。
 * - 每个标点 → 一条字幕，单独一行显示
 * - 只合并同一片段内都 < 5 字的相邻极短子句
 * - 跨片段边界不合并
 */
function mergeShortAtoms(atoms: Atom[]): AsrSegment[] {
  if (atoms.length <= 1) return atoms.map(({ segIdx, punct, ...s }) => s);

  const result: AsrSegment[] = [];
  let buf: Atom[] = [];

  function flush() {
    if (buf.length === 0) return;
    result.push({
      start: buf[0].start,
      end: buf[buf.length - 1].end,
      text: buf.map((a) => a.text).join(""),
    });
    buf = [];
  }

  for (const a of atoms) {
    // 跨片段 → flush
    if (buf.length > 0 && a.segIdx !== buf[0].segIdx) {
      flush();
    }

    buf.push(a);

    const prevLen = buf.length >= 2 ? buf[buf.length - 2].text.replace(/\s/g, "").length : 99;
    const curLen = a.text.replace(/\s/g, "").length;

    // 前一个子句 ≥ 5 字，且当前也 ≥ 5 字 → 前一个独立 flush
    if (buf.length >= 2 && prevLen >= 5 && curLen >= 5) {
      // 弹出当前，flush 前一个组（可能只有它自己），再放回
      buf.pop();
      flush();
      buf.push(a);
      continue;
    }

    // 累积超过 20 字或 4 秒 → flush
    const totalChars = buf.reduce((n, a) => n + a.text.replace(/\s/g, "").length, 0);
    const dur = buf[buf.length - 1].end - buf[0].start;
    if (totalChars >= 20 || dur >= 4) {
      flush();
    }
  }
  flush();

  return result;
}

/**
 * 用火山方舟 LLM 的语音能力识别字幕
 * 优先用 /v1/audio/transcriptions，不支持则走 Chat 多模态
 */
export async function transcribeAudio(audioPath: string): Promise<AsrSegment[]> {
  const audioBuffer = fs.readFileSync(audioPath);
  const ext = path.extname(audioPath).replace(".", "").toLowerCase();

  // -------- 方式 1: 标准 transcription 接口 --------
  try {
    // 用 File 构造上传对象
    const blob = new Blob([audioBuffer]);
    const file = new File([blob], `audio.${ext}`);
    const resp = await openai.audio.transcriptions.create({
      file,
      model: ENV.openaiWhisperModel,
      response_format: "verbose_json",
    });

    const segments = (resp as any).segments as Array<{ start: number; end: number; text: string }> | undefined;
    if (segments?.length) {
      return segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
    }
    if ((resp as any).text) {
      return [{ start: 0, end: 5, text: (resp as any).text.trim() }];
    }
  } catch {
    console.log("[ASR] transcription 接口不可用，尝试 Chat 多模态...");
  }

  // -------- 方式 2: Chat 多模态 --------
  const prompt = `请将这段音频逐句转写，返回 JSON 数组：[{"start":起始秒,"end":结束秒,"text":"文本"},...]。只返回 JSON，不要其他文字。空音频返回 []。`;

  const response = await openai.chat.completions.create({
    model: ENV.openaiChatModel,
    messages: [{
      role: "user",
      content: [
        { type: "input_audio", input_audio: { data: audioBuffer.toString("base64"), format: ext } },
        { type: "text", text: prompt },
      ],
    }] as any,
    max_tokens: 4096,
    temperature: 0,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("豆包未返回字幕内容，当前模型可能不支持音频输入。试试 doubao-seed-2-0 或 doubao-1-5-vision-pro。");
  }

  return parseSrtJson(content);
}

function parseSrtJson(raw: string): AsrSegment[] {
  let json = raw.trim();
  const fence = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) json = fence[1].trim();
  const arr = json.match(/\[[\s\S]*\]/);
  if (arr) {
    try {
      const parsed = JSON.parse(arr[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((s: any) => s.text?.trim())
          .map((s: any) => ({ start: Number(s.start || 0), end: Number(s.end || 0), text: String(s.text).trim() }));
      }
    } catch { /* fall through */ }
  }
  throw new Error(`豆包返回格式无法解析: ${raw.slice(0, 300)}`);
}
