export type SubtitleStyle =
  | "default"
  | "bold_caption"
  | "minimal"
  | "tiktok_yellow";

export const SUBTITLE_STYLES: SubtitleStyle[] = [
  "default",
  "bold_caption",
  "minimal",
  "tiktok_yellow",
];

/**
 * 用户可在前端覆盖的字幕样式字段。
 * 颜色字段使用 "#RRGGBB" 形式，函数内部会转成 ASS 的 "&H00BBGGRR"。
 */
export interface SubtitleConfig {
  fontName?: string;
  fontSize?: number;
  primaryColor?: string;   // "#RRGGBB" 字幕主色
  outlineColor?: string;   // "#RRGGBB" 描边颜色
  outline?: number;        // 0-5
  shadow?: number;         // 0-3
  bold?: boolean;
  italic?: boolean;
  marginV?: number;        // 距离画面边缘的像素
  /** 1=BL 2=BC 3=BR 4=ML 5=MC 6=MR 7=TL 8=TC 9=TR */
  alignment?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

interface StyleObj {
  FontName?: string;
  FontSize: number;
  Bold: 0 | 1;
  Italic?: 0 | 1;
  PrimaryColour: string;
  OutlineColour: string;
  Outline: number;
  Shadow: number;
  MarginV: number;
  Alignment?: number;
}

const PRESETS: Record<SubtitleStyle, StyleObj> = {
  default:      { FontSize: 16, Bold: 1, PrimaryColour: "&H00FFFFFF", OutlineColour: "&H00000000", Outline: 2, Shadow: 1, MarginV: 50, Alignment: 2 },
  bold_caption: { FontSize: 28, Bold: 1, PrimaryColour: "&H00FFFFFF", OutlineColour: "&H00000000", Outline: 4, Shadow: 1, MarginV: 60 },
  tiktok_yellow:{ FontSize: 26, Bold: 1, PrimaryColour: "&H0000FFFF", OutlineColour: "&H00000000", Outline: 3, Shadow: 1, MarginV: 70 },
  minimal:      { FontSize: 18, Bold: 0, PrimaryColour: "&H00FFFFFF", OutlineColour: "&H66000000", Outline: 1, Shadow: 0, MarginV: 40 },
};

/** "#RRGGBB" → ASS 的 "&H00BBGGRR"。非法输入返回空串。 */
function hexToAss(hex: string | undefined): string {
  if (!hex) return "";
  const m = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return "";
  const r = m.slice(0, 2);
  const g = m.slice(2, 4);
  const b = m.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function mergeConfig(base: StyleObj, cfg?: SubtitleConfig): StyleObj {
  if (!cfg) return base;
  const out: StyleObj = { ...base };
  if (cfg.fontName && cfg.fontName.trim()) out.FontName = cfg.fontName.trim();
  if (typeof cfg.fontSize === "number" && cfg.fontSize > 0) out.FontSize = Math.round(cfg.fontSize);
  if (typeof cfg.bold === "boolean") out.Bold = cfg.bold ? 1 : 0;
  if (typeof cfg.italic === "boolean") out.Italic = cfg.italic ? 1 : 0;
  const pc = hexToAss(cfg.primaryColor);
  if (pc) out.PrimaryColour = pc;
  const oc = hexToAss(cfg.outlineColor);
  if (oc) out.OutlineColour = oc;
  if (typeof cfg.outline === "number" && cfg.outline >= 0) out.Outline = cfg.outline;
  if (typeof cfg.shadow === "number" && cfg.shadow >= 0) out.Shadow = cfg.shadow;
  if (typeof cfg.marginV === "number" && cfg.marginV >= 0) out.MarginV = Math.round(cfg.marginV);
  if (typeof cfg.alignment === "number") out.Alignment = cfg.alignment;
  return out;
}

function stringifyStyle(obj: StyleObj): string {
  // 顺序无影响,但保持稳定便于 debug
  const parts: string[] = [];
  if (obj.FontName) parts.push(`FontName=${obj.FontName}`);
  parts.push(`FontSize=${obj.FontSize}`);
  parts.push(`Bold=${obj.Bold}`);
  if (typeof obj.Italic === "number") parts.push(`Italic=${obj.Italic}`);
  parts.push(`PrimaryColour=${obj.PrimaryColour}`);
  parts.push(`OutlineColour=${obj.OutlineColour}`);
  parts.push(`Outline=${obj.Outline}`);
  parts.push(`Shadow=${obj.Shadow}`);
  parts.push(`MarginV=${obj.MarginV}`);
  if (typeof obj.Alignment === "number") parts.push(`Alignment=${obj.Alignment}`);
  return parts.join(",");
}

export function subtitleStyleString(
  style: SubtitleStyle,
  config?: SubtitleConfig,
): string {
  const base = PRESETS[style] || PRESETS.default;
  return stringifyStyle(mergeConfig(base, config));
}
