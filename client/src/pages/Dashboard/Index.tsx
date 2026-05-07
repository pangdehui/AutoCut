import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import VideoUpload from "./VideoUpload";
import TaskList from "./TaskList";
import EditingPanel from "./EditingPanel";
import SubtitlePanel from "./SubtitlePanel";
import VideoList from "./VideoList";
import { Loader2, Upload, Zap, Settings, Scissors, Subtitles, ListVideo } from "lucide-react";

export default function Dashboard() {
  const { user, loading } = useAuth();
  const creditsQuery = trpc.credits.getBalance.useQuery(undefined, { enabled: !!user });

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
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <nav className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <a href="/" className="text-xl font-bold">
              AutoCut
            </a>
            <div className="hidden md:flex items-center gap-6">
              <a href="/dashboard" className="text-sm font-medium text-accent">
                仪表板
              </a>
              <a href="/tasks" className="text-sm text-muted-foreground hover:text-foreground">
                任务列表
              </a>
              {user.role === "admin" && (
                <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
                  管理后台
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a href="/profile" className="text-sm text-muted-foreground hover:text-foreground">
              {user.name || user.email}
            </a>
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        {/* 欢迎部分 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">欢迎，{user.name || "用户"}</h1>
          <p className="text-muted-foreground">开始处理您的视频内容</p>
        </div>

        {/* 积分卡片 */}
        <Card className="mb-8 bg-gradient-to-br from-accent/5 to-accent/10 border-accent/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-accent" />
              您的积分
            </CardTitle>
          </CardHeader>
          <CardContent>
            {creditsQuery.isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : creditsQuery.data?.success && creditsQuery.data?.data ? (
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-accent">
                  {creditsQuery.data.data.balance}
                </span>
                <span className="text-muted-foreground">积分可用</span>
              </div>
            ) : (
              <p className="text-muted-foreground">无法加载积分</p>
            )}
          </CardContent>
        </Card>

        {/* 功能标签页 */}
        <Tabs defaultValue="upload" className="space-y-6">
          <TabsList>
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              上传视频
            </TabsTrigger>
            <TabsTrigger value="videos" className="flex items-center gap-2">
              <ListVideo className="h-4 w-4" />
              我的视频
            </TabsTrigger>
            <TabsTrigger value="edit" className="flex items-center gap-2">
              <Scissors className="h-4 w-4" />
              视频剪辑
            </TabsTrigger>
            <TabsTrigger value="subtitle" className="flex items-center gap-2">
              <Subtitles className="h-4 w-4" />
              字幕生成
            </TabsTrigger>
            <TabsTrigger value="tasks" className="flex items-center gap-2">
              任务列表
            </TabsTrigger>
            {user.role === "admin" && (
              <TabsTrigger value="admin" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                管理
              </TabsTrigger>
            )}
          </TabsList>

          {/* 上传标签页 */}
          <TabsContent value="upload">
            <VideoUpload />
          </TabsContent>

          {/* 视频列表标签页 */}
          <TabsContent value="videos">
            <VideoList />
          </TabsContent>

          {/* 视频剪辑标签页 */}
          <TabsContent value="edit">
            <EditingPanel />
          </TabsContent>

          {/* 字幕生成标签页 */}
          <TabsContent value="subtitle">
            <SubtitlePanel />
          </TabsContent>

          {/* 任务列表标签页 */}
          <TabsContent value="tasks">
            <TaskList />
          </TabsContent>

          {/* 管理标签页 */}
          {user.role === "admin" && (
            <TabsContent value="admin">
              <Card>
                <CardHeader>
                  <CardTitle>管理后台</CardTitle>
                  <CardDescription>管理用户和系统设置</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <Button variant="outline" className="w-full justify-start">
                      用户管理
                    </Button>
                    <Button variant="outline" className="w-full justify-start">
                      积分管理
                    </Button>
                    <Button variant="outline" className="w-full justify-start">
                      任务监控
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}
