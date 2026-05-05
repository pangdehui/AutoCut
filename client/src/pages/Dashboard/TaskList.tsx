import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Loader2, Clock, CheckCircle2, AlertCircle, Play, Trash2, RotateCcw } from "lucide-react";

const TASK_TYPE_LABELS: Record<string, string> = {
  analysis: "AI 分析",
  editing: "视频剪辑",
  subtitle: "字幕生成",
  combined: "综合处理",
};

const STATUS_FILTERS = [
  { value: "all", label: "全部" },
  { value: "queued", label: "排队中" },
  { value: "processing", label: "处理中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
];

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
  const utils = trpc.useUtils();

  const tasksQuery = trpc.tasks.list.useQuery(
    { status: statusFilter },
    { refetchInterval: 3000 }
  );

  const deleteMutation = trpc.tasks.remove.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate();
    },
  });

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id });
  };

  const tasks = tasksQuery.data?.data || [];

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
          {/* 筛选器 */}
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
                        </p>
                        <p className="text-xs text-muted-foreground">
                          任务 #{task.id} · 视频 #{task.videoId}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={task.status} />
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
                    ? (
                      <div className="bg-muted/50 rounded p-2 text-xs text-muted-foreground">
                        <pre className="whitespace-pre-wrap font-sans">
                          {JSON.stringify(task.result as object, null, 2)}
                        </pre>
                      </div>
                    )
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
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
