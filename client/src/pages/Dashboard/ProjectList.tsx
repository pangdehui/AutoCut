import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { FolderOpen, Plus, Trash2, Loader2, ArrowRight } from "lucide-react";

interface ProjectListViewProps {
  onSelectProject: (id: number) => void;
}

export default function ProjectList({ onSelectProject }: ProjectListViewProps) {
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const projectsQuery = trpc.projects.list.useQuery();
  const createMutation = trpc.projects.create.useMutation();
  const deleteMutation = trpc.projects.delete.useMutation();
  const utils = trpc.useUtils();

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const result = await createMutation.mutateAsync({ name: newName.trim() });
      if (result.success) {
        toast.success("项目已创建");
        setNewName("");
        setOpen(false);
        utils.projects.list.invalidate();
      } else {
        toast.error(result.message || "创建失败");
      }
    } catch (error: any) {
      toast.error(error?.message || "创建失败");
    }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定要删除这个项目吗？项目中的视频不会被删除。")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      utils.projects.list.invalidate();
      toast.success("项目已删除");
    } catch (error) {
      toast.error("删除失败");
    }
  };

  if (projectsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const projectList = projectsQuery.data?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">我的项目</h2>
          <p className="text-muted-foreground text-sm">选择一个项目开始编辑视频</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              新建项目
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>创建新项目</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <Input
                placeholder="输入项目名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <Button onClick={handleCreate} disabled={!newName.trim()} className="w-full">
                创建
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {projectList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">还没有项目</p>
            <p className="text-sm text-muted-foreground mt-2">创建一个项目来管理你的视频</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projectList.map((proj: any) => (
            <Card
              key={proj.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => onSelectProject(proj.id)}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FolderOpen className="h-5 w-5 text-accent" />
                    {proj.name}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-500"
                    onClick={(e) => handleDelete(proj.id, e)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <CardDescription>
                  {proj.description || "暂无描述"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    创建于 {new Date(proj.createdAt).toLocaleDateString("zh-CN")}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
