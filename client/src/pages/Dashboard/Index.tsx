import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import TaskList from "./TaskList";
import OutputList from "./OutputList";
import ProjectWorkspace from "./ProjectWorkspace";
import {
  Loader2, Zap, Settings, Folders, Package, Sparkles,
  Film, User as UserIcon, ListChecks, Plus, FolderOpen, Trash2,
} from "lucide-react";

type GlobalView = "outputs" | "tasks" | "admin";

export default function Dashboard() {
  const { user, loading } = useAuth();
  const creditsQuery = trpc.credits.getBalance.useQuery(undefined, { enabled: !!user });
  const projectsQuery = trpc.projects.list.useQuery(undefined, { enabled: !!user });
  const createProjectMutation = trpc.projects.create.useMutation();
  const deleteProjectMutation = trpc.projects.delete.useMutation();
  const utils = trpc.useUtils();

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [globalView, setGlobalView] = useState<GlobalView | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

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
          <a href="/login" className="text-accent hover:underline">返回登录</a>
        </div>
      </div>
    );
  }

  const balance = creditsQuery.data?.success && creditsQuery.data?.data
    ? creditsQuery.data.data.balance
    : null;

  const projects: any[] = (projectsQuery.data?.data as any[]) || [];

  const handleCreateProject = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const r = await createProjectMutation.mutateAsync({ name });
      if (r.success && r.data) {
        toast.success("项目已创建");
        setNewName("");
        setCreateOpen(false);
        utils.projects.list.invalidate();
        setSelectedProjectId((r.data as any).id);
        setGlobalView(null);
      } else {
        toast.error(r.message || "创建失败");
      }
    } catch (e: any) {
      toast.error(e?.message || "创建失败");
    }
  };

  const handleDeleteProject = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定删除这个项目？项目中的视频不会被删除。")) return;
    try {
      await deleteProjectMutation.mutateAsync({ id });
      utils.projects.list.invalidate();
      toast.success("项目已删除");
      if (selectedProjectId === id) setSelectedProjectId(null);
    } catch {
      toast.error("删除失败");
    }
  };

  const selectProject = (id: number) => {
    setSelectedProjectId(id);
    setGlobalView(null);
  };

  const goGlobal = (view: GlobalView) => {
    setGlobalView(view);
    setSelectedProjectId(null);
  };

  const currentTitle = (() => {
    if (globalView === "outputs") return "生成结果";
    if (globalView === "tasks") return "任务列表";
    if (globalView === "admin") return "管理后台";
    if (selectedProjectId) {
      const p = projects.find((x) => x.id === selectedProjectId);
      return p?.name || "项目工作台";
    }
    return "选择或创建项目";
  })();

  const renderContent = () => {
    if (selectedProjectId) {
      return <ProjectWorkspace projectId={selectedProjectId} />;
    }
    if (globalView === "outputs") {
      return <div className="px-4 md:px-8 py-6 max-w-7xl w-full mx-auto"><OutputList /></div>;
    }
    if (globalView === "tasks") {
      return <div className="px-4 md:px-8 py-6 max-w-7xl w-full mx-auto"><TaskList /></div>;
    }
    if (globalView === "admin") {
      return (
        <div className="px-4 md:px-8 py-6 max-w-7xl w-full mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>管理后台</CardTitle>
              <CardDescription>用户、积分、任务监控等管理功能</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <a href="/admin">
                  <Settings className="h-4 w-4 mr-2" />进入管理后台
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    // 空状态
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <Sparkles className="h-16 w-16 text-amber-500/40 mb-4" />
        <h2 className="text-2xl font-bold mb-2">从一个项目开始</h2>
        <p className="text-muted-foreground text-sm mb-6 max-w-md">
          所有的剪辑、字幕、配音、AI 创作都围绕项目展开。<br />
          在左侧选择已有项目，或新建一个开始。
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />新建项目
        </Button>
      </div>
    );
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <a href="/" className="flex items-center gap-2 px-2 py-1">
            <Film className="h-5 w-5 text-accent shrink-0" />
            <span className="text-base font-bold group-data-[collapsible=icon]:hidden">
              AutoCut
            </span>
          </a>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent>
          {/* 项目列表 */}
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center gap-1">
              <Folders className="h-3 w-3" />我的项目
            </SidebarGroupLabel>
            <SidebarGroupAction asChild title="新建项目">
              <button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
              </button>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {projectsQuery.isLoading ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton disabled>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>加载中...</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : projects.length === 0 ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setCreateOpen(true)} tooltip="新建项目">
                      <Plus />
                      <span className="text-muted-foreground">新建项目</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  projects.map((p) => (
                    <SidebarMenuItem key={p.id}>
                      <SidebarMenuButton
                        isActive={selectedProjectId === p.id}
                        onClick={() => selectProject(p.id)}
                        tooltip={p.name}
                      >
                        <FolderOpen />
                        <span className="truncate">{p.name}</span>
                      </SidebarMenuButton>
                      <SidebarMenuAction
                        showOnHover
                        onClick={(e) => handleDeleteProject(p.id, e)}
                        title="删除项目"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* 全局产出 */}
          <SidebarGroup>
            <SidebarGroupLabel>全局</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={globalView === "outputs"}
                    onClick={() => goGlobal("outputs")}
                    tooltip="生成结果"
                  >
                    <Package />
                    <span>生成结果</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={globalView === "tasks"}
                    onClick={() => goGlobal("tasks")}
                    tooltip="任务列表"
                  >
                    <ListChecks />
                    <span>任务列表</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {user.role === "admin" && (
            <SidebarGroup>
              <SidebarGroupLabel>系统</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={globalView === "admin"}
                      onClick={() => goGlobal("admin")}
                      tooltip="管理后台"
                    >
                      <Settings />
                      <span>管理后台</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>

        <SidebarFooter>
          <div className="px-2 py-1 group-data-[collapsible=icon]:hidden">
            <div className="flex items-center justify-between rounded-md bg-accent/10 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-accent" />
                <span className="text-xs text-muted-foreground">积分</span>
              </div>
              {creditsQuery.isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span className="text-sm font-semibold text-accent">
                  {balance ?? "—"}
                </span>
              )}
            </div>
          </div>

          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip={user.name || user.email}>
                <a href="/profile">
                  <UserIcon />
                  <span className="truncate">{user.name || user.email}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/50 bg-background/80 backdrop-blur-sm px-4 shrink-0">
          <SidebarTrigger />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-foreground font-medium truncate">{currentTitle}</span>
          </div>
        </header>

        <main className="flex-1 flex flex-col min-h-0">
          {renderContent()}
        </main>
      </SidebarInset>

      {/* 新建项目对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建新项目</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <Input
              placeholder="输入项目名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
              autoFocus
            />
            <Button
              onClick={handleCreateProject}
              disabled={!newName.trim() || createProjectMutation.isPending}
              className="w-full"
            >
              {createProjectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              创建
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
