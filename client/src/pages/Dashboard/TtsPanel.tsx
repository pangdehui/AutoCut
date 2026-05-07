import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Volume2 } from "lucide-react";

const VOICES = [
  { value: "male-qn-qingse", label: "青涩青年" },
  { value: "male-qn-jingying", label: "精英青年" },
  { value: "male-qn-badao", label: "霸道青年" },
  { value: "male-qn-daxuesheng", label: "青年大学生" },
  { value: "female-shaonv", label: "少女" },
  { value: "female-yujie", label: "御姐" },
  { value: "female-chengshu", label: "成熟女性" },
  { value: "female-tianmei", label: "甜美女性" },
  { value: "clever_boy", label: "聪明男童" },
  { value: "cute_boy", label: "可爱男童" },
  { value: "lovely_girl", label: "萌萌女童" },
  { value: "cartoon_pig", label: "卡通猪小琪" },
  { value: "bingjiao_didi", label: "病娇弟弟" },
  { value: "junlang_nanyou", label: "俊朗男友" },
  { value: "chunzhen_xuedi", label: "纯真学弟" },
  { value: "lengdan_xiongzhang", label: "冷淡学长" },
  { value: "badao_shaoye", label: "霸道少爷" },
  { value: "tianxin_xiaoling", label: "甜心小玲" },
  { value: "qiaopi_mengmei", label: "俏皮萌妹" },
  { value: "wumei_yujie", label: "妩媚御姐" },
  { value: "diadia_xuemei", label: "嗲嗲学妹" },
  { value: "danya_xuejie", label: "淡雅学姐" },
  { value: "Chinese (Mandarin)_Reliable_Executive", label: "沉稳高管" },
  { value: "Chinese (Mandarin)_News_Anchor", label: "新闻女声" },
  { value: "Chinese (Mandarin)_Mature_Woman", label: "傲娇御姐" },
  { value: "Chinese (Mandarin)_Unrestrained_Young_Man", label: "不羁青年" },
  { value: "Arrogant_Miss", label: "嚣张小姐" },
  { value: "Robot_Armor", label: "机械战甲" },
  { value: "Chinese (Mandarin)_Kind-hearted_Antie", label: "热心大婶" },
  { value: "Chinese (Mandarin)_HK_Flight_Attendant", label: "港普空姐" },
  { value: "Chinese (Mandarin)_Humorous_Elder", label: "搞笑大爷" },
  { value: "Chinese (Mandarin)_Gentleman", label: "温润男声" },
  { value: "Chinese (Mandarin)_Warm_Bestie", label: "温暖闺蜜" },
  { value: "Chinese (Mandarin)_Male_Announcer", label: "播报男声" },
  { value: "Chinese (Mandarin)_Sweet_Lady", label: "甜美女声" },
  { value: "Chinese (Mandarin)_Southern_Young_Man", label: "南方小哥" },
  { value: "Chinese (Mandarin)_Wise_Women", label: "阅历姐姐" },
  { value: "Chinese (Mandarin)_Gentle_Youth", label: "温润青年" },
  { value: "Chinese (Mandarin)_Warm_Girl", label: "温暖少女" },
  { value: "Chinese (Mandarin)_Kind-hearted_Elder", label: "花甲奶奶" },
  { value: "Chinese (Mandarin)_Cute_Spirit", label: "憨憨萌兽" },
  { value: "Chinese (Mandarin)_Radio_Host", label: "电台男主播" },
  { value: "Chinese (Mandarin)_Lyrical_Voice", label: "抒情男声" },
  { value: "Chinese (Mandarin)_Straightforward_Boy", label: "率真弟弟" },
  { value: "Chinese (Mandarin)_Sincere_Adult", label: "真诚青年" },
  { value: "Chinese (Mandarin)_Gentle_Senior", label: "温柔学姐" },
  { value: "Chinese (Mandarin)_Stubborn_Friend", label: "嘴硬竹马" },
  { value: "Chinese (Mandarin)_Crisp_Girl", label: "清脆少女" },
  { value: "Chinese (Mandarin)_Pure-hearted_Boy", label: "清澈邻家弟弟" },
  { value: "Chinese (Mandarin)_Soft_Girl", label: "柔和少女" },
  { value: "Cantonese_ProfessionalHost（F)", label: "粤语 专业女主持" },
  { value: "Cantonese_GentleLady", label: "粤语 温柔女声" },
  { value: "Cantonese_ProfessionalHost（M)", label: "粤语 专业男主持" },
  { value: "Cantonese_PlayfulMan", label: "粤语 活泼男声" },
  { value: "Cantonese_CuteGirl", label: "粤语 可爱女孩" },
  { value: "Cantonese_KindWoman", label: "粤语 善良女声" },
];

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
            <Select value={voiceId} onValueChange={setVoiceId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOICES.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
