import { useAuth } from "@/_core/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Users, Zap, Activity } from "lucide-react";
import UserManagement from "./UserManagement";
import CreditManagement from "./CreditManagement";
import TaskMonitor from "./TaskMonitor";

export default function AdminPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">权限不足，仅管理员可访问</p>
          <a href="/dashboard" className="text-accent hover:underline">
            返回仪表板
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <a href="/" className="text-xl font-bold">
              AutoCut
            </a>
            <div className="hidden md:flex items-center gap-6">
              <a href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
                仪表板
              </a>
              <span className="text-sm font-medium text-accent">管理后台</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a href="/profile" className="text-sm text-muted-foreground hover:text-foreground">
              {user.name || user.email}
            </a>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">管理后台</h1>
          <p className="text-muted-foreground">管理用户、积分与处理任务</p>
        </div>

        <Tabs defaultValue="users" className="space-y-6">
          <TabsList>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              用户管理
            </TabsTrigger>
            <TabsTrigger value="credits" className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              积分管理
            </TabsTrigger>
            <TabsTrigger value="tasks" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              任务监控
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <UserManagement />
          </TabsContent>

          <TabsContent value="credits">
            <CreditManagement />
          </TabsContent>

          <TabsContent value="tasks">
            <TaskMonitor />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
