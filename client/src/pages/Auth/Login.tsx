import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Mail } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "verify">("email");
  const [isLoading, setIsLoading] = useState(false);
  const [devCode, setDevCode] = useState<string | undefined>();

  const sendCodeMutation = trpc.auth.sendLoginCode.useMutation();
  const loginMutation = trpc.auth.loginWithCode.useMutation();

  const handleSendCode = async () => {
    if (!email) {
      toast.error("请输入邮箱地址");
      return;
    }

    setIsLoading(true);
    try {
      const result = await sendCodeMutation.mutateAsync({ email });
      if (result.success) {
        toast.success(result.message);
        setDevCode(result.devCode);
        setStep("verify");
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error("发送验证码失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!code) {
      toast.error("请输入验证码");
      return;
    }

    setIsLoading(true);
    try {
      const result = await loginMutation.mutateAsync({ email, code });
      if (result.success) {
        toast.success(result.message);
        setLocation("/dashboard");
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error("登录失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg border-border/50">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl font-bold">登录账户</CardTitle>
          <CardDescription>欢迎回到 AutoCut</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {step === "email" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">邮箱地址</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      disabled={isLoading}
                    />
                  </div>
                </div>
                <Button
                  onClick={handleSendCode}
                  disabled={isLoading || !email}
                  className="w-full"
                  size="lg"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      发送中...
                    </>
                  ) : (
                    "发送验证码"
                  )}
                </Button>
                <div className="text-center text-sm text-muted-foreground">
                  没有账户？{" "}
                  <a href="/register" className="text-accent hover:underline font-medium">
                    立即注册
                  </a>
                </div>
              </div>
            )}

            {step === "verify" && (
              <div className="space-y-4">
                <div className="bg-accent/5 border border-accent/20 rounded-lg p-3 text-sm text-center text-foreground/80">
                  验证码已发送到 <span className="font-medium">{email}</span>
                </div>
                {devCode && (
                  <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3 text-sm text-center text-yellow-800 font-mono">
                    [开发模式] 验证码：<span className="font-bold text-lg tracking-widest">{devCode}</span>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-sm font-medium">验证码</label>
                  <Input
                    type="text"
                    placeholder="输入 6 位验证码"
                    value={code}
                    onChange={(e) => setCode(e.target.value.slice(0, 6))}
                    maxLength={6}
                    className="text-center text-lg tracking-widest"
                  />
                </div>
                <Button
                  onClick={handleLogin}
                  disabled={isLoading || !code}
                  className="w-full"
                  size="lg"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      登录中...
                    </>
                  ) : (
                    "登录"
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStep("email")}
                  className="w-full"
                >
                  返回
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
