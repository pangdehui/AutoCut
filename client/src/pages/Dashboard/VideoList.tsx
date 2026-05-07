import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2, Play, Trash2, FileVideo, Calendar, HardDrive,
  CheckCircle2, AlertCircle, Clock, Eye,
} from "lucide-react";
import AnalysisViewer from "./AnalysisViewer";

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

export default function VideoList() {
  const [expandedVideo, setExpandedVideo] = useState<number | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const videosQuery = trpc.videos.listWithStatus.useQuery(undefined, { refetchInterval: 5000 });
  const deleteVideoMutation = trpc.videos.delete?.useMutation();
  const createTaskMutation = trpc.tasks.create.useMutation();
  const utils = trpc.useUtils();

  const handleDelete = async (videoId: number) => {
    if (!confirm('确定要删除这个视频吗？')) return;
    try {
      await deleteVideoMutation?.mutateAsync({ id: videoId });
      videosQuery.refetch();
      toast.success('视频已删除');
    } catch (error) {
      toast.error('删除失败');
    }
  };

  const handleAnalyze = async (videoId: number) => {
    try {
      const result = await createTaskMutation.mutateAsync({ videoId, taskType: 'analysis' });
      if (result.success) {
        toast.success('分析任务已创建，请稍候');
        videosQuery.refetch();
        utils.tasks.list.invalidate();
      } else {
        toast.error(result.message || '创建分析任务失败');
      }
    } catch (error: any) {
      toast.error(error?.message || '创建分析任务失败');
    }
  };

  const handleViewAnalysis = (videoId: number, taskId: number | null) => {
    if (taskId) {
      setExpandedTaskId(expandedTaskId === taskId ? null : taskId);
    }
    setExpandedVideo(expandedVideo === videoId ? null : videoId);
  };

  if (videosQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const videos = videosQuery.data?.data || [];

  if (videos.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center">
            <FileVideo className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">还没有上传任何视频</p>
            <p className="text-sm text-muted-foreground mt-2">
              切换到"上传视频"标签页开始上传
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {videos.map((video: any) => {
          const status: AnalysisStatus = video.analysisStatus || "none";
          const statusCfg = STATUS_CONFIG[status];

          return (
            <div key={video.id}>
              <Card className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between mb-1">
                    <CardTitle className="text-lg flex items-center gap-2 truncate">
                      <FileVideo className="h-5 w-5 shrink-0" />
                      <span className="truncate">{video.originalName}</span>
                    </CardTitle>
                  </div>
                  <CardDescription className="space-y-2">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="flex items-center gap-1">
                        <HardDrive className="h-4 w-4" />
                        {formatSize(video.fileSize)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {formatDate(video.createdAt)}
                      </span>
                    </div>
                    {/* 分析状态徽章 */}
                    <Badge
                      variant="secondary"
                      className={`inline-flex items-center gap-1 text-xs ${statusCfg.className}`}
                    >
                      {statusCfg.icon}
                      {statusCfg.label}
                    </Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex gap-2">
                    {status === "none" || status === "failed" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAnalyze(video.id)}
                        className="flex-1"
                      >
                        <Play className="h-4 w-4 mr-1" />
                        {status === "failed" ? "重新分析" : "分析内容"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={status !== "completed"}
                        onClick={() => handleViewAnalysis(video.id, video.analysisTaskId)}
                        className="flex-1"
                      >
                        {status === "processing" ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            分析中...
                          </>
                        ) : status === "queued" ? (
                          <>
                            <Clock className="h-4 w-4 mr-1" />
                            等待中...
                          </>
                        ) : (
                          <>
                            <Eye className="h-4 w-4 mr-1" />
                            查看分析
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(video.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* 展开的分析结果 */}
              {expandedVideo === video.id && expandedTaskId && status === "completed" && (
                <Card className="mt-2 border-accent/20">
                  <CardContent className="pt-4 pb-4">
                    <AnalysisViewer taskId={expandedTaskId} />
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
