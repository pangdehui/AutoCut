import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Film, Zap, Subtitles, BarChart3, ArrowRight } from "lucide-react";

export default function Home() {
  const { user, isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-accent/5">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film className="h-6 w-6 text-accent" />
            <span className="text-xl font-bold">AutoCut</span>
          </div>
          <div className="flex items-center gap-4">
            {isAuthenticated ? (
              <>
                <a href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
                  仪表板
                </a>
                <a href="/profile" className="text-sm text-muted-foreground hover:text-foreground">
                  个人中心
                </a>
                <Button size="sm" variant="outline">
                  {user?.name || "用户"}
                </Button>
              </>
            ) : (
              <>
                <a href="/login" className="text-sm text-muted-foreground hover:text-foreground">
                  登录
                </a>
                <Button size="sm" asChild>
                  <a href="/register">注册</a>
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero 部分 */}
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-20 md:py-32">
        <div className="text-center space-y-6 mb-16">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            AI 驱动的视频处理平台
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            使用先进的 AI 技术分析、剪辑和优化您的视频内容。
            支持多语言字幕、自动场景识别和智能剪辑。
          </p>
          <div className="flex gap-4 justify-center pt-4">
            {isAuthenticated ? (
              <Button size="lg" asChild>
                <a href="/dashboard">
                  开始使用 <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            ) : (
              <>
                <Button size="lg" asChild>
                  <a href="/register">
                    免费开始 <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a href="/login">登录</a>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* 功能卡片 */}
        <div className="grid md:grid-cols-3 gap-6 mt-20">
          <Card className="border-border/50 hover:shadow-lg transition-shadow">
            <CardHeader>
              <BarChart3 className="h-8 w-8 text-accent mb-2" />
              <CardTitle>AI 内容分析</CardTitle>
              <CardDescription>
                自动识别场景、提取关键词、发现精彩片段
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                利用先进的多模态 AI 模型深度分析视频内容，
                为您的剪辑工作提供智能建议。
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50 hover:shadow-lg transition-shadow">
            <CardHeader>
              <Film className="h-8 w-8 text-accent mb-2" />
              <CardTitle>专业剪辑工具</CardTitle>
              <CardDescription>
                基于 FFmpeg 的强大视频处理能力
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                支持自动切片、合并、缩放、水印添加等功能，
                轻松完成专业级视频编辑。
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50 hover:shadow-lg transition-shadow">
            <CardHeader>
              <Subtitles className="h-8 w-8 text-accent mb-2" />
              <CardTitle>多语言字幕</CardTitle>
              <CardDescription>
                自动生成和翻译字幕
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                支持语音识别和多语言翻译，
                自动生成带时间戳的字幕并压制进视频。
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 积分系统 */}
        <div className="mt-20 bg-accent/5 border border-accent/20 rounded-lg p-8 text-center">
          <Zap className="h-8 w-8 text-accent mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-4">灵活的积分系统</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-6">
            按需付费，无隐藏费用。每项功能都有独立的积分费率，
            新用户注册即获得 1000 积分赠送。
          </p>
          <div className="grid md:grid-cols-3 gap-4 max-w-2xl mx-auto">
            <div className="bg-background/50 rounded p-4">
              <p className="font-semibold">分析</p>
              <p className="text-sm text-muted-foreground">10 积分/分钟</p>
            </div>
            <div className="bg-background/50 rounded p-4">
              <p className="font-semibold">剪辑</p>
              <p className="text-sm text-muted-foreground">15 积分/分钟</p>
            </div>
            <div className="bg-background/50 rounded p-4">
              <p className="font-semibold">字幕</p>
              <p className="text-sm text-muted-foreground">8 积分/分钟</p>
            </div>
          </div>
        </div>
      </section>

      {/* 页脚 */}
      <footer className="border-t border-border/50 bg-background/50 mt-20">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 text-center text-sm text-muted-foreground">
          <p>&copy; 2026 AutoCut. 保留所有权利。</p>
        </div>
      </footer>
    </div>
  );
}
