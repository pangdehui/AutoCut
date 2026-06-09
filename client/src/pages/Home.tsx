import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Zap, Wand2, Mic, Subtitles, Music, Play, Bot } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const mm = gsap.matchMedia();

    // 尊重「减少动态效果」偏好：直接显示，不做动画
    mm.add("(prefers-reduced-motion: reduce)", () => {
      gsap.set(root.querySelectorAll(".hero-anim, .reveal"), { opacity: 1, y: 0, clearProps: "all" });
    });

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() => {
        // Hero 进场：依次淡入上浮
        gsap.from(".hero-anim", {
          opacity: 0,
          y: 28,
          duration: 0.7,
          ease: "power3.out",
          stagger: 0.1,
        });

        // Hero 预览卡：稍后浮现 + 轻微缩放
        gsap.from(".hero-preview", {
          opacity: 0,
          y: 48,
          scale: 0.97,
          duration: 0.9,
          ease: "power3.out",
          delay: 0.35,
        });

        // 滚动揭示：进入视口时淡入上浮
        gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) => {
          gsap.from(el, {
            opacity: 0,
            y: 36,
            duration: 0.7,
            ease: "power2.out",
            scrollTrigger: {
              trigger: el,
              start: "top 85%",
              toggleActions: "play none none none",
            },
          });
        });
      }, root);

      return () => ctx.revert();
    });

    return () => mm.revert();
  }, []);

  return (
    <div ref={rootRef} className="min-h-screen relative overflow-x-hidden bg-background">
      {/* ===== 全局氛围光斑 ===== */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="ambient-blob ambient-blob-pink animate-blob h-[420px] w-[420px] -left-32 -top-32" />
        <div
          className="ambient-blob ambient-blob-violet animate-blob h-[380px] w-[380px] right-[-80px] top-[260px]"
          style={{ animationDelay: "-3s" }}
        />
        <div
          className="ambient-blob ambient-blob-cyan animate-blob h-[460px] w-[460px] left-1/3 top-[680px]"
          style={{ animationDelay: "-7s" }}
        />
        <div
          className="ambient-blob ambient-blob-orange animate-blob h-[360px] w-[360px] -right-40 top-[1100px]"
          style={{ animationDelay: "-10s" }}
        />
      </div>

      {/* ===== 导航 ===== */}
      <nav className="sticky top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5 group">
            <div className="relative h-9 w-9 rounded-xl bg-brand-gradient shadow-brand-sm flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">
              Video<span className="text-brand-gradient">Mind</span>
            </span>
          </a>
          <div className="flex items-center gap-1 sm:gap-3">
            {isAuthenticated ? (
              <>
                <a href="/dashboard" className="hidden sm:inline-flex text-sm font-medium px-3 py-2 rounded-lg hover:bg-secondary transition-colors">
                  工作台
                </a>
                <a href="/profile" className="hidden sm:inline-flex text-sm font-medium px-3 py-2 rounded-lg hover:bg-secondary transition-colors">
                  个人中心
                </a>
                <Button asChild className="bg-brand-gradient text-white border-0 shadow-brand-sm hover:shadow-brand-md transition-shadow">
                  <a href="/dashboard">
                    {user?.name || "进入工作台"}
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </a>
                </Button>
              </>
            ) : (
              <>
                <a href="/login" className="text-sm font-medium px-3 py-2 rounded-lg hover:bg-secondary transition-colors">
                  登录
                </a>
                <Button asChild className="bg-brand-gradient text-white border-0 shadow-brand-sm hover:shadow-brand-md transition-shadow">
                  <a href="/register">
                    免费注册
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </a>
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ===== Hero ===== */}
      <section className="relative max-w-7xl mx-auto px-4 md:px-8 pt-16 md:pt-28 pb-20">
        <div className="text-center max-w-4xl mx-auto">
          <div className="hero-anim inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-card text-sm font-medium mb-7">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-brand-violet opacity-70 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-violet" />
            </span>
            AI 自动剪辑 · 上传素材即出成片
          </div>

          <h1 className="hero-anim text-5xl md:text-7xl font-bold tracking-tight leading-[1.05]">
            把素材丢进来,
            <br />
            <span className="text-brand-gradient">
              AI 替你剪成片
            </span>
          </h1>

          <p className="hero-anim mt-7 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            说出你想要的视频效果,AI 自动选素材、写脚本、配音、加字幕、配 BGM,一句话出成片。
          </p>

          <div className="hero-anim mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            {isAuthenticated ? (
              <Button size="lg" asChild className="h-12 px-8 text-base bg-brand-gradient text-white border-0 shadow-brand-md hover:shadow-brand-lg transition-shadow">
                <a href="/dashboard">
                  开始创作
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
            ) : (
              <>
                <Button size="lg" asChild className="h-12 px-8 text-base bg-brand-gradient text-white border-0 shadow-brand-md hover:shadow-brand-lg transition-shadow">
                  <a href="/register">
                    免费试用
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </a>
                </Button>
                <Button size="lg" variant="outline" asChild className="h-12 px-8 text-base rounded-xl">
                  <a href="/login">
                    <Play className="mr-2 h-4 w-4 fill-current" />
                    已有账号?登录
                  </a>
                </Button>
              </>
            )}
          </div>

          {/* 数据小条 */}
          <div className="hero-anim mt-12 flex flex-wrap justify-center gap-6 sm:gap-10 text-sm">
            <Stat label="自动决策维度" value="12+" />
            <Stat label="转场效果" value="45 种" />
            <Stat label="多语言字幕" value="8 种" />
            <Stat label="新用户赠送" value="1000 积分" />
          </div>
        </div>

        {/* Hero 视觉:模拟工作台预览卡片 */}
        <div className="hero-preview mt-20 mx-auto max-w-5xl">
          <div className="gradient-border rounded-3xl p-1.5 shadow-brand-lg hover-lift">
            <div className="rounded-[1.25rem] bg-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border/60 flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full bg-brand-pink/70" />
                <div className="h-3 w-3 rounded-full bg-brand-orange/70" />
                <div className="h-3 w-3 rounded-full bg-brand-cyan/70" />
                <div className="ml-3 text-xs text-muted-foreground font-mono">videomind / project / 自动剪辑</div>
              </div>
              <div className="grid md:grid-cols-[300px_1fr] gap-0 min-h-[340px]">
                {/* 左:对话 */}
                <div className="p-5 border-r border-border/60 space-y-3 bg-muted/30">
                  <div className="flex items-start gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-brand-gradient-warm flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-bold">U</span>
                    </div>
                    <div className="flex-1 rounded-2xl rounded-tl-sm bg-card px-3 py-2 text-sm">
                      做一条 30 秒的产品介绍,要有节奏感,加点活力 BGM
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-brand-gradient-cool flex items-center justify-center flex-shrink-0">
                      <Bot className="h-4 w-4 text-white" />
                    </div>
                    <div className="flex-1 rounded-2xl rounded-tl-sm bg-card px-3 py-2 text-sm">
                      已选 6 段素材,生成脚本中…
                      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full w-2/3 bg-brand-gradient" />
                      </div>
                    </div>
                  </div>
                </div>
                {/* 右:时间轴 */}
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">剪辑时间轴</div>
                    <div className="text-xs text-muted-foreground">6 个片段 · 28.4s</div>
                  </div>
                  <div className="space-y-2">
                    {[
                      { w: "w-[18%]", color: "bg-brand-gradient-warm" },
                      { w: "w-[12%]", color: "bg-brand-gradient-cool" },
                      { w: "w-[22%]", color: "bg-brand-gradient-violet" },
                      { w: "w-[14%]", color: "bg-brand-gradient-warm" },
                      { w: "w-[20%]", color: "bg-brand-gradient-cool" },
                      { w: "w-[14%]", color: "bg-brand-gradient-violet" },
                    ].map((c, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <div className="text-[10px] text-muted-foreground font-mono w-6">#{i + 1}</div>
                        <div className="flex-1 h-7 rounded-md bg-muted relative overflow-hidden">
                          <div
                            className={`absolute inset-y-0 left-0 ${c.w} ${c.color} rounded-md`}
                            style={{ marginLeft: `${i * 8}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2">
                    <Pill icon={<Mic className="h-3 w-3" />} label="女声-甜美" />
                    <Pill icon={<Music className="h-3 w-3" />} label="活力 BGM" />
                    <Pill icon={<Subtitles className="h-3 w-3" />} label="抖音黄字幕" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== 功能卡 ===== */}
      <section className="relative max-w-7xl mx-auto px-4 md:px-8 py-20">
        <div className="reveal text-center mb-14">
          <div className="inline-block px-3 py-1 rounded-full bg-brand-gradient-cool/10 text-brand-violet text-xs font-bold tracking-wider uppercase mb-4">
            Features
          </div>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
            一站式 <span className="text-brand-gradient">AI 视频流水线</span>
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            从理解需求到产出成片,5 个 AI 阶段全自动衔接,你只管说想要什么。
          </p>
        </div>

        <div className="reveal grid md:grid-cols-3 gap-5">
          <FeatureCard
            icon={<Wand2 className="h-6 w-6 text-white" />}
            iconBg="bg-brand-gradient-warm"
            title="智能选素材 + 自动选音色"
            desc="AI 读懂需求后,从你的素材库挑选最契合的片段,自动决定画幅、音色、BGM 情绪等 12+ 维度。"
          />
          <FeatureCard
            icon={<Bot className="h-6 w-6 text-white" />}
            iconBg="bg-brand-gradient-violet"
            title="审查 Agent 把关质量"
            desc="独立审查 Agent 对方案打分,4 维度评估;评分不达标自动重写脚本。给你 AI 自评分作为参考。"
          />
          <FeatureCard
            icon={<Subtitles className="h-6 w-6 text-white" />}
            iconBg="bg-brand-gradient-cool"
            title="精准字幕 + 45 种转场"
            desc="Whisper 转写做毫秒级字幕,4 种字幕样式可选;转场 45 种,审查 Agent 控制比例不滥用。"
          />
        </div>

        {/* 流程时间轴 */}
        <div className="reveal mt-16 relative">
          <div className="absolute left-0 right-0 top-1/2 h-px bg-border hidden md:block" />
          <div className="grid md:grid-cols-5 gap-4 relative">
            {[
              { step: "1", label: "上传素材", color: "bg-brand-gradient-warm" },
              { step: "2", label: "AI 自动决策", color: "bg-brand-gradient-warm" },
              { step: "3", label: "脚本 + 选片", color: "bg-brand-gradient-violet" },
              { step: "4", label: "TTS + 字幕 + 混音", color: "bg-brand-gradient-cool" },
              { step: "5", label: "成片交付", color: "bg-brand-gradient-cool" },
            ].map((s) => (
              <div key={s.step} className="flex md:flex-col items-center md:text-center gap-3 md:gap-2">
                <div className={`h-12 w-12 rounded-2xl ${s.color} flex items-center justify-center shadow-brand-sm flex-shrink-0`}>
                  <span className="text-white font-bold">{s.step}</span>
                </div>
                <div className="text-sm font-semibold">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 两种创作模式 ===== */}
      <section className="relative max-w-7xl mx-auto px-4 md:px-8 py-20">
        <div className="reveal text-center mb-12">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
            两种创作节奏,<span className="text-brand-gradient">自由切换</span>
          </h2>
        </div>

        <div className="reveal grid md:grid-cols-2 gap-6">
          <div className="relative rounded-3xl p-8 bg-card border border-border hover-lift">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-gradient-warm text-white text-xs font-bold mb-5">
              <Zap className="h-3 w-3" />
              极速一键
            </div>
            <h3 className="text-2xl font-bold mb-3">填一句话,等成片</h3>
            <p className="text-muted-foreground leading-relaxed mb-5">
              不打断、不干预。AI 完成 5 个阶段后,直接交付成片到你的输出列表。适合批量产出和不挑剔的场景。
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2"><Dot color="pink" />端到端约 2-5 分钟</li>
              <li className="flex items-center gap-2"><Dot color="orange" />单价 30 积分</li>
              <li className="flex items-center gap-2"><Dot color="orange" />任一环节失败自动降级,不会卡死</li>
            </ul>
          </div>

          <div className="relative rounded-3xl p-8 bg-card border border-border hover-lift">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-gradient-cool text-white text-xs font-bold mb-5">
              <Bot className="h-3 w-3" />
              方案确认
            </div>
            <h3 className="text-2xl font-bold mb-3">先看方案,再渲染</h3>
            <p className="text-muted-foreground leading-relaxed mb-5">
              AI 先生成剪辑方案给你看:脚本、选了哪些片段、配音音色、AI 自评分。你确认或微调后再渲染成片。
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2"><Dot color="violet" />渲染前可干预,质量更可控</li>
              <li className="flex items-center gap-2"><Dot color="cyan" />确认渲染不重复扣费</li>
              <li className="flex items-center gap-2"><Dot color="violet" />适合精修和重要场景</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ===== 积分系统 ===== */}
      <section className="relative max-w-7xl mx-auto px-4 md:px-8 py-20">
        <div className="reveal gradient-border rounded-3xl p-1 shadow-brand-md">
          <div className="rounded-[1.4rem] bg-card px-8 py-12 md:px-12 md:py-16">
            <div className="text-center mb-10">
              <div className="inline-flex h-14 w-14 rounded-2xl bg-brand-gradient items-center justify-center mb-5 shadow-brand-md">
                <Zap className="h-7 w-7 text-white" />
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-3">按需付费 · 透明计价</h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                注册即送 1000 积分,够你完整试用 33 次 AI 自动剪辑。
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 max-w-4xl mx-auto">
              <PriceCard label="AI 自动剪辑" price="30" unit="积分/次" highlight />
              <PriceCard label="视频分析" price="10" unit="积分/分钟" />
              <PriceCard label="智能剪辑" price="15" unit="积分/分钟" />
              <PriceCard label="字幕生成" price="8" unit="积分/分钟" />
              <PriceCard label="TTS 配音" price="5" unit="积分/分钟" />
            </div>
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="relative max-w-7xl mx-auto px-4 md:px-8 py-20">
        <div className="reveal relative rounded-3xl bg-brand-gradient p-12 md:p-16 text-center overflow-hidden shadow-brand-lg">
          <div className="relative">
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-5 tracking-tight">
              现在开始,把素材变成爆款
            </h2>
            <p className="text-white/85 text-lg mb-8 max-w-xl mx-auto">
              注册即送 1000 积分,无需信用卡
            </p>
            <Button size="lg" asChild className="h-12 px-8 text-base bg-white text-foreground hover:bg-white/90 border-0 shadow-xl">
              <a href={isAuthenticated ? "/dashboard" : "/register"}>
                {isAuthenticated ? "进入工作台" : "免费开始创作"}
                <ArrowRight className="ml-2 h-5 w-5" />
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="relative border-t border-border/60 bg-background/40 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-10 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-brand-gradient flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold">VideoMind</span>
          </div>
          <p className="text-sm text-muted-foreground">© 2026 VideoMind. AI 让创作更简单.</p>
        </div>
      </footer>
    </div>
  );
}

// ===== 子组件 =====

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-2xl font-bold text-brand-gradient">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function Pill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-muted text-xs font-medium">
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

function FeatureCard({
  icon,
  iconBg,
  title,
  desc,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="group relative rounded-2xl bg-card border border-border p-7 hover-lift">
      <div className={`inline-flex h-12 w-12 rounded-xl ${iconBg} items-center justify-center mb-5 shadow-brand-sm`}>
        {icon}
      </div>
      <h3 className="text-xl font-bold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

function PriceCard({
  label,
  price,
  unit,
  highlight = false,
}: {
  label: string;
  price: string;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-5 text-center transition ${
        highlight
          ? "bg-brand-gradient text-white shadow-brand-md"
          : "bg-muted/50 hover:bg-muted"
      }`}
    >
      <div className={`text-xs font-medium mb-1 ${highlight ? "text-white/80" : "text-muted-foreground"}`}>
        {label}
      </div>
      <div className="text-2xl font-bold">{price}</div>
      <div className={`text-[11px] ${highlight ? "text-white/80" : "text-muted-foreground"}`}>{unit}</div>
    </div>
  );
}

function Dot({ color }: { color: "pink" | "orange" | "violet" | "cyan" }) {
  const map = {
    pink: "bg-brand-pink",
    orange: "bg-brand-orange",
    violet: "bg-brand-violet",
    cyan: "bg-brand-cyan",
  };
  return <span className={`h-1.5 w-1.5 rounded-full ${map[color]} flex-shrink-0`} />;
}
