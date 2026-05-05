import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Mail, Lock, User } from "lucide-react";

export default function Register() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"email" | "verify" | "password">("email");
  const [isLoading, setIsLoading] = useState(false);

  const sendCodeMutation = trpc.auth.sendRegisterCode.useMutation();
  const registerMutation = trpc.auth.register.useMutation();

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

  const handleVerifyCode = () => {
    if (!code) {
      toast.error("请输入验证码");
      return;
    }
    setStep("password");
  };

  const handleRegister = async () => {
    if (!password) {
      toast.error("请输入密码");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("两次输入的密码不一致");
      return;
    }
    if (password.length < 6) {
      toast.error("密码长度至少 6 位");
      return;
    }

    setIsLoading(true);
    try {
      const result = await registerMutation.mutateAsync({
        email,
        code,
        password,
        name: name || undefined,
      });
      if (result.success) {
        toast.success(result.message);
        setLocation("/login");
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error("注册失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg border-border/50">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl font-bold">创建账户</CardTitle>
          <CardDescription>加入 AutoCut，开始您的视频处理之旅</CardDescription>
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
                  已有账户？{" "}
                  <a href="/login" className="text-accent hover:underline font-medium">
                    立即登录
                  </a>
                </div>
              </div>
            )}

            {step === "verify" && (
              <div className="space-y-4">
                <div className="bg-accent/5 border border-accent/20 rounded-lg p-3 text-sm text-center text-foreground/80">
                  验证码已发送到 <span className="font-medium">{email}</span>
                </div>
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
                <Button onClick={handleVerifyCode} disabled={!code} className="w-full" size="lg">
                  验证并继续
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

            {step === "password" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">昵称（可选）</label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="输入您的昵称"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="pl-10"
                      disabled={isLoading}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="password"
                      placeholder="至少 6 位字符"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10"
                      disabled={isLoading}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">确认密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="password"
                      placeholder="再次输入密码"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-10"
                      disabled={isLoading}
                    />
                  </div>
                </div>
                <Button
                  onClick={handleRegister}
                  disabled={isLoading || !password || !confirmPassword}
                  className="w-full"
                  size="lg"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      注册中...
                    </>
                  ) : (
                    "完成注册"
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStep("verify")}
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
