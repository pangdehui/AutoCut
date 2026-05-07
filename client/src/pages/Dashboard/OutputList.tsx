import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  Loader2, CheckCircle2, FileVideo, FileAudio, FileText,
  Scissors, Wand2, Volume2, Subtitles, Download, Eye, Play,
} from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";

const TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  editing:  { label: "视频剪辑", icon: <Scissors className="h-4 w-4" />, color: "bg-purple-100 text-purple-700" },
  ai_edit:  { label: "AI 剪辑",  icon: <Wand2 className="h-4 w-4" />, color: "bg-indigo-100 text-indigo-700" },
  tts:      { label: "AI 配音",  icon: <Volume2 className="h-4 w-4" />, color: "bg-pink-100 text-pink-700" },
  subtitle: { label: "字幕生成", icon: <Subtitles className="h-4 w-4" />, color: "bg-teal-100 text-teal-700" },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

export default function OutputList() {
  const [player, setPlayer] = useState<{ open: boolean; src: string; title: string; isAudio: boolean }>({
    open: false, src: "", title: "", isAudio: false,
  });

  const tasksQuery = trpc.tasks.list.useQuery(
    { status: "completed" },
  );

  const tasks = tasksQuery.data?.data || [];

  const getOutputInfo = (task: any) => {
    const result = task.result as Record<string, any> | null;
    if (!result) return null;

    const outputPath = result.outputPath || result.audioPath || result.burntVideo;
    const fileSize = result.fileSize || 0;

    if (outputPath) {
      const isAudio = outputPath.endsWith(".mp3") || outputPath.endsWith(".wav");
      return { outputPath, fileSize, isAudio, explanation: result.explanation || result.message || "" };
    }
    return null;
  };

  if (tasksQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">生成结果</h2>
        <p className="text-muted-foreground text-sm">所有剪辑、配音、字幕的处理输出</p>
      </div>

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">暂无生成结果</p>
            <p className="text-sm text-muted-foreground mt-2">完成任务后产出会显示在这里</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tasks.map((task: any) => {
            const cfg = TYPE_CONFIG[task.taskType] || TYPE_CONFIG.editing;
            const output = getOutputInfo(task);

            return (
              <Card key={task.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <Badge className={`inline-flex items-center gap-1 text-xs ${cfg.color}`}>
                      {cfg.icon}
                      {cfg.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      #{task.id}
                    </span>
                  </div>
                  <CardDescription className="text-xs mt-1">
                    {output?.explanation || "处理完成"}
                  </CardDescription>
                </CardHeader>

                <CardContent className="pt-0 space-y-2">
                  {output ? (
                    <>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {output.isAudio ? (
                          <FileAudio className="h-4 w-4" />
                        ) : (
                          <FileVideo className="h-4 w-4" />
                        )}
                        <span className="truncate">{output.outputPath.split(/[/\\]/).pop()}</span>
                        {output.fileSize > 0 && (
                          <span className="shrink-0">{formatSize(output.fileSize)}</span>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => setPlayer({
                            open: true,
                            src: `/api/files/stream?path=${encodeURIComponent(output.outputPath)}`,
                            title: `${cfg.label} #${task.id}`,
                            isAudio: output.isAudio,
                          })}
                        >
                          <Play className="h-3.5 w-3.5 mr-1" />
                          预览
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const a = document.createElement("a");
                            a.href = `/api/files/stream?path=${encodeURIComponent(output.outputPath)}`;
                            a.download = output.outputPath.split(/[/\\]/).pop() || "output";
                            a.click();
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </>
                  ) : task.taskType === "subtitle" ? (
                    <>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        <span>字幕文件已生成</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          const subs = task.result?.subtitles as Record<string, any> | undefined;
                          if (subs) {
                            const lang = Object.keys(subs)[0];
                            if (lang) alert(`字幕语言: ${Object.keys(subs).join(", ")}`);
                          }
                        }}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        查看字幕信息
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">暂无输出文件</p>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {new Date(task.completedAt || task.createdAt).toLocaleString("zh-CN")}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <VideoPlayer
        open={player.open}
        onClose={() => setPlayer({ open: false, src: "", title: "", isAudio: false })}
        title={player.title}
        src={player.src}
        isAudio={player.isAudio}
      />
    </div>
  );
}
