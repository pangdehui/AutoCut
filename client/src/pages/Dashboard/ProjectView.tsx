import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2, Play, Trash2, FileVideo, Calendar, HardDrive,
  CheckCircle2, AlertCircle, Clock, ChevronDown, ChevronUp, Tag,
  Wand2, ArrowLeft, Upload, CheckSquare, Square,
} from "lucide-react";
import AnalysisViewer from "./AnalysisViewer";

const ALLOWED_TYPES = [".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".flv"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleString('zh-CN');
}

type AnalysisStatus = "none" | "queued" | "processing" | "completed" | "failed";

const STATUS_CONFIG: Record<AnalysisStatus, { label: string; className: string; icon: React.ReactNode }> = {
  none:       { label: "未分析",   className: "bg-muted text-muted-foreground",              icon: null },
  queued:     { label: "排队中",   className: "bg-yellow-100 text-yellow-700",               icon: <Clock className="h-3 w-3" /> },
  processing: { label: "分析中",   className: "bg-blue-100 text-blue-700",                   icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  completed:  { label: "已完成",   className: "bg-green-100 text-green-700",                  icon: <CheckCircle2 className="h-3 w-3" /> },
  failed:     { label: "分析失败", className: "bg-red-100 text-red-700",                     icon: <AlertCircle className="h-3 w-3" /> },
};

interface ProjectViewProps {
  projectId: number;
  onBack: () => void;
}

export default function ProjectView({ projectId, onBack }: ProjectViewProps) {
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const [aiPrompt, setAiPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const projectQuery = trpc.projects.getById.useQuery({ id: projectId });
  const videosQuery = trpc.videos.listWithStatus.useQuery({ projectId }, { refetchInterval: 5000 });
  const createTaskMutation = trpc.tasks.create.useMutation();
  const deleteVideoMutation = trpc.videos.delete?.useMutation();
  const utils = trpc.useUtils();

  const project = projectQuery.data?.data;
  const videos = videosQuery.data?.data || [];

  // 获取已完成分析的视频ID
  const analyzedVideoIds = videos
    .filter((v: any) => v.analysisStatus === "completed")
    .map((v: any) => v.id);

  const toggleSelect = (id: number) => {
    setSelectedVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedVideoIds.size === analyzedVideoIds.length) {
      setSelectedVideoIds(new Set());
    } else {
      setSelectedVideoIds(new Set(analyzedVideoIds));
    }
  };

  const handleAnalyze = async (videoId: number) => {
    try {
      const result = await createTaskMutation.mutateAsync({ videoId, taskType: 'analysis' });
      if (result.success) {
        toast.success('分析任务已创建');
        videosQuery.refetch();
        utils.tasks.list.invalidate();
      } else {
        toast.error(result.message || '创建失败');
      }
    } catch (error: any) {
      toast.error(error?.message || '创建失败');
    }
  };

  const handleAiEdit = async () => {
    if (!aiPrompt.trim()) { toast.error('请输入剪辑指令'); return; }
    const videoIds = selectedVideoIds.size > 0
      ? Array.from(selectedVideoIds)
      : analyzedVideoIds;
    if (videoIds.length === 0) { toast.error('没有已完成分析的视频'); return; }

    setEditing(true);
    try {
      const result = await createTaskMutation.mutateAsync({
        videoId: videoIds[0],
        taskType: 'ai_edit',
        parameters: { prompt: aiPrompt.trim(), videoIds },
      });
      if (result.success) {
        toast.success('AI 剪辑任务已创建');
        setAiPrompt("");
        utils.tasks.list.invalidate();
      } else {
        toast.error(result.message || '创建失败');
      }
    } catch (error: any) {
      toast.error(error?.message || '创建失败');
    } finally {
      setEditing(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("projectId", String(projectId));
    for (const file of Array.from(files)) formData.append("files", file);

    try {
      const resp = await fetch("/api/videos/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const result = await resp.json();
      if (result.success) {
        const successCount = result.data.filter((r: any) => r.success).length;
        toast.success(`上传成功 ${successCount} 个视频`);

        for (const r of result.data) {
          if (r.success) {
            try {
              await (trpc.tasks.create as any)({ videoId: r.videoId, taskType: 'analysis' });
            } catch {}
          }
        }
        videosQuery.refetch();
      } else {
        toast.error(result.message || '上传失败');
      }
    } catch {
      toast.error('上传失败');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDeleteVideo = async (videoId: number) => {
    if (!confirm('确定要删除这个视频吗？')) return;
    try {
      await deleteVideoMutation?.mutateAsync({ id: videoId });
      videosQuery.refetch();
      toast.success('视频已删除');
    } catch { toast.error('删除失败'); }
  };

  return (
    <div className="space-y-6">
      {/* 项目头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />返回
          </Button>
          <div>
            <h2 className="text-2xl font-bold">
              {projectQuery.isLoading ? <Loader2 className="h-6 w-6 animate-spin inline" /> : project?.name}
            </h2>
            {project?.description && (
              <p className="text-muted-foreground text-sm">{project.description}</p>
            )}
          </div>
        </div>
        <label className="cursor-pointer">
          <Button disabled={uploading} asChild>
            <span>
              {uploading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />上传中...</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" />上传视频</>
              )}
            </span>
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={handleUpload}
          />
        </label>
      </div>

      {/* AI 剪辑面板 */}
      {analyzedVideoIds.length > 0 && (
        <Card className="border-accent/30 bg-accent/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-accent" />
              AI 剪辑
              <Badge variant="outline" className="text-xs">
                {selectedVideoIds.size > 0 ? `已选 ${selectedVideoIds.size} 个` : `全部 ${analyzedVideoIds.length} 个`}
              </Badge>
            </CardTitle>
            <CardDescription>
              {selectedVideoIds.size > 0
                ? "已选视频的内容将一起发送给 AI 分析理解"
                : "默认使用所有已完成分析的视频"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="描述你想怎么剪辑这些视频，如：把视频1的开场和视频2的精彩片段合并..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAiEdit()}
                className="flex-1"
              />
              <Button onClick={handleAiEdit} disabled={editing || !aiPrompt.trim()}>
                {editing ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <><Wand2 className="h-4 w-4 mr-2" />AI 剪辑</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 视频列表 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            项目视频 ({videos.length})
          </h3>
          {analyzedVideoIds.length > 0 && (
            <Button variant="outline" size="sm" onClick={selectAll}>
              {selectedVideoIds.size === analyzedVideoIds.length
                ? <><Square className="h-3 w-3 mr-1" />取消全选</>
                : <><CheckSquare className="h-3 w-3 mr-1" />全选已完成</>
              }
            </Button>
          )}
        </div>

        {videos.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileVideo className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">项目中还没有视频</p>
              <p className="text-sm text-muted-foreground mt-2">点击上方"上传视频"添加</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {videos.map((video: any) => {
              const status: AnalysisStatus = video.analysisStatus || "none";
              const statusCfg = STATUS_CONFIG[status];
              const hasAnalysis = status === "completed" && video.analysisSummary;
              const isExpanded = expandedTaskId === video.analysisTaskId;
              const isSelected = selectedVideoIds.has(video.id);
              const canSelect = status === "completed";

              return (
                <Card key={video.id} className={`hover:shadow-md transition-shadow flex flex-col overflow-hidden ${isSelected ? 'ring-2 ring-accent' : ''}`}>
                  {/* 封面 */}
                  <div className="relative aspect-video bg-muted overflow-hidden">
                    <img
                      src={`/api/videos/thumbnail/${video.id}`}
                      alt={video.originalName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                    <div className="hidden absolute inset-0 flex items-center justify-center bg-muted">
                      <FileVideo className="h-12 w-12 text-muted-foreground" />
                    </div>
                    {/* 多选勾选框 */}
                    {canSelect && (
                      <button
                        className="absolute top-2 right-2 p-1 rounded-full bg-background/80 hover:bg-background"
                        onClick={() => toggleSelect(video.id)}
                      >
                        {isSelected
                          ? <CheckSquare className="h-5 w-5 text-accent" />
                          : <Square className="h-5 w-5 text-muted-foreground" />}
                      </button>
                    )}
                  </div>

                  <CardHeader className="pb-2">
                    <CardTitle className="text-base truncate">{video.originalName}</CardTitle>
                    <CardDescription>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1">
                          <HardDrive className="h-3 w-3" />{formatSize(video.fileSize)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />{formatDate(video.createdAt)}
                        </span>
                      </div>
                    </CardDescription>
                  </CardHeader>

                  <div className="px-6 pb-2">
                    <Badge className={`inline-flex items-center gap-1 text-xs ${statusCfg.className}`}>
                      {statusCfg.icon}{statusCfg.label}
                    </Badge>
                    {status === "processing" && (
                      <div className="mt-2"><Progress value={video.progress || 0} className="h-1.5" /></div>
                    )}
                  </div>

                  {hasAnalysis && (
                    <CardContent className="pt-0 pb-2 flex-1">
                      <div className="space-y-2 p-3 rounded-lg bg-accent/5 border border-accent/10">
                        {video.analysisCategory && (
                          <Badge variant="outline" className="text-xs">{video.analysisCategory}</Badge>
                        )}
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                          {video.analysisSummary}
                        </p>
                        {video.analysisKeywords && (
                          <div className="flex flex-wrap gap-1">
                            {video.analysisKeywords.slice(0, 4).map((kw: string, i: number) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                <Tag className="h-2.5 w-2.5 mr-0.5" />{kw}
                              </Badge>
                            ))}
                          </div>
                        )}
                        <button
                          className="flex items-center gap-1 text-xs text-accent hover:underline"
                          onClick={() => setExpandedTaskId(isExpanded ? null : video.analysisTaskId)}
                        >
                          {isExpanded ? <><ChevronUp className="h-3 w-3" />收起</> : <><ChevronDown className="h-3 w-3" />详情</>}
                        </button>
                      </div>
                    </CardContent>
                  )}

                  <CardContent className="pt-0 mt-auto">
                    <div className="flex gap-2">
                      {status === "none" || status === "failed" ? (
                        <Button size="sm" variant="outline" onClick={() => handleAnalyze(video.id)} className="flex-1">
                          <Play className="h-4 w-4 mr-1" />{status === "failed" ? "重新分析" : "分析内容"}
                        </Button>
                      ) : (
                        <div className="flex-1" />
                      )}
                      <Button size="sm" variant="destructive" onClick={() => handleDeleteVideo(video.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>

                  {isExpanded && (
                    <div className="px-6 pb-4">
                      <AnalysisViewer taskId={video.analysisTaskId!} />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
