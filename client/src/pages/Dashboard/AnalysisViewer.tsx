import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Loader2, Film, Tag, Star, FileText, AlertTriangle, CheckCircle2, Volume2, Camera, Zap } from "lucide-react";

function formatSec(s: unknown): string {
  const n = typeof s === "number" ? s : parseFloat(String(s));
  if (isNaN(n)) return "?";
  const m = Math.floor(n / 60);
  const sec = Math.floor(n % 60);
  const ms = Math.round((n % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}${ms ? "." + ms : ""}`;
}

function formatRange(start: unknown, end: unknown): string {
  return `${formatSec(start)} → ${formatSec(end)}`;
}

function formatDuration(start: unknown, end: unknown): string {
  const s = typeof start === "number" ? start : parseFloat(String(start));
  const e = typeof end === "number" ? end : parseFloat(String(end));
  if (isNaN(s) || isNaN(e)) return "";
  const dur = e - s;
  return dur > 0 ? `${dur.toFixed(1)}s` : "";
}

const QUALITY_CFG: Record<string, { label: string; cls: string }> = {
  优质: { label: "优质", cls: "bg-green-100 text-green-700 border-green-200" },
  可用: { label: "可用", cls: "bg-blue-100 text-blue-700 border-blue-200" },
  一般: { label: "一般", cls: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  较差: { label: "较差", cls: "bg-red-100 text-red-600 border-red-200" },
};

const WASTE_TYPE_CFG: Record<string, string> = {
  黑屏: "bg-gray-800 text-white",
  白屏: "bg-gray-100 text-gray-700",
  闪白: "bg-orange-100 text-orange-700",
  闪黑: "bg-orange-100 text-orange-700",
  模糊: "bg-amber-100 text-amber-700",
  晃动: "bg-amber-100 text-amber-700",
  花屏: "bg-red-100 text-red-700",
  无关: "bg-purple-100 text-purple-700",
  极短: "bg-gray-100 text-gray-600",
  重复帧: "bg-indigo-100 text-indigo-700",
};

type Props = { taskId?: number; videoId?: number };

export default function AnalysisViewer({ taskId, videoId }: Props) {
  const byTask = trpc.analysis.byTaskId.useQuery(
    { taskId: taskId! },
    { enabled: !!taskId && !videoId }
  );
  const byVideo = trpc.analysis.byVideoId.useQuery(
    { videoId: videoId! },
    { enabled: !!videoId }
  );

  const { data, isLoading } = videoId ? byVideo : byTask;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.success || !data.data) {
    return (
      <div className="text-center py-12">
        <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground text-sm">暂无分析结果，请先对视频执行分析任务</p>
      </div>
    );
  }

  const result = data.data as Record<string, any>;
  const scenes = (result.sceneDescriptions || []) as any[];
  const keywords = (result.keywords || []) as string[];
  const highlights = (result.highlights || []) as any[];
  const metadata = (result.metadata || {}) as Record<string, any>;
  const wasteSegments = (metadata.wasteSegments || []) as any[];
  const summary = metadata.summary as string;
  const category = metadata.category as string;
  const usabilityScore = metadata.usabilityScore as number | undefined;
  const hasClearAudio = metadata.hasClearAudio as boolean | undefined;

  const totalWasteDuration = wasteSegments.reduce((acc: number, w: any) => {
    const d = (w.endTime ?? 0) - (w.startTime ?? 0);
    return acc + (d > 0 ? d : 0);
  }, 0);

  return (
    <div className="space-y-4">
      {/* 概述 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            分析概览
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex flex-wrap gap-2 items-center">
            {category && <Badge variant="secondary">{category}</Badge>}
            {usabilityScore !== undefined && (
              <Badge
                variant="outline"
                className={usabilityScore >= 7 ? "text-green-700 border-green-300" : usabilityScore >= 4 ? "text-amber-700 border-amber-300" : "text-red-700 border-red-300"}
              >
                可用度 {usabilityScore}/10
              </Badge>
            )}
            {hasClearAudio !== undefined && (
              <Badge variant="outline" className={hasClearAudio ? "text-blue-700 border-blue-300" : "text-muted-foreground"}>
                <Volume2 className="h-3 w-3 mr-1" />
                {hasClearAudio ? "清晰人声" : "无清晰人声"}
              </Badge>
            )}
            {wasteSegments.length > 0 && (
              <Badge variant="outline" className="text-red-700 border-red-300">
                <AlertTriangle className="h-3 w-3 mr-1" />
                废片 {wasteSegments.length} 处 ({totalWasteDuration.toFixed(1)}s)
              </Badge>
            )}
          </div>
          {summary && <p className="text-sm text-muted-foreground leading-relaxed">{summary}</p>}
        </CardContent>
      </Card>

      {/* 废片列表（高优先级，放在场景前面） */}
      {wasteSegments.length > 0 && (
        <Card className="border-red-200/60 bg-red-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" />
              废片识别 — 共 {wasteSegments.length} 处 · {totalWasteDuration.toFixed(1)}s 需剪除
            </CardTitle>
            <CardDescription className="text-xs">
              使用 <code className="bg-muted px-1 rounded">/清理废片</code> 或 <code className="bg-muted px-1 rounded">/剪辑 去掉所有废片</code> 可自动清除这些片段
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {wasteSegments.map((w: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-2 rounded-md border border-red-200/60 bg-white/60">
                  <span className="font-mono text-xs text-red-600 shrink-0 pt-0.5 min-w-[100px]">
                    {formatRange(w.startTime, w.endTime)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-red-800">{w.description || "未知废片"}</p>
                    <span className="text-[10px] text-red-500">{formatDuration(w.startTime, w.endTime)}</span>
                  </div>
                  {w.type && (
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${WASTE_TYPE_CFG[w.type] || "bg-gray-100 text-gray-600"}`}>
                      {w.type}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 关键词 */}
      {keywords.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Tag className="h-4 w-4 text-accent" />
              关键词
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-1.5">
              {keywords.map((kw, i) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {kw}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 精彩片段 */}
      {highlights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Star className="h-4 w-4 text-yellow-500" />
              精彩片段
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {highlights.map((hl: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-2 rounded-md border bg-yellow-50/40 border-yellow-200/60">
                  <div className="flex items-center gap-1 shrink-0 pt-0.5">
                    <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-400" />
                    <span className="text-xs font-bold text-yellow-700">{hl.score ?? "?"}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs">{hl.description}</p>
                    {hl.reason && <p className="text-[10px] text-muted-foreground mt-0.5">{hl.reason}</p>}
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0 text-right">
                    {formatRange(hl.startTime, hl.endTime)}<br />
                    <span className="text-yellow-600">{formatDuration(hl.startTime, hl.endTime)}</span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 场景分析 */}
      {scenes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Film className="h-4 w-4 text-accent" />
              场景分析
            </CardTitle>
            <CardDescription className="text-xs">共识别 {scenes.length} 个场景</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {scenes.map((scene: any, i: number) => {
                const qualityCfg = QUALITY_CFG[scene.quality] || QUALITY_CFG["可用"];
                return (
                  <div key={i} className="flex gap-3 p-2 rounded-md border">
                    <div className="shrink-0 text-right min-w-[90px]">
                      <span className="font-mono text-[10px] text-muted-foreground block">
                        {formatRange(scene.startTime, scene.endTime)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{formatDuration(scene.startTime, scene.endTime)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-relaxed">{scene.description}</p>
                      <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${qualityCfg.cls}`}>
                          {qualityCfg.label}
                        </span>
                        {scene.shotType && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-0.5">
                            <Camera className="h-2.5 w-2.5" />{scene.shotType}
                          </span>
                        )}
                        {scene.audioGuess && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-0.5">
                            <Volume2 className="h-2.5 w-2.5" />{scene.audioGuess}
                          </span>
                        )}
                        {(scene.tags || []).map((t: string, j: number) => (
                          <Badge key={j} variant="secondary" className="text-[10px] px-1 py-0 h-4">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {scenes.length === 0 && highlights.length === 0 && wasteSegments.length === 0 && (
        <div className="text-center py-8">
          <CheckCircle2 className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-sm text-muted-foreground">分析数据为空</p>
        </div>
      )}
    </div>
  );
}
