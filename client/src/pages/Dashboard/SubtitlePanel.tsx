import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Subtitles } from "lucide-react";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "ru", label: "Русский" },
];

export default function SubtitlePanel() {
  const [selectedVideo, setSelectedVideo] = useState<number | null>(null);
  const [targetLangs, setTargetLangs] = useState<string[]>(["en"]);
  const [burnIn, setBurnIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const videosQuery = trpc.videos.list.useQuery();
  const createTaskMutation = trpc.tasks.create.useMutation();
  const utils = trpc.useUtils();

  const toggleLang = (lang: string) => {
    setTargetLangs((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
    );
  };

  const handleSubmit = async () => {
    if (!selectedVideo) {
      toast.error("请先选择一个视频");
      return;
    }
    if (targetLangs.length === 0) {
      toast.error("请至少选择一种目标语言");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createTaskMutation.mutateAsync({
        videoId: selectedVideo,
        taskType: "subtitle",
        parameters: {
          targetLanguages: targetLangs,
          burnIn,
        },
      });

      if (result.success) {
        toast.success("字幕任务已创建，正在排队处理");
        utils.tasks.list.invalidate();
      } else {
        toast.error(result.message || "创建任务失败");
      }
    } catch (error) {
      toast.error("创建任务失败");
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
            <Subtitles className="h-5 w-5 text-accent" />
            字幕生成
          </CardTitle>
          <CardDescription>
            自动识别视频语音，生成多语言字幕文件（SRT 格式）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 选择视频 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">选择视频</label>
            {videosQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载中...
              </div>
            ) : videos.length === 0 ? (
              <p className="text-sm text-muted-foreground">请先在"上传视频"中上传文件</p>
            ) : (
              <Select
                value={selectedVideo?.toString() || ""}
                onValueChange={(v) => setSelectedVideo(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择一个视频" />
                </SelectTrigger>
                <SelectContent>
                  {videos.map((v) => (
                    <SelectItem key={v.id} value={v.id.toString()}>
                      {v.fileName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* 目标语言 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">目标语言（可多选）</label>
            <p className="text-xs text-muted-foreground">
              默认生成中文字幕，选择其他语言进行翻译
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {LANGUAGES.map((lang) => (
                <label
                  key={lang.value}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    targetLangs.includes(lang.value)
                      ? "border-accent bg-accent/5"
                      : "border-border hover:border-accent/30"
                  }`}
                >
                  <Checkbox
                    checked={targetLangs.includes(lang.value)}
                    onCheckedChange={() => toggleLang(lang.value)}
                  />
                  <span className="text-sm">{lang.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 压制选项 */}
          <div className="flex items-start gap-3 p-4 rounded-lg border">
            <Checkbox
              id="burnIn"
              checked={burnIn}
              onCheckedChange={(v) => setBurnIn(!!v)}
            />
            <div>
              <label htmlFor="burnIn" className="text-sm font-medium cursor-pointer">
                压制字幕到视频
              </label>
              <p className="text-xs text-muted-foreground">
                将字幕烧录到视频画面中，不可移除。不勾选则仅生成 SRT 文件
              </p>
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitting || !selectedVideo || targetLangs.length === 0}
            className="w-full"
            size="lg"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                提交中...
              </>
            ) : (
              "生成字幕"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
