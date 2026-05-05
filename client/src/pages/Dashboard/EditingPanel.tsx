import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Scissors, Combine, Maximize, Type, Gauge } from "lucide-react";

const OPERATIONS: Record<string, { label: string; icon: React.ReactNode; desc: string }> = {
  trim: { label: "裁剪片头片尾", icon: <Scissors className="h-4 w-4" />, desc: "裁剪掉不需要的开头和结尾部分" },
  slice: { label: "切片合并", icon: <Combine className="h-4 w-4" />, desc: "剪切多个片段并拼接在一起" },
  resize: { label: "调整分辨率", icon: <Maximize className="h-4 w-4" />, desc: "缩放视频到指定分辨率" },
  watermark: { label: "添加水印", icon: <Type className="h-4 w-4" />, desc: "在视频上叠加文字水印" },
  speed: { label: "变速处理", icon: <Gauge className="h-4 w-4" />, desc: "加速或减速视频播放速度" },
};

const RESOLUTIONS = [
  { value: "1920:1080", label: "1080p (1920×1080)" },
  { value: "1280:720", label: "720p (1280×720)" },
  { value: "640:360", label: "360p (640×360)" },
];

const WATERMARK_POSITIONS = [
  { value: "top-left", label: "左上角" },
  { value: "top-right", label: "右上角" },
  { value: "bottom-left", label: "左下角" },
  { value: "bottom-right", label: "右下角" },
  { value: "center", label: "居中" },
];

export default function EditingPanel() {
  const [selectedVideo, setSelectedVideo] = useState<number | null>(null);
  const [operation, setOperation] = useState<string>("trim");
  const [submitting, setSubmitting] = useState(false);

  // Trim
  const [trimStart, setTrimStart] = useState("00:00:00");
  const [trimEnd, setTrimEnd] = useState("00:00:30");

  // Slice
  const [sliceSegments, setSliceSegments] = useState("00:00:05-00:00:15\n00:00:30-00:00:45");

  // Resize
  const [resolution, setResolution] = useState("1280:720");

  // Watermark
  const [watermarkText, setWatermarkText] = useState("");
  const [watermarkPos, setWatermarkPos] = useState("bottom-right");

  // Speed
  const [speed, setSpeed] = useState("1.5");

  const videosQuery = trpc.videos.list.useQuery();
  const createTaskMutation = trpc.tasks.create.useMutation();
  const utils = trpc.useUtils();

  const handleSubmit = async () => {
    if (!selectedVideo) {
      toast.error("请先选择一个视频");
      return;
    }

    setSubmitting(true);
    try {
      const params: Record<string, unknown> = { operation };

      switch (operation) {
        case "trim":
          params.trim = { startTime: trimStart, endTime: trimEnd };
          break;
        case "slice":
          params.slices = sliceSegments
            .split("\n")
            .filter((l) => l.trim())
            .map((line) => {
              const [start, end] = line.split("-");
              return { start: start.trim(), end: end.trim() };
            });
          break;
        case "resize":
          params.resolution = resolution;
          break;
        case "watermark":
          if (!watermarkText) {
            toast.error("请输入水印文字");
            setSubmitting(false);
            return;
          }
          params.watermark = { text: watermarkText, position: watermarkPos };
          break;
        case "speed": {
          const speedNum = parseFloat(speed);
          if (isNaN(speedNum) || speedNum <= 0) {
            toast.error("请输入有效速度值");
            setSubmitting(false);
            return;
          }
          params.speed = speedNum;
          break;
        }
      }

      const result = await createTaskMutation.mutateAsync({
        videoId: selectedVideo,
        taskType: "editing",
        parameters: params,
      });

      if (result.success) {
        toast.success("剪辑任务已创建，正在排队处理");
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
          <CardTitle>视频剪辑</CardTitle>
          <CardDescription>选择视频和处理方式，提交后由任务队列自动处理</CardDescription>
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
              <p className="text-sm text-muted-foreground">
                请先在"上传视频"中上传文件
              </p>
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
                      {v.fileName} ({(v.fileSize / (1024 * 1024)).toFixed(1)} MB)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* 选择操作类型 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">处理方式</label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {Object.entries(OPERATIONS).map(([key, op]) => (
                <button
                  key={key}
                  className={`p-3 rounded-lg border text-center transition-colors ${
                    operation === key
                      ? "border-accent bg-accent/5 text-accent"
                      : "border-border hover:border-accent/30"
                  }`}
                  onClick={() => setOperation(key)}
                >
                  <div className="flex justify-center mb-1">{op.icon}</div>
                  <div className="text-xs font-medium">{op.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 操作参数 */}
          <div className="p-4 rounded-lg border bg-muted/30">
            {operation === "trim" && (
              <div className="space-y-4">
                <p className="text-sm font-medium">裁剪时间范围</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">开始时间 (HH:MM:SS)</label>
                    <Input value={trimStart} onChange={(e) => setTrimStart(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">结束时间 (HH:MM:SS)</label>
                    <Input value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {operation === "slice" && (
              <div className="space-y-2">
                <p className="text-sm font-medium">切片时间段</p>
                <p className="text-xs text-muted-foreground">每行一段，格式：开始-结束（如 00:00:05-00:00:15）</p>
                <textarea
                  className="w-full min-h-[100px] p-3 rounded-lg border bg-background text-sm font-mono"
                  value={sliceSegments}
                  onChange={(e) => setSliceSegments(e.target.value)}
                />
              </div>
            )}

            {operation === "resize" && (
              <div className="space-y-2">
                <p className="text-sm font-medium">目标分辨率</p>
                <Select value={resolution} onValueChange={setResolution}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOLUTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {operation === "watermark" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">水印文字</label>
                  <Input
                    placeholder="如：AutoCut"
                    value={watermarkText}
                    onChange={(e) => setWatermarkText(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">位置</label>
                  <Select value={watermarkPos} onValueChange={setWatermarkPos}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WATERMARK_POSITIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {operation === "speed" && (
              <div className="space-y-2">
                <p className="text-sm font-medium">播放速度</p>
                <div className="flex items-center gap-4">
                  <Input
                    type="number"
                    step="0.25"
                    min="0.25"
                    max="4"
                    value={speed}
                    onChange={(e) => setSpeed(e.target.value)}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">
                    原速 = 1.0，加速 = {">"} 1.0，减速 = {"<"} 1.0
                  </span>
                </div>
                <div className="flex gap-2 mt-2">
                  {[0.5, 1.0, 1.5, 2.0].map((s) => (
                    <Button
                      key={s}
                      variant="outline"
                      size="sm"
                      onClick={() => setSpeed(s.toString())}
                    >
                      {s}×
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitting || !selectedVideo}
            className="w-full"
            size="lg"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                提交中...
              </>
            ) : (
              "提交剪辑任务"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
