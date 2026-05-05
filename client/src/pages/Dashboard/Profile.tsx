import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Loader2, LogOut, Zap } from "lucide-react";
import { toast } from "sonner";

export default function Profile() {
  const { user, logout, loading } = useAuth();
  const creditsQuery = trpc.credits.getBalance.useQuery();
  const logoutMutation = trpc.auth.logout.useMutation();

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      logout();
      toast.success("已退出登录");
    } catch (error) {
      toast.error("退出登录失败");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">请先登录</p>
          <a href="/login" className="text-accent hover:underline">
            返回登录
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* 用户信息卡片 */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle>账户信息</CardTitle>
            <CardDescription>查看和管理您的账户</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">用户名</p>
                <p className="text-lg font-medium">{user.name || "未设置"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">邮箱</p>
                <p className="text-lg font-medium">{user.email}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">账户类型</p>
                <p className="text-lg font-medium">{user.role === "admin" ? "管理员" : "普通用户"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">注册时间</p>
                <p className="text-lg font-medium">
                  {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 积分信息卡片 */}
        <Card className="border-border/50 shadow-sm bg-gradient-to-br from-accent/5 to-accent/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-accent" />
              积分余额
            </CardTitle>
            <CardDescription>您当前的积分余额和使用情况</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {creditsQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
              </div>
            ) : creditsQuery.data?.success && creditsQuery.data?.data ? (
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-background/50 rounded-lg p-4 text-center">
                  <p className="text-sm text-muted-foreground mb-1">当前余额</p>
                  <p className="text-3xl font-bold text-accent">
                    {creditsQuery.data.data.balance}
                  </p>
                </div>
                <div className="bg-background/50 rounded-lg p-4 text-center">
                  <p className="text-sm text-muted-foreground mb-1">总获得</p>
                  <p className="text-2xl font-semibold">
                    {creditsQuery.data.data.totalEarned}
                  </p>
                </div>
                <div className="bg-background/50 rounded-lg p-4 text-center">
                  <p className="text-sm text-muted-foreground mb-1">已使用</p>
                  <p className="text-2xl font-semibold">
                    {creditsQuery.data.data.totalUsed}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">无法加载积分信息</p>
            )}
          </CardContent>
        </Card>

        {/* 操作按钮 */}
        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={handleLogout}
            className="flex-1"
            disabled={logoutMutation.isPending}
          >
            {logoutMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                退出中...
              </>
            ) : (
              <>
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
