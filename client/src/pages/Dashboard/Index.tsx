import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
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
import VideoUpload from "./VideoUpload";
import VideoList from "./VideoList";
import AICreator from "./AICreator";
import {
  Loader2, Zap, Settings, Folders, Package, Sparkles,
  User as UserIcon, ListChecks, Plus, FolderOpen, Trash2,
  Upload, Wand2, FolderPlus,
} from "lucide-react";

type GlobalView = "outputs" | "tasks" | "admin";
type ProjectView = "create" | "materials";

export default function Dashboard() {
  const { user, loading } = useAuth();
  const creditsQuery = trpc.credits.getBalance.useQuery(undefined, { enabled: !!user });
  const projectsQuery = trpc.projects.list.useQuery(undefined, { enabled: !!user });
  const createProjectMutation = trpc.projects.create.useMutation();
  const deleteProjectMutation = trpc.projects.delete.useMutation();
  const utils = trpc.useUtils();

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projectView, setProjectView] = useState<ProjectView>("create");
  const [globalView, setGlobalView] = useState<GlobalView | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-brand-violet" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">请先登录</p>
          <a href="/login" className="text-brand-violet hover:underline">返回登录</a>
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
        setProjectView("materials");
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
    if (!confirm("确定删除这个项目?项目中的视频不会被删除。")) return;
    try {
      await deleteProjectMutation.mutateAsync({ id });
      utils.projects.list.invalidate();
      toast.success("项目已删除");
      if (selectedProjectId === id) setSelectedProjectId(null);
    } catch {
      toast.error("删除失败");
    }
  };

  const selectProject = (id: number, view: ProjectView = "create") => {
    setSelectedProjectId(id);
    setProjectView(view);
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
      const sub = projectView === "materials" ? "· 素材库" : "· AI 创作";
      return `${p?.name || "项目"} ${sub}`;
    }
    return "VideoMind";
  })();

  const renderContent = () => {
    if (selectedProjectId) {
      if (projectView === "materials") {
        return (
          <div className="px-4 md:px-8 py-6 max-w-7xl w-full mx-auto space-y-6">
            <VideoUpload projectId={selectedProjectId} />
            <div className="border-t border-border/50 pt-6">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Folders className="h-5 w-5 text-brand-violet" />
                项目素材库
              </h3>
              <VideoList projectId={selectedProjectId} />
            </div>
          </div>
        );
      }
      return <AICreator projectId={selectedProjectId} />;
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
          <Button asChild className="bg-brand-gradient text-white border-0 shadow-brand-sm">
            <a href="/admin">
              <Settings className="h-4 w-4 mr-2" />进入管理后台
            </a>
          </Button>
        </div>
      );
    }
    // 未选择项目：引导用户从项目开始
    return <NoProjectEmptyState hasProjects={projects.length > 0} onCreate={() => setCreateOpen(true)} />;
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <a href="/" className="flex items-center gap-2.5 px-2 py-2.5">
            <div className="relative h-8 w-8 rounded-xl bg-brand-gradient shadow-brand-sm flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-base font-bold tracking-tight group-data-[collapsible=icon]:hidden">
              Video<span className="text-brand-gradient">Mind</span>
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
                        onClick={() => selectProject(p.id, "materials")}
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
            <div className="flex items-center justify-between rounded-xl bg-muted/50 border border-brand-violet/20 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-brand-violet" />
                <span className="text-xs text-muted-foreground">积分</span>
              </div>
              {creditsQuery.isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span className="text-sm font-bold text-brand-violet">
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/50 bg-background/80 backdrop-blur-xl px-4 shrink-0">
          <SidebarTrigger />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-foreground font-medium truncate">{currentTitle}</span>
          </div>
          {selectedProjectId && (
            <div className="ml-auto flex gap-1">
              <ProjectViewTab
                active={projectView === "materials"}
                onClick={() => setProjectView("materials")}
                icon={<Folders className="h-3.5 w-3.5" />}
                label="素材库"
              />
              <ProjectViewTab
                active={projectView === "create"}
                onClick={() => setProjectView("create")}
                icon={<Wand2 className="h-3.5 w-3.5" />}
                label="AI 创作"
              />
            </div>
          )}
        </header>

        <main className="flex-1 flex flex-col min-h-0 bg-muted/20">
          {renderContent()}
        </main>
      </SidebarInset>

      {/* 新建项目对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-brand-violet" />
              创建新项目
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <Input
              placeholder="输入项目名称(例如:产品介绍系列)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
              autoFocus
            />
            <Button
              onClick={handleCreateProject}
              disabled={!newName.trim() || createProjectMutation.isPending}
              className="w-full bg-brand-gradient text-white border-0 shadow-brand-sm"
            >
              {createProjectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              创建项目
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}

function ProjectViewTab({
  active, onClick, icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        active
          ? "bg-brand-violet/10 text-brand-violet"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function NoProjectEmptyState({
  hasProjects, onCreate,
}: {
  hasProjects: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="text-center max-w-md">
        <div className="inline-flex h-16 w-16 rounded-2xl bg-brand-gradient items-center justify-center mb-6 shadow-brand-md">
          <FolderPlus className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold mb-2">从一个项目开始</h2>
        <p className="text-muted-foreground mb-6 leading-relaxed">
          {hasProjects
            ? "选择左侧的项目进入素材库和 AI 创作，或新建一个项目。所有素材和剪辑都归属于项目，方便管理。"
            : "创建你的第一个项目，上传素材后即可让 AI 自动剪辑成片。"}
        </p>
        <Button
          onClick={onCreate}
          size="lg"
          className="bg-brand-gradient text-white border-0 shadow-brand-sm hover:shadow-brand-md transition-shadow"
        >
          <Plus className="h-4 w-4 mr-2" />
          新建项目
        </Button>
      </div>
    </div>
  );
}
