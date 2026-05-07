import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, X, FileVideo, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

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

export default function VideoUpload() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

    const formData = new FormData();
    pending.forEach((item) => {
      formData.append("files", item.file);
    });

    try {
      const resp = await fetch("/api/videos/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const result = await resp.json();

      if (result.success && result.data) {
        // 上传成功后，为每个成功的视频创建分析任务
        const successfulUploads = result.data.filter((r: any) => r.success && r.videoId);

        for (const upload of successfulUploads) {
          try {
            const result = await (trpc.tasks.create as any)({
              videoId: upload.videoId,
              taskType: 'analysis',
            });
            if (!result.success) {
              console.error('创建分析任务失败:', result.message);
            }
          } catch (error: any) {
            console.error('创建分析任务失败:', error);
          }
        }

        setFiles((prev) =>
          prev.map((item) => {
            if (item.status !== "pending") return item;
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
            item.status === "pending"
              ? { ...item, status: "error" as const, error: result.message || "上传失败" }
              : item
          )
        );
      }
    } catch (error) {
      setFiles((prev) =>
        prev.map((item) =>
          item.status === "pending"
            ? { ...item, status: "error" as const, error: "网络错误" }
            : item
        )
      );
    } finally {
      setUploading(false);
    }
  };

  const hasPending = files.some((f) => f.status === "pending");
  const uploadCount = files.filter((f) => f.status === "success").length;

  return (
    <div className="space-y-6">
      {/* 上传区域 */}
      <Card>
        <CardHeader>
          <CardTitle>上传视频</CardTitle>
          <CardDescription>
            支持 {ALLOWED_TYPES.join(", ")} 格式，单个文件最大 {formatSize(MAX_FILE_SIZE)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              isDragging
                ? "border-accent bg-accent/5"
                : "border-border hover:border-accent/50"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium mb-1">
              {isDragging ? "松开即可添加文件" : "点击选择或拖拽文件到此处"}
            </p>
            <p className="text-sm text-muted-foreground">
              支持批量上传，单次最多 10 个文件
            </p>
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

          {hasPending && (
            <div className="mt-4 flex justify-end">
              <Button onClick={handleUpload} disabled={uploading}>
                {uploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    上传中...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    开始上传 ({files.filter((f) => f.status === "pending").length} 个文件)
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 文件列表 */}
      {files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              文件列表
              {uploadCount > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  已上传 {uploadCount} 个
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {files.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    item.status === "error"
                      ? "border-red-200 bg-red-50"
                      : item.status === "success"
                        ? "border-green-200 bg-green-50"
                        : "border-border"
                  }`}
                >
                  <FileVideo className="h-5 w-5 text-muted-foreground shrink-0" />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatSize(item.file.size)}
                    </p>
                    {item.error && (
                      <p className="text-xs text-red-600 mt-1">{item.error}</p>
                    )}
                  </div>

                  <div className="shrink-0">
                    {item.status === "pending" && (
                      <span className="text-xs text-muted-foreground">等待上传</span>
                    )}
                    {item.status === "uploading" && (
                      <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    )}
                    {item.status === "success" && (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                    {item.status === "error" && (
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    )}
                  </div>

                  {item.status !== "uploading" && (
                    <button
                      onClick={() => removeFile(item.id)}
                      className="shrink-0 p-1 rounded hover:bg-muted"
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
