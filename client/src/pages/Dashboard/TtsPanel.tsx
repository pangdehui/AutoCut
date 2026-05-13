import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Volume2 } from "lucide-react";
import VoicePicker from "@/components/VoicePicker";

export default function TtsPanel() {
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("male-qn-qingse");
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  const [selectedVideo, setSelectedVideo] = useState<number | null>(null);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const videosQuery = trpc.videos.list.useQuery();
  const createTaskMutation = trpc.tasks.create.useMutation();
  const utils = trpc.useUtils();

  const handleSubmit = async () => {
    if (!text.trim()) { toast.error("请输入配音文本"); return; }
    setSubmitting(true);
    try {
      const params: Record<string, unknown> = {
        text: text.trim(),
        voiceId,
        speed,
        vol: volume,
      };
      if (selectedVideo) {
        params.videoId = selectedVideo;
        params.keepOriginal = keepOriginal;
      }

      const result = await createTaskMutation.mutateAsync({
        videoId: selectedVideo || 0,
        taskType: "tts",
        parameters: params,
      });

      if (result.success) {
        toast.success(selectedVideo
          ? "配音任务已创建，完成后将自动混入视频"
          : "配音任务已创建，请稍候");
        utils.tasks.list.invalidate();
      } else {
        toast.error(result.message || "创建失败");
      }
    } catch (error: any) {
      toast.error(error?.message || "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const videos = videosQuery.data?.data || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="h-5 w-5 text-accent" />
            AI 配音
          </CardTitle>
          <CardDescription>
            输入文字，选择音色，生成高质量语音配音
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 配音文本 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">配音文本</label>
            <Textarea
              placeholder="输入需要配音的文字内容..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
            />
          </div>

          {/* 音色选择 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">音色</label>
            <VoicePicker value={voiceId} onChange={setVoiceId} />
          </div>

          {/* 语速 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">语速: {speed.toFixed(1)}x</label>
            <Slider
              value={[speed]}
              onValueChange={([v]) => setSpeed(v)}
              min={0.5}
              max={2.0}
              step={0.1}
            />
          </div>

          {/* 音量 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">音量: {volume.toFixed(1)}x</label>
            <Slider
              value={[volume]}
              onValueChange={([v]) => setVolume(v)}
              min={0.1}
              max={2.0}
              step={0.1}
            />
          </div>

          {/* 可选：配到视频 */}
          <div className="space-y-3 p-4 rounded-lg border">
            <label className="text-sm font-medium">配到视频（可选）</label>
            {videosQuery.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : videos.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无视频</p>
            ) : (
              <Select
                value={selectedVideo?.toString() || ""}
                onValueChange={(v) => setSelectedVideo(v ? parseInt(v) : null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择要配音的视频" />
                </SelectTrigger>
                <SelectContent>
                  {videos.map((v) => (
                    <SelectItem key={v.id} value={v.id.toString()}>
                      {v.originalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {selectedVideo && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="keepOriginal"
                  checked={keepOriginal}
                  onCheckedChange={(v) => setKeepOriginal(!!v)}
                />
                <label htmlFor="keepOriginal" className="text-sm cursor-pointer">
                  保留原声（TTS 与原声混合）
                </label>
              </div>
            )}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitting || !text.trim()}
            className="w-full"
            size="lg"
          >
            {submitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />提交中...</>
            ) : (
              <><Volume2 className="mr-2 h-4 w-4" />生成配音</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
