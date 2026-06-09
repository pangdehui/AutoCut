import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2, FileVideo, FileAudio, FileText,
  Scissors, Wand2, Volume2, Subtitles, Download, Eye, Play, Sparkles, Inbox, Star, Pencil,
} from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import SubtitleViewer from "./SubtitleViewer";

const TYPE_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; gradient: string; chip: string }
> = {
  editing: {
    label: "视频剪辑",
    icon: <Scissors className="h-4 w-4" />,
    gradient: "bg-brand-gradient-cool",
    chip: "bg-brand-cyan/15 text-brand-cyan border-brand-cyan/30",
  },
  ai_edit: {
    label: "AI 剪辑",
    icon: <Wand2 className="h-4 w-4" />,
    gradient: "bg-brand-gradient-violet",
    chip: "bg-brand-violet/15 text-brand-violet border-brand-violet/30",
  },
  tts: {
    label: "AI 配音",
    icon: <Volume2 className="h-4 w-4" />,
    gradient: "bg-brand-gradient-warm",
    chip: "bg-brand-pink/15 text-brand-pink border-brand-pink/30",
  },
  subtitle: {
    label: "字幕生成",
    icon: <Subtitles className="h-4 w-4" />,
    gradient: "bg-brand-gradient-cool",
    chip: "bg-brand-cyan/15 text-brand-cyan border-brand-cyan/30",
  },
  ai_video_creator: {
    label: "AI 创作",
    icon: <Sparkles className="h-4 w-4" />,
    gradient: "bg-brand-gradient",
    chip: "bg-brand-violet/15 text-brand-violet border-brand-violet/30",
  },
};

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "ai_video_creator", label: "AI 创作" },
  { value: "ai_edit", label: "AI 剪辑" },
  { value: "editing", label: "视频剪辑" },
  { value: "tts", label: "AI 配音" },
  { value: "subtitle", label: "字幕生成" },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatTime(d: string | Date) {
  return new Date(d).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OutputList() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [player, setPlayer] = useState<{
    open: boolean;
    src: string;
    title: string;
    isAudio: boolean;
  }>({ open: false, src: "", title: "", isAudio: false });
  const [subtitleTaskId, setSubtitleTaskId] = useState<number | null>(null);
  const [iterateTask, setIterateTask] = useState<{ id: number; title: string } | null>(null);
  const [editInstruction, setEditInstruction] = useState("");
  const utils = trpc.useUtils();

  const iterateMutation = trpc.tasks.iteratePlan.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success("修改任务已创建，AI 正在重新生成（扣 15 积分）");
        setIterateTask(null);
        setEditInstruction("");
        utils.tasks.list.invalidate();
      } else {
        toast.error(res.message || "创建修改任务失败");
      }
    },
    onError: (err) => toast.error(err.message || "创建修改任务失败"),
  });

  const tasksQuery = trpc.tasks.list.useQuery({ status: "completed" });

  const tasks = tasksQuery.data?.data || [];
  const filteredTasks = useMemo(
    () =>
      typeFilter === "all"
        ? tasks
        : tasks.filter((t: any) => t.taskType === typeFilter),
    [tasks, typeFilter]
  );

  const getOutputInfo = (task: any) => {
    const result = task.result as Record<string, any> | null;
    if (!result) return null;

    // 方案确认阶段(phase==="review")的任务不算成品,跳过
    if (result.phase === "review") return null;

    const outputPath = result.outputPath || result.audioPath || result.burntVideo;
    const fileSize = result.fileSize || 0;

    if (outputPath) {
      const isAudio = outputPath.endsWith(".mp3") || outputPath.endsWith(".wav");
      return {
        outputPath,
        fileSize,
        isAudio,
        title: result.title as string | undefined,
        explanation: result.explanation || result.message || "",
        review: result.review,
        degradations: result.degradations as string[] | undefined,
      };
    }
    if (result.originalVideo) {
      return {
        outputPath: result.originalVideo as string,
        fileSize: 0,
        isAudio: false,
        title: undefined,
        explanation: result.message || "",
      };
    }
    return null;
  };

  if (tasksQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-violet" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <span className="inline-flex h-8 w-8 rounded-lg bg-brand-gradient-violet items-center justify-center shadow-brand-sm">
            <Inbox className="h-4 w-4 text-white" />
          </span>
          生成结果
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          所有 AI 创作 / 剪辑 / 配音 / 字幕的成品输出
        </p>
      </div>

      {/* 类型筛选 */}
      <div className="flex gap-2 flex-wrap">
        {TYPE_FILTERS.map((f) => {
          const count =
            f.value === "all"
              ? tasks.filter((t: any) => {
                  const r = t.result as any;
                  return !r?.phase || r.phase !== "review";
                }).length
              : tasks.filter((t: any) => {
                  const r = t.result as any;
                  return t.taskType === f.value && (!r?.phase || r.phase !== "review");
                }).length;
          const active = typeFilter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                active
                  ? "bg-brand-gradient text-white shadow-brand-sm"
                  : "bg-muted hover:bg-muted/70 text-foreground"
              }`}
            >
              {f.label}
              <span
                className={`text-xs ${active ? "text-white/80" : "text-muted-foreground"}`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {filteredTasks.length === 0 ? (
        <EmptyState typeFilter={typeFilter} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTasks.map((task: any) => {
            const cfg = TYPE_CONFIG[task.taskType] || TYPE_CONFIG.editing;
            const output = getOutputInfo(task);
            // 跳过停在 review 的方案确认任务
            if (!output && task.taskType === "ai_video_creator" && (task.result as any)?.phase === "review") return null;

            return (
              <OutputCard
                key={task.id}
                task={task}
                cfg={cfg}
                output={output}
                onPlay={(src, title, isAudio) => setPlayer({ open: true, src, title, isAudio })}
                onViewSubtitle={() => setSubtitleTaskId(task.id)}
                onIterate={() => setIterateTask({ id: task.id, title: output?.title || `任务 #${task.id}` })}
              />
            );
          })}
        </div>
      )}

      <VideoPlayer
        open={player.open}
        onClose={() => setPlayer({ open: false, src: "", title: "", isAudio: false })}
        title={player.title}
        src={player.src}
        isAudio={player.isAudio}
      />

      <Dialog
        open={subtitleTaskId !== null}
        onOpenChange={(v) => !v && setSubtitleTaskId(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              字幕详情 {subtitleTaskId !== null ? `#${subtitleTaskId}` : ""}
            </DialogTitle>
          </DialogHeader>
          {subtitleTaskId !== null && <SubtitleViewer taskId={subtitleTaskId} />}
        </DialogContent>
      </Dialog>

      {/* 迭代修改对话框 */}
      <Dialog
        open={iterateTask !== null}
        onOpenChange={(v) => {
          if (!v) {
            setIterateTask(null);
            setEditInstruction("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-brand-violet" />
              修改这版成品
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">
              用一句话说明想怎么改，AI 会在原方案基础上做最小改动后重新生成。
              <span className="text-brand-violet font-medium">扣 15 积分（半价）。</span>
            </p>
            <Textarea
              value={editInstruction}
              onChange={(e) => setEditInstruction(e.target.value)}
              placeholder="例如：开头第一段换更抓眼的镜头 / 第3段配音改成更口语 / 换成舒缓的 BGM / 删掉中间重复的片段"
              rows={3}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIterateTask(null);
                  setEditInstruction("");
                }}
              >
                取消
              </Button>
              <Button
                className="bg-brand-gradient text-white border-0"
                disabled={!editInstruction.trim() || iterateMutation.isPending}
                onClick={() => {
                  if (!iterateTask || !editInstruction.trim()) return;
                  iterateMutation.mutate({ taskId: iterateTask.id, editInstruction: editInstruction.trim() });
                }}
              >
                {iterateMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />提交中</>
                ) : (
                  <><Wand2 className="h-4 w-4 mr-1.5" />生成修改版</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OutputCard({
  task,
  cfg,
  output,
  onPlay,
  onViewSubtitle,
  onIterate,
}: {
  task: any;
  cfg: { label: string; icon: React.ReactNode; gradient: string; chip: string };
  output: ReturnType<typeof getOutputInfoSig> | null;
  onPlay: (src: string, title: string, isAudio: boolean) => void;
  onViewSubtitle: () => void;
  onIterate: () => void;
}) {
  const fileName = output?.outputPath.split(/[/\\]/).pop() || "";
  // 仅 AI 创作且带剪辑时间轴(clips)的成品支持迭代修改
  const canIterate =
    task.taskType === "ai_video_creator" &&
    Array.isArray((task.result as any)?.clips) &&
    (task.result as any).clips.length > 0;

  return (
    <div className="group rounded-2xl bg-card border border-border overflow-hidden hover-lift">
      {/* 缩略图区:渐变 + 大图标,代表成品类型 */}
      <div
        className={`relative h-32 ${cfg.gradient} overflow-hidden`}
      >
        <div className="relative h-full flex items-center justify-center">
          <div className="h-14 w-14 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center">
            {output?.isAudio ? (
              <FileAudio className="h-7 w-7 text-white" />
            ) : (
              <FileVideo className="h-7 w-7 text-white" />
            )}
          </div>
        </div>
        {/* 评分徽标 */}
        {output?.review?.score !== undefined && (
          <div className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/25 backdrop-blur-md text-white text-xs font-bold">
            <Star className="h-3 w-3 fill-current" />
            {output.review.score}/10
          </div>
        )}
        {/* 类型徽标 */}
        <div className="absolute top-3 left-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/25 backdrop-blur-md text-white text-xs font-medium">
          {cfg.icon}
          {cfg.label}
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-4 space-y-3">
        <div>
          <div className="font-semibold text-sm truncate">
            {output?.title || fileName || `任务 #${task.id}`}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2 min-h-[2rem]">
            {output?.explanation || "处理完成"}
          </div>
        </div>

        {/* 降级提示 */}
        {output?.degradations && output.degradations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {output.degradations.map((d) => (
              <span
                key={d}
                className="inline-flex items-center px-2 py-0.5 rounded-md bg-brand-orange/10 text-brand-orange text-[10px] font-medium border border-brand-orange/20"
                title="该环节失败已自动降级"
              >
                降级 · {degradationLabel(d)}
              </span>
            ))}
          </div>
        )}

        {/* 文件信息 */}
        {output && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate">{fileName}</span>
            {output.fileSize > 0 && (
              <span className="shrink-0 ml-2">{formatSize(output.fileSize)}</span>
            )}
          </div>
        )}

        {/* 操作 */}
        {output ? (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1 bg-brand-gradient text-white border-0 hover:opacity-90"
              onClick={() =>
                onPlay(
                  `/api/files/stream?path=${encodeURIComponent(output.outputPath)}`,
                  `${cfg.label} #${task.id}`,
                  output.isAudio
                )
              }
            >
              <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />
              预览
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg"
              onClick={() => {
                const a = document.createElement("a");
                a.href = `/api/files/stream?path=${encodeURIComponent(output.outputPath)}`;
                a.download = fileName || "output";
                a.click();
              }}
              aria-label="下载"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            {task.taskType === "subtitle" && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-lg"
                onClick={onViewSubtitle}
                aria-label="查看字幕"
              >
                <FileText className="h-3.5 w-3.5" />
              </Button>
            )}
            {canIterate && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-lg text-brand-violet border-brand-violet/30 hover:bg-brand-violet/5"
                onClick={onIterate}
                aria-label="修改这版"
                title="基于这版做修改"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ) : task.taskType === "subtitle" ? (
          <Button size="sm" variant="outline" className="w-full" onClick={onViewSubtitle}>
            <Eye className="h-3.5 w-3.5 mr-1.5" />
            查看字幕
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">暂无输出文件</p>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border/60">
          <span className="text-[11px] text-muted-foreground">
            {formatTime(task.completedAt || task.createdAt)}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">#{task.id}</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ typeFilter }: { typeFilter: string }) {
  return (
    <div className="relative rounded-3xl bg-card border border-border py-20 text-center overflow-hidden">
      <div className="ambient-blob ambient-blob-violet h-60 w-60 -left-10 -top-10 opacity-25" />
      <div className="ambient-blob ambient-blob-pink h-60 w-60 -right-10 -bottom-10 opacity-25" />
      <div className="relative">
        <div className="inline-flex h-16 w-16 rounded-2xl bg-brand-gradient items-center justify-center mb-4 shadow-brand-md">
          <Sparkles className="h-8 w-8 text-white" />
        </div>
        <p className="font-semibold mb-1">
          {typeFilter === "all" ? "还没有成品" : "当前筛选下无结果"}
        </p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {typeFilter === "all"
            ? "上传素材并完成 AI 创作后,成片会出现在这里。"
            : "试试切换其他类型,或回到全部查看所有成片。"}
        </p>
      </div>
    </div>
  );
}

// 降级标签的人话化映射
function degradationLabel(d: string): string {
  switch (d) {
    case "audio:tts-failed":
      return "TTS 失败";
    case "audio:tts-only":
      return "仅 TTS";
    case "audio:bgm-only":
      return "仅 BGM";
    case "audio:passthrough":
      return "原声";
    case "subtitle:script-timeline":
      return "字幕(脚本时轴)";
    default:
      return d;
  }
}

// 仅用于类型推断
function getOutputInfoSig(): {
  outputPath: string;
  fileSize: number;
  isAudio: boolean;
  title?: string;
  explanation: string;
  review?: { score: number; suggestions?: string[] };
  degradations?: string[];
} {
  throw new Error("type-only");
}
