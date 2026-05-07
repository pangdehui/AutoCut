import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Play, Trash2, FileVideo, Calendar, HardDrive } from "lucide-react";

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleString('zh-CN');
}

export default function VideoList() {
  const [selectedVideo, setSelectedVideo] = useState<number | null>(null);
  const videosQuery = trpc.videos.list.useQuery();
  const deleteVideoMutation = trpc.videos.delete?.useMutation();
  const createTaskMutation = trpc.tasks.create.useMutation();
  const utils = trpc.useUtils();

  const handleDelete = async (videoId: number) => {
    if (!confirm('确定要删除这个视频吗？')) return;

    try {
      await deleteVideoMutation?.mutateAsync({ id: videoId });
      videosQuery.refetch();
    } catch (error) {
      alert('删除失败');
    }
  };

  const handleAnalyze = async (videoId: number) => {
    try {
      const result = await createTaskMutation.mutateAsync({
        videoId,
        taskType: 'analysis',
      });
      if (result.success) {
        toast.success('分析任务已创建');
        utils.tasks.list.invalidate();
      } else {
        toast.error(result.message || '创建分析任务失败');
      }
    } catch (error: any) {
      toast.error(error?.message || '创建分析任务失败');
    }
  };

  if (videosQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (videosQuery.error) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-muted-foreground">
            加载视频列表失败: {videosQuery.error.message}
          </p>
        </CardContent>
      </Card>
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
        {videos.map((video) => (
          <Card key={video.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileVideo className="h-5 w-5" />
                {video.originalName}
              </CardTitle>
              <CardDescription className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <HardDrive className="h-4 w-4" />
                  {formatSize(video.fileSize)}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {formatDate(video.createdAt)}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAnalyze(video.id)}
                  className="flex-1"
                >
                  <Play className="h-4 w-4 mr-1" />
                  分析内容
                </Button>
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
        ))}
      </div>
    </div>
  );
}