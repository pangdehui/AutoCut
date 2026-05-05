import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, CheckCircle2, XCircle, Clock, Zap } from "lucide-react";

const statusLabel: Record<string, string> = {
  queued: "排队中",
  processing: "处理中",
  completed: "已完成",
  failed: "失败",
};

const taskTypeLabel: Record<string, string> = {
  analysis: "AI分析",
  editing: "视频剪辑",
  subtitle: "字幕生成",
  combined: "综合处理",
};

const statusVariant: Record<string, "outline" | "secondary" | "default" | "destructive"> = {
  queued: "secondary",
  processing: "default",
  completed: "outline",
  failed: "destructive",
};

export default function TaskMonitor() {
  const statsQuery = trpc.admin.taskStats.useQuery(undefined, { refetchInterval: 5000 });
  const tasksQuery = trpc.admin.listAllTasks.useQuery(undefined, { refetchInterval: 5000 });

  const stats = statsQuery.data?.data;
  const tasks = tasksQuery.data?.data ?? [];

  const statCards = [
    { label: "总任务", value: stats?.total ?? 0, icon: Zap, color: "text-accent" },
    { label: "排队中", value: stats?.queued ?? 0, icon: Clock, color: "text-yellow-500" },
    { label: "处理中", value: stats?.processing ?? 0, icon: Loader2, color: "text-blue-500" },
    { label: "已完成", value: stats?.completed ?? 0, icon: CheckCircle2, color: "text-green-500" },
    { label: "失败", value: stats?.failed ?? 0, icon: XCircle, color: "text-red-500" },
  ];

  const handleRefresh = () => {
    statsQuery.refetch();
    tasksQuery.refetch();
  };

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="border-border/60">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`h-4 w-4 ${color}`} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              {statsQuery.isLoading ? (
                <div className="h-7 w-12 bg-muted animate-pulse rounded" />
              ) : (
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 任务列表 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">所有任务（最近 200 条）</h3>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
        </div>

        {tasksQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">ID</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">用户</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">类型</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">状态</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">进度</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">积分消耗</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">入队时间</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">完成时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tasks.map(task => (
                  <tr key={task.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">#{task.id}</td>
                    <td className="px-4 py-2.5">
                      <div className="text-xs font-medium">{task.userName || "—"}</div>
                      <div className="text-xs text-muted-foreground">{task.userEmail}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="secondary" className="text-xs">
                        {taskTypeLabel[task.taskType] ?? task.taskType}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={statusVariant[task.status]} className="text-xs">
                        {statusLabel[task.status] ?? task.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full transition-all"
                            style={{ width: `${task.progress ?? 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">
                          {task.progress ?? 0}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {task.creditsUsed ?? 0}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(task.queuedAt).toLocaleString("zh-CN")}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {task.completedAt ? new Date(task.completedAt).toLocaleString("zh-CN") : "—"}
                    </td>
                  </tr>
                ))}
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      暂无任务数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 错误信息展开区 */}
        {tasks.some(t => t.errorMessage) && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-red-500">失败任务错误信息</h4>
            {tasks
              .filter(t => t.errorMessage)
              .map(t => (
                <div key={t.id} className="text-xs bg-red-50 border border-red-200 rounded-md p-3">
                  <span className="font-mono text-red-400 mr-2">#{t.id}</span>
                  <span className="text-red-700">{t.errorMessage}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
