import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, CheckCircle, Zap, TrendingDown } from "lucide-react";

export default function Statistics() {
  const overviewQuery = trpc.admin.overviewStats.useQuery();
  const dailyUsersQuery = trpc.admin.dailyUserRegistrations.useQuery();
  const dailyCreditQuery = trpc.admin.dailyCreditConsumption.useQuery();
  const dailyTasksQuery = trpc.admin.dailyTaskCounts.useQuery();
  const avgDurationQuery = trpc.admin.avgProcessingDuration.useQuery();

  const overview = overviewQuery.data?.data;

  const taskTypeLabel: Record<string, string> = {
    analysis: "AI 分析",
    editing: "视频剪辑",
    subtitle: "字幕生成",
    combined: "综合处理",
  };

  return (
    <div className="space-y-8">
      {/* 总览卡片 */}
      <div>
        <h2 className="text-lg font-semibold mb-4">总览</h2>
        {overviewQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : overview ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  总用户
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{overview.totalUsers}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                  <Users className="h-4 w-4 text-green-500" />
                  活跃用户
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600">{overview.activeUsers}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" />
                  总任务数
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{overview.totalTasks}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  已完成
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600">{overview.completedTasks}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  积分消耗
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-red-600">{overview.totalConsumed}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                  <Zap className="h-4 w-4 text-accent" />
                  积分充值
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-accent">{overview.totalRecharged}</p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <p className="text-muted-foreground">暂无数据</p>
        )}
      </div>

      {/* 各任务类型平均处理时长 */}
      <div>
        <h2 className="text-lg font-semibold mb-4">各任务类型平均处理时长</h2>
        {avgDurationQuery.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : avgDurationQuery.data?.data && avgDurationQuery.data.data.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {avgDurationQuery.data.data.map(row => (
              <Card key={row.taskType}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    {taskTypeLabel[row.taskType] ?? row.taskType}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{row.avgSeconds}s</p>
                  <p className="text-xs text-muted-foreground mt-1">共 {row.taskCount} 次</p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">暂无已完成任务的处理时长数据</p>
        )}
      </div>

      {/* 近 30 天每日新增用户 */}
      <div>
        <h2 className="text-lg font-semibold mb-4">近 30 天每日新增用户</h2>
        {dailyUsersQuery.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : dailyUsersQuery.data?.data && dailyUsersQuery.data.data.length > 0 ? (
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-2 font-medium">日期</th>
                  <th className="text-right px-4 py-2 font-medium">新增用户</th>
                </tr>
              </thead>
              <tbody>
                {dailyUsersQuery.data.data.map(row => (
                  <tr key={row.date} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2">{row.date}</td>
                    <td className="px-4 py-2 text-right font-mono">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">近 30 天暂无注册数据</p>
        )}
      </div>

      {/* 近 30 天积分消耗趋势 */}
      <div>
        <h2 className="text-lg font-semibold mb-4">近 30 天积分消耗趋势</h2>
        {dailyCreditQuery.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : dailyCreditQuery.data?.data && dailyCreditQuery.data.data.length > 0 ? (
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-2 font-medium">日期</th>
                  <th className="text-right px-4 py-2 font-medium text-red-600">消耗</th>
                  <th className="text-right px-4 py-2 font-medium text-green-600">充值</th>
                </tr>
              </thead>
              <tbody>
                {dailyCreditQuery.data.data.map(row => (
                  <tr key={row.date} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2">{row.date}</td>
                    <td className="px-4 py-2 text-right font-mono text-red-600">{row.consumed}</td>
                    <td className="px-4 py-2 text-right font-mono text-green-600">{row.recharged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">近 30 天暂无积分流水数据</p>
        )}
      </div>

      {/* 近 30 天每日任务数 */}
      <div>
        <h2 className="text-lg font-semibold mb-4">近 30 天每日任务数（按类型）</h2>
        {dailyTasksQuery.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : dailyTasksQuery.data?.data && dailyTasksQuery.data.data.length > 0 ? (
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-2 font-medium">日期</th>
                  <th className="text-left px-4 py-2 font-medium">任务类型</th>
                  <th className="text-right px-4 py-2 font-medium">数量</th>
                </tr>
              </thead>
              <tbody>
                {dailyTasksQuery.data.data.map((row, i) => (
                  <tr key={`${row.date}-${row.taskType}-${i}`} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2">{row.date}</td>
                    <td className="px-4 py-2">{taskTypeLabel[row.taskType ?? ""] ?? row.taskType}</td>
                    <td className="px-4 py-2 text-right font-mono">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">近 30 天暂无任务数据</p>
        )}
      </div>
    </div>
  );
}
