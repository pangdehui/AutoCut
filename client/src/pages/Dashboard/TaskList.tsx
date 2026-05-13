import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Clock, CheckCircle2, AlertCircle, Trash2, RotateCcw, BarChart3, FileText, Download } from "lucide-react";
import AnalysisViewer from "./AnalysisViewer";
import SubtitleViewer from "./SubtitleViewer";

const TASK_TYPE_LABELS: Record<string, string> = {
  analysis: "AI 分析",
  editing: "视频剪辑",
  ai_edit: "AI 剪辑",
  tts: "AI 配音",
  subtitle: "字幕生成",
  ai_video_creator: "AI 创作",
  combined: "综合处理",
};

const TYPE_FILTERS = [
  { value: "all",              label: "全部" },
  { value: "analysis",         label: "AI 分析" },
  { value: "ai_video_creator", label: "AI 创作" },
  { value: "ai_edit",          label: "AI 剪辑" },
  { value: "editing",          label: "视频剪辑" },
  { value: "tts",              label: "AI 配音" },
  { value: "subtitle",         label: "字幕生成" },
];

const OPERATION_LABELS: Record<string, string> = {
  trim: "裁剪",
  slice: "切片合并",
  resize: "调整分辨率",
  watermark: "添加水印",
  speed: "变速",
};

