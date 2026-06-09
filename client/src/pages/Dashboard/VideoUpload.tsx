import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, FileVideo, CheckCircle2, AlertCircle, Loader2, Sparkles, Cloud } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const ALLOWED_TYPES = [".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".flv"];
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

type FileItem = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
  videoId?: number;
};

export default function VideoUpload({ projectId }: { projectId?: number }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const createTask = trpc.tasks.create.useMutation();

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const items: FileItem[] = Array.from(newFiles).map((file) => {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      const errors: string[] = [];

      if (!ALLOWED_TYPES.includes(ext)) {
        errors.push(`不支持的格式 "${ext}"`);
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`文件过大（最大 2GB）`);
      }

      return {
        id: Math.random().toString(36).slice(2),
        file,
        status: errors.length > 0 ? ("error" as const) : ("pending" as const),
        error: errors.length > 0 ? errors.join("，") : undefined,
      };
    });

    setFiles((prev) => [...prev, ...items]);
  }, []);

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleUpload = async () => {
    const pending = files.filter((f) => f.status === "pending");
    if (pending.length === 0) return;

    setUploading(true);
    setFiles((prev) =>
      prev.map((f) => (f.status === "pending" ? { ...f, status: "uploading" as const } : f))
    );

    const formData = new FormData();
    pending.forEach((item) => {
      formData.append("files", item.file);
    });
    if (projectId != null) {
      formData.append("projectId", String(projectId));
    }

    try {
      const resp = await fetch("/api/videos/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const result = await resp.json();

      if (result.success && result.data) {
        const successfulUploads = result.data.filter((r: any) => r.success && r.videoId);

        if (successfulUploads.length > 0) {
          toast.info(`正在为 ${successfulUploads.length} 个视频创建分析任务...`);
        }

        for (const upload of successfulUploads) {
          try {
            const taskResult = await createTask.mutateAsync({
              videoId: upload.videoId,
              taskType: "analysis",
            });
            if (taskResult.success) {
              toast.success(`"${upload.fileName}" 分析任务已创建`);
            } else {
              toast.error(`"${upload.fileName}": ${taskResult.message}`);
            }
          } catch (error: any) {
            toast.error(`"${upload.fileName}": ${error?.message || "创建分析任务失败"}`);
          }
        }

        // 刷新视频列表与任务列表，让新上传的素材与分析任务立即出现
        utils.videos.list.invalidate();
        utils.videos.listWithStatus.invalidate();
        utils.tasks.list.invalidate();

        setFiles((prev) =>
          prev.map((item) => {
            if (item.status !== "uploading") return item;
            const uploaded = result.data.find(
              (r: { fileName: string }) => r.fileName === item.file.name
            );
            if (uploaded) {
              return {
                ...item,
                status: uploaded.success ? "success" : "error",
                videoId: uploaded.videoId,
                error: uploaded.error,
              };
            }
            return { ...item, status: "error", error: "上传失败" };
          })
        );
      } else {
        setFiles((prev) =>
          prev.map((item) =>
            item.status === "uploading"
              ? { ...item, status: "error" as const, error: result.message || "上传失败" }
              : item
          )
        );
      }
    } catch (error) {
      setFiles((prev) =>
        prev.map((item) =>
          item.status === "uploading"
            ? { ...item, status: "error" as const, error: "网络错误" }
            : item
        )
      );
    } finally {
      setUploading(false);
    }
  };

  const hasPending = files.some((f) => f.status === "pending");
  const pendingCount = files.filter((f) => f.status === "pending").length;
  const successCount = files.filter((f) => f.status === "success").length;
  const errorCount = files.filter((f) => f.status === "error").length;

  return (
    <div className="space-y-5">
      {/* 头部说明 */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <span className="inline-flex h-8 w-8 rounded-lg bg-brand-gradient-warm items-center justify-center shadow-brand-sm">
              <Cloud className="h-4 w-4 text-white" />
            </span>
            上传素材
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            支持 {ALLOWED_TYPES.join(" / ")} 格式 · 单文件最大 2GB · 上传后自动创建分析任务
          </p>
        </div>
        {(successCount > 0 || errorCount > 0 || pendingCount > 0) && (
          <div className="flex gap-2 flex-wrap">
            {pendingCount > 0 && <StatChip color="violet" label={`${pendingCount} 个待上传`} />}
            {successCount > 0 && <StatChip color="cyan" label={`${successCount} 个已上传`} />}
            {errorCount > 0 && <StatChip color="pink" label={`${errorCount} 个失败`} />}
          </div>
        )}
      </div>

      {/* 拖拽上传区 */}
      <div
        className={`relative rounded-3xl overflow-hidden transition-all duration-300 ${
          isDragging
            ? "ring-4 ring-offset-2 ring-offset-background"
            : ""
        }`}
        style={isDragging ? { boxShadow: "0 0 0 2px var(--brand-violet)" } : undefined}
      >
        {/* 渐变描边 */}
        <div className="gradient-border rounded-3xl p-1 shadow-brand-sm">
          <div
            className={`relative rounded-[1.4rem] bg-card px-6 py-12 md:py-16 text-center transition-colors cursor-pointer overflow-hidden ${
              isDragging ? "bg-brand-violet/5" : "hover:bg-muted/30"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            {/* 内部氛围光斑 */}
            <div className="ambient-blob ambient-blob-pink h-40 w-40 -left-8 -top-8 opacity-30" />
            <div className="ambient-blob ambient-blob-cyan h-40 w-40 -right-8 -bottom-8 opacity-30" />

            <div className="relative">
              <div
                className={`mx-auto h-20 w-20 rounded-3xl bg-brand-gradient flex items-center justify-center mb-5 shadow-brand-md transition-transform ${
                  isDragging ? "scale-110 animate-glow" : ""
                }`}
              >
                <Upload className="h-9 w-9 text-white" />
              </div>
              <h3 className="text-xl font-bold mb-1.5">
                {isDragging ? "松开即可上传" : "拖拽视频到这里"}
              </h3>
              <p className="text-sm text-muted-foreground mb-5">
                或点击选择文件 · 支持批量上传(单次最多 10 个)
              </p>

              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/60 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-brand-violet" />
                上传完成后 AI 自动分析,识别场景/精彩片段/废片
              </div>

              <input
                ref={inputRef}
                type="file"
                accept={ALLOWED_TYPES.join(",")}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      {hasPending && (
        <div className="flex justify-between items-center gap-3 px-1">
          <div className="text-sm text-muted-foreground">
            {pendingCount} 个文件等待上传
          </div>
          <Button
            onClick={handleUpload}
            disabled={uploading}
            size="lg"
            className="bg-brand-gradient text-white border-0 shadow-brand-sm hover:shadow-brand-md transition-shadow"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                上传中...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                开始上传
              </>
            )}
          </Button>
        </div>
      )}

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="rounded-2xl bg-card border border-border overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div className="font-semibold">文件列表</div>
            <div className="text-xs text-muted-foreground">{files.length} 个文件</div>
          </div>
          <div className="divide-y divide-border">
            {files.map((item) => (
              <FileRow key={item.id} item={item} onRemove={() => removeFile(item.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FileRow({ item, onRemove }: { item: FileItem; onRemove: () => void }) {
  const statusBg =
    item.status === "error"
      ? "bg-brand-pink/5"
      : item.status === "success"
      ? "bg-brand-cyan/5"
      : "";

  const iconBg =
    item.status === "error"
      ? "bg-brand-pink/15 text-brand-pink"
      : item.status === "success"
      ? "bg-brand-cyan/15 text-brand-cyan"
      : item.status === "uploading"
      ? "bg-brand-violet/15 text-brand-violet"
      : "bg-muted text-muted-foreground";

  return (
    <div className={`flex items-center gap-3 p-4 transition-colors ${statusBg}`}>
      <div className={`shrink-0 h-10 w-10 rounded-xl flex items-center justify-center ${iconBg}`}>
        <FileVideo className="h-5 w-5" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.file.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{formatSize(item.file.size)}</p>
        {item.error && <p className="text-xs text-brand-pink mt-1 font-medium">{item.error}</p>}
      </div>

      <div className="shrink-0 flex items-center gap-2">
        {item.status === "pending" && (
          <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-muted">等待</span>
        )}
        {item.status === "uploading" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-brand-violet font-medium">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            上传中
          </span>
        )}
        {item.status === "success" && <CheckCircle2 className="h-5 w-5 text-brand-cyan" />}
        {item.status === "error" && <AlertCircle className="h-5 w-5 text-brand-pink" />}

        {item.status !== "uploading" && (
          <button
            onClick={onRemove}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label="移除文件"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}

function StatChip({
  color,
  label,
}: {
  color: "pink" | "violet" | "cyan" | "orange";
  label: string;
}) {
  const map = {
    pink: "bg-brand-pink/10 text-brand-pink border-brand-pink/20",
    orange: "bg-brand-orange/10 text-brand-orange border-brand-orange/20",
    violet: "bg-brand-violet/10 text-brand-violet border-brand-violet/20",
    cyan: "bg-brand-cyan/15 text-brand-cyan border-brand-cyan/30",
  };
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${map[color]}`}>
      {label}
    </span>
  );
}
