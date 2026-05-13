import fs from "node:fs";
import path from "node:path";

export type BgmMood =
  | "upbeat"
  | "calm"
  | "dramatic"
  | "warm"
  | "energetic"
  | "cinematic"
  | "none";

const BGM_ROOT = path.resolve("uploads/bgm");
const BGM_EXTS = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"]);

const MOOD_FALLBACK: Record<Exclude<BgmMood, "none">, BgmMood[]> = {
  upbeat: ["energetic", "warm", "calm"],
  calm: ["warm", "cinematic"],
  dramatic: ["cinematic", "energetic"],
  warm: ["calm", "upbeat"],
  energetic: ["upbeat", "dramatic"],
  cinematic: ["dramatic", "calm"],
};

function listAudioFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => BGM_EXTS.has(path.extname(f).toLowerCase()))
    .map((f) => path.join(dir, f));
}

/**
 * 按情绪挑一首 BGM。优先匹配 mood，找不到时按 MOOD_FALLBACK 顺序回退。
 * 没有任何 BGM 文件时返回 null（管线应跳过 BGM 步骤）。
 */
export function pickBgmByMood(mood: BgmMood): string | null {
  if (mood === "none") return null;
  if (!fs.existsSync(BGM_ROOT)) return null;

  const tryMoods: BgmMood[] = [mood, ...(MOOD_FALLBACK[mood] || [])];
  for (const m of tryMoods) {
    if (m === "none") continue;
    const files = listAudioFiles(path.join(BGM_ROOT, m));
    if (files.length > 0) {
      return files[Math.floor(Math.random() * files.length)];
    }
  }
  // 最后兜底：BGM_ROOT 根目录下的散文件
  const rootFiles = listAudioFiles(BGM_ROOT);
  if (rootFiles.length > 0) {
    return rootFiles[Math.floor(Math.random() * rootFiles.length)];
  }
  return null;
}

/**
 * 检查每个 mood 子目录是否有素材，供前端/调试使用。
 */
export function bgmInventory(): Record<Exclude<BgmMood, "none">, number> {
  const moods: Exclude<BgmMood, "none">[] = [
    "upbeat", "calm", "dramatic", "warm", "energetic", "cinematic",
  ];
  const out = {} as Record<Exclude<BgmMood, "none">, number>;
  for (const m of moods) {
    out[m] = listAudioFiles(path.join(BGM_ROOT, m)).length;
  }
  return out;
}

export interface BgmFile {
  name: string;
  mood: string; // 文件夹名
  path: string; // 相对路径，用于 stream API
}

export function listBgmFiles(): BgmFile[] {
  const moods: Array<{ key: string; label: string }> = [
    { key: "upbeat", label: "欢快" },
    { key: "calm", label: "舒缓" },
    { key: "dramatic", label: "戏剧性" },
    { key: "warm", label: "温暖" },
    { key: "energetic", label: "活力" },
    { key: "cinematic", label: "电影感" },
  ];
  const result: BgmFile[] = [];
  for (const m of moods) {
    const files = listAudioFiles(path.join(BGM_ROOT, m.key));
    for (const f of files) {
      const rel = path.relative(path.resolve("."), f).replace(/\\/g, "/");
      result.push({ name: path.basename(f), mood: m.key, path: rel });
    }
  }
  // 根目录散文件
  const rootFiles = listAudioFiles(BGM_ROOT);
  for (const f of rootFiles) {
    const rel = path.relative(path.resolve("."), f).replace(/\\/g, "/");
    result.push({ name: path.basename(f), mood: "other", path: rel });
  }
  return result;
}

export { BGM_ROOT };