const STATUS_FILTERS = [
  { value: "all", label: "全部" },
  { value: "queued", label: "排队中" },
  { value: "processing", label: "处理中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
];

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function ResultSummary({ task }: { task: any }) {
  const result = task.result as Record<string, any> | null;
  if (!result) return null;

  const outputPath = result.outputPath || result.audioPath || result.burntVideo;
  const fileName = outputPath ? String(outputPath).split(/[/\\]/).pop() : null;
  const fileSize = formatSize(result.fileSize || 0);
  const summary =
    result.title ||
    result.explanation ||
    result.message ||
    (result.subtitles ? `已生成 ${Object.keys(result.subtitles).join("、")} 字幕` : null);

  return (
    <div className="bg-muted/40 rounded p-3 text-xs space-y-1.5">
      {summary && <p className="text-foreground">{summary}</p>}
      {fileName && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate flex-1">{fileName}</span>
          {fileSize && <span className="shrink-0">{fileSize}</span>}
        </div>
      )}
      {outputPath && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => {
            const a = document.createElement("a");
            a.href = `/api/files/stream?path=${encodeURIComponent(outputPath)}`;
            a.download = fileName || "output";
            a.click();
          }}
        >
          <Download className="h-3 w-3 mr-1" />
          下载
        </Button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: React.ReactNode; className: string; label: string }> = {
    queued: {
      icon: <Clock className="h-3 w-3" />,
      className: "bg-yellow-100 text-yellow-700 border-yellow-200",
      label: "排队中",
    },
    processing: {
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      className: "bg-blue-100 text-blue-700 border-blue-200",
      label: "处理中",
    },
    completed: {
      icon: <CheckCircle2 className="h-3 w-3" />,
      className: "bg-green-100 text-green-700 border-green-200",
      label: "已完成",
    },
    failed: {
      icon: <AlertCircle className="h-3 w-3" />,
      className: "bg-red-100 text-red-700 border-red-200",
      label: "失败",
    },
  };

  const c = config[status] || config.queued;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${c.className}`}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
      <div
        className="h-full bg-accent rounded-full transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export default function TaskList() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const utils = trpc.useUtils();

  const tasksQuery = trpc.tasks.list.useQuery(
    { status: statusFilter },
    { refetchInterval: 3000 }
  );

  const [expandedAnalysis, setExpandedAnalysis] = useState<number | null>(null);
  const [expandedSubtitle, setExpandedSubtitle] = useState<number | null>(null);

  const deleteMutation = trpc.tasks.remove.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate();
    },
  });

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id });
  };

  const allTasks = tasksQuery.data?.data || [];
  const tasks = typeFilter === "all"
    ? allTasks
    : allTasks.filter((t: any) => t.taskType === typeFilter);

  // 追踪任务状态变化，完成/失败时发送通知
  const prevStatusRef = useRef<Record<number, string>>({});
  useEffect(() => {
    for (const task of tasks) {
      const prev = prevStatusRef.current[task.id];
      if (prev && prev !== task.status) {
        if (task.status === "completed") {
          toast.success(`${TASK_TYPE_LABELS[task.taskType] || task.taskType} 已完成`);
        } else if (task.status === "failed") {
          toast.error(`${TASK_TYPE_LABELS[task.taskType] || task.taskType} 处理失败`);
        }
      }
      prevStatusRef.current[task.id] = task.status;
    }
  }, [tasks]);

  return (
    <div className="space-y-6">
      {/* 任务列表 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>处理任务</CardTitle>
              <CardDescription>查看您的所有视频处理任务</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => utils.tasks.list.invalidate()}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* 类型筛选 */}
          <div className="flex gap-2 mb-3 flex-wrap">
            {TYPE_FILTERS.map((f) => (
              <Button
                key={f.value}
                variant={typeFilter === f.value ? "default" : "outline"}
                size="sm"
                onClick={() => setTypeFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          {/* 状态筛选 */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.value}
                variant={statusFilter === f.value ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          {tasksQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">
                {statusFilter === "all" ? "暂无任务，上传视频后可以创建处理任务" : "没有符合筛选的任务"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="border rounded-lg p-4 space-y-3 hover:border-accent/30 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium text-sm">
                          {TASK_TYPE_LABELS[task.taskType] || task.taskType}
                          {(task.parameters as any)?.operation && (
                            <span className="text-xs text-muted-foreground ml-2">
                              ({OPERATION_LABELS[(task.parameters as any).operation] || (task.parameters as any).operation})
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          任务 #{task.id} · 视频 #{task.videoId}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={task.status} />
                      {(task.taskType === "analysis" || task.taskType === "combined") &&
                        task.status === "completed" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              setExpandedAnalysis(
                                expandedAnalysis === task.id ? null : task.id
                              )
                            }
                          >
                            <BarChart3 className="h-3 w-3 mr-1" />
                            {expandedAnalysis === task.id ? "收起分析" : "查看分析"}
                          </Button>
                        )}
                      {task.taskType === "subtitle" &&
                        task.status === "completed" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              setExpandedSubtitle(
                                expandedSubtitle === task.id ? null : task.id
                              )
                            }
                          >
                            <FileText className="h-3 w-3 mr-1" />
                            {expandedSubtitle === task.id ? "收起字幕" : "查看字幕"}
                          </Button>
                        )}
                      {(task.status === "completed" || task.status === "failed") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-red-500"
                          onClick={() => handleDelete(task.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {(task.status === "processing" || task.status === "queued") && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>进度</span>
                        <span>{task.progress}%</span>
                      </div>
                      <ProgressBar progress={task.progress ?? 0} />
                    </div>
                  )}

                  {task.status === "completed" && task.result != null
                    ? <ResultSummary task={task} />
                    : null}

                  {task.status === "failed" && task.errorMessage && (
                    <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">
                      {task.errorMessage}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>创建：{new Date(task.createdAt).toLocaleString()}</span>
                    {task.startedAt && (
                      <span>开始：{new Date(task.startedAt).toLocaleString()}</span>
                    )}
                    {task.completedAt && (
                      <span>完成：{new Date(task.completedAt).toLocaleString()}</span>
                    )}
                  </div>

                  {expandedAnalysis === task.id && (
                    <div className="mt-4 pt-4 border-t">
                      <AnalysisViewer taskId={task.id} />
                    </div>
                  )}

                  {expandedSubtitle === task.id && (
                    <div className="mt-4 pt-4 border-t">
                      <SubtitleViewer taskId={task.id} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
