import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import VideoPlayer from "@/components/VideoPlayer";
import VoicePicker from "@/components/VoicePicker";
import BgmPlayer from "@/components/BgmPlayer";
import {
  Loader2, Play, Trash2, FileVideo, Upload, CheckCircle2, AlertCircle, Clock,
  CheckSquare, Square, Sparkles, Wand2, Download, RefreshCw, Film,
  Volume2, Subtitles, Scissors, X, AtSign, Music,
} from "lucide-react";

const ALLOWED_TYPES = [".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".flv"];

function formatSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatTime(value: string | Date | number): string {
  return new Date(value).toLocaleString("zh-CN");
}

const TRANSITION_LABELS: Record<string, string> = {
  cut: "硬切", fade: "淡入", fadeblack: "黑场", fadewhite: "白场",
  dissolve: "叠化", slideleft: "左滑", slideright: "右滑",
  slideup: "上滑", slidedown: "下滑", wipeleft: "左擦", wiperight: "右擦",
  circleopen: "圆形展开", circleclose: "圆形闭合", zoomin: "推近",
};
const ASPECT_LABELS: Record<string, string> = {
  "16:9": "横屏 16:9", "9:16": "竖屏 9:16", "1:1": "方形 1:1",
};
const BGM_MOOD_LABELS: Record<string, string> = {
  upbeat: "活力", calm: "舒缓", dramatic: "戏剧", warm: "温情",
  energetic: "动感", cinematic: "电影感", none: "无",
};

type ChatResult = {
  phase?: string;           // "review" | "done"
  outputPath?: string;
  title: string;
  explanation?: string;
  fileSize?: number;
  isAudio?: boolean;
  script?: string;
  transitions?: { type: string; duration: number }[];
  voiceId?: string;
  speed?: number;
  aspect?: string;
  resolution?: string;
  bgmMood?: string;
  bgmApplied?: boolean;
  autoMode?: boolean;
  autoReasoning?: string | null;
  // 审查相关
  review?: {
    score: number;
    scriptReview: string;
    clipReview: string;
    suggestions: string[];
    riskWarnings: string[];
  };
  clips?: Array<{
    videoIndex: number;
    startTime: number;
    endTime: number;
    narration: string;
    transition: string;
    transitionDuration: number;
  }>;
  message?: string;
  // 保留确认方案所需的原始参数
  approvedPlanData?: any;
};

const WELCOME = `你好！这里是 **项目工作台**。

直接告诉我你想要什么样的视频，AI 会从右侧素材库中挑选片段、写脚本、配音并剪辑合成。

**也可以使用斜杠命令精确分发**：
- \`/剪辑 ...\` — 用选中的视频做精确剪辑（ai_edit）
- \`/字幕 ...\` — 给选中视频生成字幕
- \`/配音 文案\` — 用 AI 配音生成语音

右侧 **参数** 标签可调整音色、语速、画幅、BGM 等；勾选素材后命令会作用于这些素材。`;

type SlashCmd = "ai_video_creator" | "ai_edit" | "tts" | "subtitle";

function parseSlash(input: string): { cmd: SlashCmd; rest: string } {
  const t = input.trim();
  if (/^\/(剪辑|edit)(\s|$)/i.test(t)) return { cmd: "ai_edit", rest: t.replace(/^\/(剪辑|edit)\s*/i, "") };
  if (/^\/(字幕|sub)(\s|$)/i.test(t))  return { cmd: "subtitle", rest: t.replace(/^\/(字幕|sub)\s*/i, "") };
  if (/^\/(配音|tts)(\s|$)/i.test(t))  return { cmd: "tts", rest: t.replace(/^\/(配音|tts)\s*/i, "") };
  return { cmd: "ai_video_creator", rest: t };
}

/** 未使用斜杠命令时，根据自然语言关键词推断意图（仅在用户选中了视频时生效） */
function inferIntent(raw: string, hasSelectedVideos: boolean): SlashCmd {
  if (!hasSelectedVideos) return "ai_video_creator";
  const t = raw.trim();
  // 字幕：给XX加字幕 / 生成字幕 / 添加字幕 / 上字幕
  if (/(?:加|添加|生成|上|配|做|烧录|压制|弄|整).{0,5}字幕|字幕.{0,5}(?:生成|烧录|压制|添?加)/.test(t)) return "subtitle";
  // 纯关键词："字幕" 且不含"视频""创作""做一个""剪一个"等视频创作信号
  if (/字幕/.test(t) && !/(?:做|创作|生成|制作|合成|剪).{0,4}(?:视频|一个|一段|个)|(?:视频|片子).{0,2}(?:做|创作|制作|生成)/.test(t)) return "subtitle";
  // 配音：给XX配音 / 朗读 / TTS
  if (/(?:配音|朗读|tts)/i.test(t) && !/(?:视频|创作|剪辑|合成|制作)/.test(t)) return "tts";
  // 剪辑：剪切 / 裁剪 / 拼接
  if (/(?:剪辑|剪切|裁剪|拼接|trim|cut)/i.test(t) && !/(?:字幕|配音|创作)/.test(t)) return "ai_edit";
  return "ai_video_creator";
}

/** 检测用户是否想要 BGM/背景音乐 */
function wantsBgm(raw: string): boolean {
  return /(?:bgm|背景音乐|配乐|音乐)/i.test(raw);
}

interface ProjectWorkspaceProps {
  projectId: number;
}

export default function ProjectWorkspace({ projectId }: ProjectWorkspaceProps) {
  // ============ 对话与任务 ============
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: WELCOME },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [createdTaskId, setCreatedTaskId] = useState<number | null>(null);
  const [result, setResult] = useState<ChatResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastPromptRef = useRef("");

  // ============ 创作参数 ============
  const [autoMode, setAutoMode] = useState(true);
  const [voiceId, setVoiceId] = useState("female-chengshu");
  const [speed, setSpeed] = useState(1.0);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [burnSubtitles, setBurnSubtitles] = useState(false);
  const [noAudio, setNoAudio] = useState(false);
  const [overrideAspect, setOverrideAspect] = useState<string>("");
  const [overrideBgmMood, setOverrideBgmMood] = useState<string>("");

  // 字幕样式细粒度配置（覆盖预设）
  const [subtitleStylePreset, setSubtitleStylePreset] = useState<string>("default");
  const [subFontName, setSubFontName] = useState<string>("");
  const [subFontSize, setSubFontSize] = useState<number>(16);
  const [subPrimaryColor, setSubPrimaryColor] = useState<string>("#FFFFFF");
  const [subOutlineColor, setSubOutlineColor] = useState<string>("#000000");
  const [subOutline, setSubOutline] = useState<number>(2);
  const [subBold, setSubBold] = useState<boolean>(true);
  const [subAlignment, setSubAlignment] = useState<2 | 8>(2);
  const [subMarginV, setSubMarginV] = useState<number>(50);

  // ============ 素材选择 ============
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ============ 播放器 ============
  const [player, setPlayer] = useState<{ open: boolean; src: string; title: string; isAudio: boolean; poster?: string }>({
    open: false, src: "", title: "", isAudio: false,
  });

  // ============ 数据查询 ============
  const projectQuery = trpc.projects.getById.useQuery({ id: projectId });
  const videosQuery = trpc.videos.listWithStatus.useQuery({ projectId }, { refetchInterval: 5000 });
  const tasksQuery = trpc.tasks.list.useQuery({}, { refetchInterval: 3000 });
  const utils = trpc.useUtils();
  const createTaskMutation = trpc.tasks.create.useMutation();
  const deleteVideoMutation = trpc.videos.delete?.useMutation();

  const project = projectQuery.data?.data;
  const videos: any[] = (videosQuery.data?.data as any[]) || [];
  const allTasks: any[] = (tasksQuery.data?.data as any[]) || [];

  const projectVideoIds = useMemo(() => new Set(videos.map((v) => v.id)), [videos]);
  const analyzedVideoIds = useMemo(
    () => videos.filter((v) => v.analysisStatus === "completed").map((v) => v.id),
    [videos]
  );
  const projectTasks = useMemo(
    () => allTasks.filter((t) =>
      projectVideoIds.has(t.videoId) ||
      (t.taskType === "ai_video_creator" && t.parameters?.projectId === projectId)
    ),
    [allTasks, projectVideoIds, projectId]
  );

  const taskQuery = trpc.tasks.getById.useQuery(
    { id: createdTaskId! },
    { enabled: !!createdTaskId, refetchInterval: 2000 }
  );
  const taskData: any = taskQuery.data?.data;
  const taskStatus = taskData?.status;
  const taskProgress = taskData?.progress ?? 0;

  // ============ 任务完成监听 ============
  useEffect(() => {
    if (taskStatus === "completed" && taskData?.result && !result && isProcessing) {
      const r = taskData.result;

      if (r.phase === "review") {
        // 审查阶段：展示方案 + 审查结果，等待用户确认
        const next: ChatResult = {
          phase: "review",
          title: r.title || "AI 创作方案",
          script: r.script,
          explanation: r.message || "审查完成",
          review: r.review,
          clips: r.clips,
          message: r.message,
          approvedPlanData: {
            script: r.script,
            clips: r.clips,
            muteOriginal: r.muteOriginal,
            title: r.title,
            // 保留原始参数用于确认后继续
            meta: {
              topic: r.topic,
              style: r.style,
              selectedVideoIds: r.selectedVideoIds,
              voiceId: r.voiceId,
              speed: r.speed,
              aspect: r.aspect,
              resolution: r.resolution,
              subtitleStyle: r.subtitleStyle,
              bgmMood: r.bgmMood,
              bgmVolume: r.bgmVolume,
              noAudio: r.noAudio,
              subtitlesEnabled: r.subtitlesEnabled,
              subtitlesBurnIn: r.subtitlesBurnIn,
              autoMode: r.autoMode,
            },
          },
        };
        setResult(next);
        setIsProcessing(false);
        const scoreEmoji = (r.review?.score ?? 5) >= 7 ? "✅" : "⚠️";
        const approvedData = next.approvedPlanData!;
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `📋 **AI 方案已生成**\n\n**${r.title}** · ${scoreEmoji} 审查评分 ${r.review?.score ?? "?"}/10\n\n${r.review?.scriptReview || ""}\n\n> ${r.review?.clipReview || ""}\n\n${(r.review?.suggestions || []).map((s: string) => `💡 ${s}`).join("\n")}`,
            actions: (
              <>
                <Button size="sm" onClick={() => {
                  setResult(null);
                  setCreatedTaskId(null);
                  handleSend(lastPromptRef.current, approvedData);
                }}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />确认并执行
                </Button>
                <Button size="sm" variant="outline"
                        onClick={() => handleSend(lastPromptRef.current)}
                        disabled={isProcessing || !lastPromptRef.current}>
                  <RefreshCw className="h-3 w-3 mr-1" />修改需求
                </Button>
              </>
            ),
          },
        ]);
      } else {
        // 最终完成
        const outputPath = r.outputPath || r.burntVideo || r.audioPath;
        const isAudio = !!outputPath && (outputPath.endsWith(".mp3") || outputPath.endsWith(".wav"));
        const next: ChatResult = {
          phase: "done",
          outputPath,
          title: r.title || "AI 创作",
          explanation: r.explanation || r.message || "完成",
          fileSize: r.fileSize || 0,
          isAudio,
          script: r.script,
          transitions: Array.isArray(r.transitions) ? r.transitions : undefined,
          voiceId: r.voiceId,
          speed: typeof r.speed === "number" ? r.speed : undefined,
          aspect: r.aspect,
          resolution: r.resolution,
          bgmMood: r.bgmMood,
          bgmApplied: !!r.bgmApplied,
          autoMode: !!r.autoMode,
          autoReasoning: r.autoReasoning ?? null,
        };
        setResult(next);
        setIsProcessing(false);
        const doneOutputPath = outputPath;
        const doneTitle = next.title;
        const doneIsAudio = isAudio;
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `✅ **已完成：${next.title}**\n\n${next.explanation}${doneOutputPath ? "" : "\n\n详见右侧「产物」标签"}`,
            actions: doneOutputPath ? (
              <>
                <Button size="sm" onClick={() => setPlayer({
                  open: true,
                  src: `/api/files/stream?path=${encodeURIComponent(doneOutputPath)}`,
                  title: doneTitle,
                  isAudio: doneIsAudio,
                })}>
                  <Play className="h-3.5 w-3.5 mr-1" />预览
                </Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const a = document.createElement("a");
                  a.href = `/api/files/stream?path=${encodeURIComponent(doneOutputPath)}`;
                  a.download = doneOutputPath.split(/[/\\]/).pop() || "output";
                  a.click();
                }}>
                  <Download className="h-3.5 w-3.5 mr-1" />下载
                </Button>
              </>
            ) : undefined,
          },
        ]);
      }
      utils.tasks.list.invalidate();
    }
  }, [taskStatus, taskData, result, isProcessing, utils]);

  useEffect(() => {
    if (taskStatus === "failed" && isProcessing) {
      const msg = taskData?.errorMessage || "任务失败";
      setErrorMsg(msg);
      setIsProcessing(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `❌ 出错了：${msg}` },
      ]);
    }
  }, [taskStatus, taskData, isProcessing]);

  // 进度提示
  const lastProgressRef = useRef(-1);
  useEffect(() => {
    if (isProcessing && taskProgress > lastProgressRef.current) {
      lastProgressRef.current = taskProgress;
      setMessages((prev) => {
        const u = [...prev];
        const last = u[u.length - 1];
        if (last && last.role === "assistant" && last.content.includes("正在处理")) {
          u[u.length - 1] = { ...last, content: `正在处理中... ${taskProgress}%` };
        }
        return u;
      });
    }
    if (!isProcessing) lastProgressRef.current = -1;
  }, [isProcessing, taskProgress]);

  // ============ 发送消息（统一意图分发） ============
  const buildSubtitleConfig = useCallback(() => {
    // 只在用户改过默认值时才附带字段,避免无谓的覆盖
    const cfg: Record<string, unknown> = {};
    if (subFontName.trim()) cfg.fontName = subFontName.trim();
    if (subFontSize !== 16) cfg.fontSize = subFontSize;
    if (subPrimaryColor.toUpperCase() !== "#FFFFFF") cfg.primaryColor = subPrimaryColor;
    if (subOutlineColor.toUpperCase() !== "#000000") cfg.outlineColor = subOutlineColor;
    if (subOutline !== 2) cfg.outline = subOutline;
    if (subBold !== true) cfg.bold = subBold;
    if (subAlignment !== 2) cfg.alignment = subAlignment;
    if (subMarginV !== 50) cfg.marginV = subMarginV;
    return Object.keys(cfg).length > 0 ? cfg : undefined;
  }, [subFontName, subFontSize, subPrimaryColor, subOutlineColor, subOutline, subBold, subAlignment, subMarginV]);

  const handleSend = useCallback(async (raw: string, approvedPlan?: any) => {
    if (!raw.trim() && !approvedPlan) return;
    setErrorMsg(null);
    setResult(null);
    setCreatedTaskId(null);

    // 审批确认模式：跳过意图解析，直接用已审批方案
    if (approvedPlan) {
      setMessages((prev) => [...prev, { role: "user", content: "✅ 确认方案，开始执行剪辑" }]);
      lastPromptRef.current = raw;
      setIsProcessing(true);
      try {
        const meta = approvedPlan.meta || {};
        const baseParams: Record<string, unknown> = {
          prompt: raw,
          projectId,
          approvedPlan: {
            title: approvedPlan.title,
            script: approvedPlan.script,
            clips: approvedPlan.clips,
            muteOriginal: approvedPlan.muteOriginal ?? true,
          },
          autoMode: meta.autoMode ?? true,
          voiceId: meta.voiceId,
          speed: meta.speed,
          noAudio: meta.noAudio,
          aspect: meta.aspect,
          resolution: meta.resolution,
          subtitleStyle: meta.subtitleStyle,
          bgmMood: meta.bgmMood,
          bgmVolume: meta.bgmVolume,
          subtitles: meta.subtitlesEnabled != null
            ? { enabled: meta.subtitlesEnabled, burnIn: meta.subtitlesBurnIn }
            : undefined,
        };
        const res = await createTaskMutation.mutateAsync({
          videoId: 0,
          taskType: "ai_video_creator",
          parameters: baseParams,
        });
        if (!res.success || !res.data) throw new Error(res.message || "创建失败");
        setCreatedTaskId(res.data.id);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "正在执行剪辑... 0%" },
        ]);
      } catch (e: any) {
        setErrorMsg(e?.message || "执行失败");
        setIsProcessing(false);
      }
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: raw }]);
    lastPromptRef.current = raw;

    let { cmd, rest } = parseSlash(raw);
    const targetIds = Array.from(selectedVideoIds).filter((id) => analyzedVideoIds.includes(id));

    // 没有斜杠命令时，根据自然语言推断意图
    if (cmd === "ai_video_creator") {
      const inferred = inferIntent(raw, selectedVideoIds.size > 0);
      if (inferred !== "ai_video_creator") {
        cmd = inferred;
        rest = raw; // 保留原文用于 ai_edit/subtitle 的 prompt 参数
      }
    }

    try {
      setIsProcessing(true);

      if (cmd === "ai_edit") {
        const ids = targetIds.length > 0 ? targetIds : analyzedVideoIds;
        if (ids.length === 0) throw new Error("没有可剪辑的素材，请先上传并完成分析");
        if (!rest) throw new Error("请在 /剪辑 后描述你想怎么剪");
        const res = await createTaskMutation.mutateAsync({
          videoId: ids[0],
          taskType: "ai_edit",
          parameters: { prompt: rest, videoIds: ids, projectId },
        });
        if (!res.success || !res.data) throw new Error(res.message || "创建失败");
        setCreatedTaskId(res.data.id);
      } else if (cmd === "subtitle") {
        const id = targetIds[0] ?? analyzedVideoIds[0] ?? videos[0]?.id;
        if (!id) throw new Error("请先在右侧勾选要生成字幕的视频");
        // 检测 BGM 需求：提示词提到 BGM/音乐 或用户在参数面板选了背景音乐
        const addBgm = wantsBgm(rest) || !!overrideBgmMood;
        let bgmMood: string | undefined;
        if (addBgm) {
          bgmMood = overrideBgmMood || "upbeat"; // 用户没指定情绪时默认 upbeat
        }
        const res = await createTaskMutation.mutateAsync({
          videoId: id,
          taskType: "subtitle",
          parameters: {
            prompt: rest,
            targetLanguages: ["zh"],
            burnIn: true,
            burnLanguage: "zh",
            projectId,
            style: subtitleStylePreset,
            subtitleConfig: buildSubtitleConfig(),
            bgmMood,
            bgmVolume: 0.15,
          },
        });
        if (!res.success || !res.data) throw new Error(res.message || "创建失败");
        setCreatedTaskId(res.data.id);
      } else if (cmd === "tts") {
        const id = targetIds[0] ?? analyzedVideoIds[0] ?? videos[0]?.id ?? 0;
        if (!rest) throw new Error("请在 /配音 后输入要朗读的文案");
        const res = await createTaskMutation.mutateAsync({
          videoId: id,
          taskType: "tts",
          parameters: { text: rest, voiceId, speed, projectId },
        });
        if (!res.success || !res.data) throw new Error(res.message || "创建失败");
        setCreatedTaskId(res.data.id);
      } else {
        // ai_video_creator（默认）
        const subtitleCfg = buildSubtitleConfig();
        const baseParams: Record<string, unknown> = {
          prompt: rest,
          projectId,
          autoMode,
          // 字幕样式细节（字体/字号/颜色等）始终生效,即使 autoMode 也能覆盖
          subtitleStyle: subtitleStylePreset,
          ...(subtitleCfg ? { subtitleConfig: subtitleCfg } : {}),
          ...(autoMode
            ? {}
            : {
                voiceId,
                speed,
                noAudio,
                subtitles: { enabled: showSubtitles, burnIn: showSubtitles && burnSubtitles },
              }),
        };
        if (overrideAspect) baseParams.aspect = overrideAspect;
        if (overrideBgmMood) baseParams.bgmMood = overrideBgmMood;
        if (targetIds.length > 0) baseParams.videoIds = targetIds;

        const res = await createTaskMutation.mutateAsync({
          videoId: 0,
          taskType: "ai_video_creator",
          parameters: baseParams,
        });
        if (!res.success || !res.data) throw new Error(res.message || "创建失败");
        setCreatedTaskId(res.data.id);
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "已收到指令，正在处理中... 0%" },
      ]);
    } catch (e: any) {
      const msg = e?.message || "请求失败";
      setErrorMsg(msg);
      setIsProcessing(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `❌ ${msg}` },
      ]);
    }
  }, [
    selectedVideoIds, analyzedVideoIds, videos, projectId, autoMode,
    voiceId, speed, noAudio, showSubtitles, burnSubtitles,
    overrideAspect, overrideBgmMood, createTaskMutation,
    subtitleStylePreset, buildSubtitleConfig,
  ]);

  // ============ 素材操作 ============
  const toggleSelect = (id: number) => {
    setSelectedVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("projectId", String(projectId));
    for (const f of Array.from(files)) fd.append("files", f);
    try {
      const resp = await fetch("/api/videos/upload", { method: "POST", credentials: "include", body: fd });
      const r = await resp.json();
      if (r.success) {
        const ok = r.data.filter((x: any) => x.success).length;
        toast.success(`上传成功 ${ok} 个`);
        for (const x of r.data) {
          if (x.success) {
            try { await createTaskMutation.mutateAsync({ videoId: x.videoId, taskType: "analysis" }); }
            catch {}
          }
        }
        videosQuery.refetch();
        utils.tasks.list.invalidate();
      } else {
        toast.error(r.message || "上传失败");
      }
    } catch {
      toast.error("上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAnalyze = async (id: number) => {
    try {
      const r = await createTaskMutation.mutateAsync({ videoId: id, taskType: "analysis" });
      if (r.success) {
        toast.success("分析任务已创建");
        videosQuery.refetch();
        utils.tasks.list.invalidate();
      } else {
        toast.error(r.message || "失败");
      }
    } catch (e: any) {
      toast.error(e?.message || "失败");
    }
  };

  const handleDeleteVideo = async (id: number) => {
    if (!confirm("确定删除这个视频?")) return;
    try {
      await deleteVideoMutation?.mutateAsync({ id });
      videosQuery.refetch();
      toast.success("已删除");
      setSelectedVideoIds((prev) => {
        const n = new Set(prev); n.delete(id); return n;
      });
    } catch { toast.error("删除失败"); }
  };

  // ============ 渲染 ============
  return (
    <div className="flex h-[calc(100vh-3.5rem)] gap-4 px-4 py-4">
      {/* 中:对话 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold truncate flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500 shrink-0" />
              {projectQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : project?.name || "项目工作台"}
            </h2>
            {project?.description && (
              <p className="text-xs text-muted-foreground truncate">{project.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="outline" className="text-[10px]"><FileVideo className="h-3 w-3 mr-1" />{videos.length} 素材</Badge>
            <Badge variant="outline" className="text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" />{analyzedVideoIds.length} 已分析</Badge>
            {selectedVideoIds.size > 0 && (
              <Badge className="text-[10px] bg-accent text-accent-foreground">已选 {selectedVideoIds.size}</Badge>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col gap-2">
          {/* 选中素材条:始终展示当前对话/命令将作用于哪些素材 */}
          <SelectionBar
            videos={videos}
            selectedIds={selectedVideoIds}
            analyzedIds={analyzedVideoIds}
            onRemove={(id) => setSelectedVideoIds((prev) => { const n = new Set(prev); n.delete(id); return n; })}
            onClear={() => setSelectedVideoIds(new Set())}
            onSelectAllAnalyzed={() => setSelectedVideoIds(new Set(analyzedVideoIds))}
          />
          <div className="flex-1 min-h-0">
            <AIChatBox
              messages={messages}
              onSendMessage={handleSend}
              isLoading={isProcessing}
              placeholder="描述视频；用 /剪辑 /字幕 /配音 分发；用 @ 选择素材..."
              height="100%"
              suggestedPrompts={[
                "做一个 30 秒抖音美食探店视频",
                "/剪辑 把开场和精彩片段拼起来",
                "/字幕 自动识别并烧录到画面上",
                "/配音 欢迎来到我的频道",
              ]}
              mentionItems={videos.map((v) => ({
                id: v.id,
                label: v.originalName,
                thumbnail: `/api/videos/thumbnail/${v.id}`,
                hint: v.analysisStatus === "completed"
                  ? "已分析"
                  : v.analysisStatus === "processing" ? `分析中 ${v.progress ?? 0}%`
                  : v.analysisStatus === "failed" ? "分析失败"
                  : "未分析",
              }))}
              onMention={(item) => {
                const id = Number(item.id);
                setSelectedVideoIds((prev) => {
                  const next = new Set(prev);
                  next.add(id);
                  return next;
                });
                toast.success(`已添加：${item.label}`);
              }}
            />
          </div>
        </div>

        {isProcessing && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>处理中... {taskProgress}%</span>
            <Progress value={taskProgress} className="h-1 flex-1" />
          </div>
        )}
      </div>

      {/* 右:Tabs */}
      <div className="w-[420px] shrink-0 flex flex-col">
        <Tabs defaultValue="materials" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="materials" className="text-xs">素材</TabsTrigger>
            <TabsTrigger value="params" className="text-xs">参数</TabsTrigger>
            <TabsTrigger value="outputs" className="text-xs">产物</TabsTrigger>
            <TabsTrigger value="tasks" className="text-xs">任务</TabsTrigger>
          </TabsList>

          <TabsContent value="materials" className="flex-1 min-h-0 mt-3">
            <Card className="h-full flex flex-col">
              <div className="p-3 border-b flex items-center justify-between gap-2">
                <span className="text-sm font-medium">素材库 ({videos.length})</span>
                <div className="flex items-center gap-1.5">
                  {analyzedVideoIds.length > 0 && (
                    <Button
                      size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => {
                        if (selectedVideoIds.size === analyzedVideoIds.length) {
                          setSelectedVideoIds(new Set());
                        } else {
                          setSelectedVideoIds(new Set(analyzedVideoIds));
                        }
                      }}
                    >
                      {selectedVideoIds.size === analyzedVideoIds.length
                        ? <><Square className="h-3 w-3 mr-1" />取消全选</>
                        : <><CheckSquare className="h-3 w-3 mr-1" />全选已分析</>}
                    </Button>
                  )}
                  <label className="cursor-pointer">
                    <Button size="sm" variant="outline" disabled={uploading} asChild>
                      <span className="text-xs">
                        {uploading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />上传</>
                                   : <><Upload className="h-3 w-3 mr-1" />上传</>}
                      </span>
                    </Button>
                    <input ref={fileInputRef} type="file" multiple
                           accept={ALLOWED_TYPES.join(",")} className="hidden"
                           onChange={handleUpload} />
                  </label>
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-2">
                  {videos.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted-foreground">
                      <FileVideo className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      暂无素材，点击「上传」开始
                    </div>
                  ) : videos.map((v) => {
                    const isSelected = selectedVideoIds.has(v.id);
                    const status = v.analysisStatus || "none";
                    const canSelect = status === "completed";
                    return (
                      <div
                        key={v.id}
                        className={`flex gap-2 p-2 rounded-md border transition-colors ${isSelected ? "bg-accent/10 border-accent" : "bg-card hover:bg-muted/50"} ${canSelect ? "cursor-pointer" : ""}`}
                        onClick={() => { if (canSelect) toggleSelect(v.id); }}
                      >
                        <button
                          className="relative w-20 h-14 rounded overflow-hidden bg-muted shrink-0 group"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlayer({
                              open: true,
                              src: `/api/videos/stream/${v.id}`,
                              poster: `/api/videos/thumbnail/${v.id}`,
                              title: v.originalName,
                              isAudio: false,
                            });
                          }}
                        >
                          <img src={`/api/videos/thumbnail/${v.id}`}
                               alt={v.originalName}
                               className="w-full h-full object-cover"
                               onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition">
                            <Play className="h-4 w-4 text-white opacity-0 group-hover:opacity-100" fill="white" />
                          </div>
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{v.originalName}</p>
                          <p className="text-[10px] text-muted-foreground">{formatSize(v.fileSize)}</p>
                          <div className="mt-1 flex items-center gap-1">
                            <StatusBadge status={status} progress={v.progress} />
                          </div>
                        </div>
                        <div
                          className="flex flex-col gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {canSelect ? (
                            <button onClick={() => toggleSelect(v.id)}
                                    className="p-1 rounded hover:bg-muted">
                              {isSelected ? <CheckSquare className="h-4 w-4 text-accent" />
                                          : <Square className="h-4 w-4 text-muted-foreground" />}
                            </button>
                          ) : (status === "none" || status === "failed") ? (
                            <Button size="sm" variant="ghost"
                                    className="h-6 px-1.5 text-[10px]"
                                    onClick={() => handleAnalyze(v.id)}>
                              {status === "failed" ? "重试" : "分析"}
                            </Button>
                          ) : null}
                          <button onClick={() => handleDeleteVideo(v.id)}
                                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
              {selectedVideoIds.size > 0 && (
                <div className="p-2 border-t bg-accent/5 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">已选 {selectedVideoIds.size} 个（/剪辑 /字幕 /配音 将作用于它们）</span>
                  <Button size="sm" variant="ghost" className="h-6 text-xs"
                          onClick={() => setSelectedVideoIds(new Set())}>
                    清空
                  </Button>
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="params" className="flex-1 min-h-0 mt-3">
            <Card className="h-full">
              <ScrollArea className="h-full">
                <CardContent className="space-y-4 pt-4">
                  <div className="flex items-start justify-between gap-3 p-3 rounded-md bg-amber-50 border border-amber-200/50">
                    <div className="flex-1">
                      <Label className="text-xs font-medium">AI 自动模式</Label>
                      <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                        {autoMode ? "由 AI 决定全部参数" : "手动指定下方参数"}
                      </p>
                    </div>
                    <Switch checked={autoMode} onCheckedChange={setAutoMode} disabled={isProcessing} />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">画幅（覆盖）</Label>
                    <Select value={overrideAspect || "_auto"}
                            onValueChange={(v) => setOverrideAspect(v === "_auto" ? "" : v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_auto" className="text-xs">画幅：AI 决定</SelectItem>
                        <SelectItem value="9:16" className="text-xs">竖屏 9:16</SelectItem>
                        <SelectItem value="16:9" className="text-xs">横屏 16:9</SelectItem>
                        <SelectItem value="1:1"  className="text-xs">方形 1:1</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">背景音乐（覆盖）</Label>
                    <Select value={overrideBgmMood || "_auto"}
                            onValueChange={(v) => setOverrideBgmMood(v === "_auto" ? "" : v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_auto" className="text-xs">BGM：AI 决定</SelectItem>
                        <SelectItem value="upbeat" className="text-xs">活力</SelectItem>
                        <SelectItem value="calm" className="text-xs">舒缓</SelectItem>
                        <SelectItem value="dramatic" className="text-xs">戏剧</SelectItem>
                        <SelectItem value="warm" className="text-xs">温情</SelectItem>
                        <SelectItem value="energetic" className="text-xs">动感</SelectItem>
                        <SelectItem value="cinematic" className="text-xs">电影感</SelectItem>
                        <SelectItem value="none" className="text-xs">无 BGM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* BGM 试听 */}
                  <div className="space-y-2 pt-2 border-t">
                    <Label className="text-xs flex items-center gap-1">
                      <Music className="h-3 w-3" />BGM 试听
                    </Label>
                    <BgmPlayer />
                  </div>

                  <div className={`space-y-3 ${autoMode ? "opacity-50 pointer-events-none" : ""}`}>
                    <div className="space-y-2 pt-2 border-t">
                      <Label className="text-xs flex items-center gap-1"><Volume2 className="h-3 w-3" />音色</Label>
                      <VoicePicker value={voiceId} onChange={setVoiceId} disabled={isProcessing || autoMode} />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">语速</Label>
                        <span className="text-xs text-muted-foreground">{speed.toFixed(1)}x</span>
                      </div>
                      <Slider value={[speed]} onValueChange={([v]) => setSpeed(v)}
                              min={0.5} max={2.0} step={0.1} disabled={isProcessing || autoMode} />
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t">
                      <div>
                        <Label className="text-xs">无配音（仅字幕）</Label>
                        <p className="text-[10px] text-muted-foreground">跳过 TTS</p>
                      </div>
                      <Switch checked={noAudio}
                              onCheckedChange={(v) => { setNoAudio(v); if (v) setShowSubtitles(true); }}
                              disabled={isProcessing || autoMode} />
                    </div>

                    <div className="space-y-2 pt-2 border-t">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs flex items-center gap-1"><Subtitles className="h-3 w-3" />生成字幕</Label>
                        <Switch checked={showSubtitles} onCheckedChange={setShowSubtitles}
                                disabled={isProcessing || autoMode} />
                      </div>
                      {showSubtitles && (
                        <div className="flex items-center justify-between pl-2">
                          <Label className="text-[10px] text-muted-foreground">烧录到视频</Label>
                          <Switch checked={burnSubtitles} onCheckedChange={setBurnSubtitles}
                                  disabled={isProcessing || autoMode} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 字幕样式（始终可编辑，autoMode 下也生效覆盖预设） */}
                  <div className="space-y-3 pt-3 border-t">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <Subtitles className="h-3 w-3" />字幕样式
                      <span className="text-[10px] font-normal text-muted-foreground ml-1">
                        （开启"生成字幕"后生效，自动模式下也会覆盖预设）
                      </span>
                    </Label>

                    {/* 预设 */}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">预设</Label>
                      <Select value={subtitleStylePreset} onValueChange={setSubtitleStylePreset}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default" className="text-xs">默认（白字黑边）</SelectItem>
                          <SelectItem value="bold_caption" className="text-xs">抖音大字（粗黑描边）</SelectItem>
                          <SelectItem value="tiktok_yellow" className="text-xs">TikTok 黄字</SelectItem>
                          <SelectItem value="minimal" className="text-xs">极简（细描边）</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 字体 */}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">字体</Label>
                      <Select value={subFontName || "_default"} onValueChange={(v) => setSubFontName(v === "_default" ? "" : v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_default" className="text-xs">预设字体</SelectItem>
                          <SelectItem value="Microsoft YaHei" className="text-xs">微软雅黑</SelectItem>
                          <SelectItem value="SimHei" className="text-xs">黑体</SelectItem>
                          <SelectItem value="SimSun" className="text-xs">宋体</SelectItem>
                          <SelectItem value="PingFang SC" className="text-xs">苹方</SelectItem>
                          <SelectItem value="Source Han Sans SC" className="text-xs">思源黑体</SelectItem>
                          <SelectItem value="Noto Sans SC" className="text-xs">Noto Sans SC</SelectItem>
                          <SelectItem value="Arial" className="text-xs">Arial</SelectItem>
                          <SelectItem value="Impact" className="text-xs">Impact</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 字号 */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] text-muted-foreground">字号</Label>
                        <span className="text-[10px] text-muted-foreground">{subFontSize}px</span>
                      </div>
                      <Slider value={[subFontSize]} onValueChange={([v]) => setSubFontSize(v)}
                              min={12} max={60} step={1} disabled={isProcessing} />
                    </div>

                    {/* 颜色 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">字体颜色</Label>
                        <div className="flex items-center gap-1">
                          <input type="color" value={subPrimaryColor}
                                 onChange={(e) => setSubPrimaryColor(e.target.value)}
                                 className="h-7 w-10 rounded border cursor-pointer bg-transparent"
                                 disabled={isProcessing} />
                          <Input value={subPrimaryColor}
                                 onChange={(e) => setSubPrimaryColor(e.target.value)}
                                 className="h-7 text-[10px] flex-1 font-mono"
                                 disabled={isProcessing} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">描边颜色</Label>
                        <div className="flex items-center gap-1">
                          <input type="color" value={subOutlineColor}
                                 onChange={(e) => setSubOutlineColor(e.target.value)}
                                 className="h-7 w-10 rounded border cursor-pointer bg-transparent"
                                 disabled={isProcessing} />
                          <Input value={subOutlineColor}
                                 onChange={(e) => setSubOutlineColor(e.target.value)}
                                 className="h-7 text-[10px] flex-1 font-mono"
                                 disabled={isProcessing} />
                        </div>
                      </div>
                    </div>

                    {/* 描边粗细 */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] text-muted-foreground">描边粗细</Label>
                        <span className="text-[10px] text-muted-foreground">{subOutline}</span>
                      </div>
                      <Slider value={[subOutline]} onValueChange={([v]) => setSubOutline(v)}
                              min={0} max={6} step={1} disabled={isProcessing} />
                    </div>

                    {/* 加粗 + 位置 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] text-muted-foreground">加粗</Label>
                        <Switch checked={subBold} onCheckedChange={setSubBold} disabled={isProcessing} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">位置</Label>
                        <Select value={String(subAlignment)}
                                onValueChange={(v) => setSubAlignment(Number(v) as 2 | 8)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2" className="text-xs">底部居中</SelectItem>
                            <SelectItem value="8" className="text-xs">顶部居中</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* 距边距 */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] text-muted-foreground">距边距</Label>
                        <span className="text-[10px] text-muted-foreground">{subMarginV}px</span>
                      </div>
                      <Slider value={[subMarginV]} onValueChange={([v]) => setSubMarginV(v)}
                              min={10} max={200} step={5} disabled={isProcessing} />
                    </div>

                    {/* 预览条 */}
                    <div
                      className="rounded border bg-black py-6 flex items-center justify-center overflow-hidden"
                      style={{ fontFamily: subFontName || undefined }}
                    >
                      <span
                        style={{
                          color: subPrimaryColor,
                          WebkitTextStroke: subOutline > 0 ? `${Math.min(subOutline, 3)}px ${subOutlineColor}` : undefined,
                          fontSize: `${Math.min(subFontSize, 32)}px`,
                          fontWeight: subBold ? 700 : 400,
                        }}
                      >
                        示例字幕 Sample
                      </span>
                    </div>
                  </div>

                  <p className="text-[10px] text-muted-foreground pt-2 border-t leading-relaxed">
                    💡 选中右侧素材后，命令将仅作用于这些素材；未选中则使用全部已分析素材。
                  </p>
                </CardContent>
              </ScrollArea>
            </Card>
          </TabsContent>

          <TabsContent value="outputs" className="flex-1 min-h-0 mt-3">
            <Card className="h-full">
              <ScrollArea className="h-full">
                <CardContent className="pt-4 space-y-3">
                  {result ? (
                    result.phase === "review" ? (
                      /* ====== 审查结果视图 ====== */
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm">
                          <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />
                          <span className="truncate font-medium">{result.title}</span>
                        </div>

                        {/* 审查评分 */}
                        {result.review && (
                          <div className="p-3 rounded-md bg-amber-50/40 border border-amber-200/40 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium">审查评分</span>
                              <Badge variant={result.review.score >= 7 ? "default" : "destructive"} className="text-xs">
                                {result.review.score}/10 {result.review.score >= 7 ? "建议通过" : "建议修改"}
                              </Badge>
                            </div>
                            {result.review.scriptReview && (
                              <p className="text-xs text-muted-foreground">📝 {result.review.scriptReview}</p>
                            )}
                            {result.review.clipReview && (
                              <p className="text-xs text-muted-foreground">🎬 {result.review.clipReview}</p>
                            )}
                            {result.review.suggestions.length > 0 && (
                              <div className="space-y-0.5">
                                {result.review.suggestions.map((s, i) => (
                                  <p key={i} className="text-xs text-amber-700">💡 {s}</p>
                                ))}
                              </div>
                            )}
                            {result.review.riskWarnings && result.review.riskWarnings.length > 0 && (
                              <div className="space-y-0.5 pt-1 border-t">
                                {result.review.riskWarnings.map((w, i) => (
                                  <p key={i} className="text-xs text-red-600">⚠️ {w}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 脚本预览 */}
                        {result.script && (
                          <div className="space-y-1">
                            <Label className="text-[10px] text-muted-foreground">口播脚本</Label>
                            <div className="p-2 rounded bg-muted text-xs leading-relaxed max-h-32 overflow-auto whitespace-pre-wrap">
                              {result.script}
                            </div>
                          </div>
                        )}

                        {/* 片段列表 */}
                        {result.clips && result.clips.length > 0 && (
                          <div className="space-y-1">
                            <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Film className="h-3 w-3" />剪辑片段（{result.clips.length} 段）
                            </Label>
                            <div className="space-y-1 max-h-40 overflow-auto">
                              {result.clips.map((c, i) => (
                                <div key={i} className="p-2 rounded bg-muted/50 text-[10px]">
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium">片段{i + 1}</span>
                                    <span className="text-muted-foreground">
                                      {c.startTime.toFixed(1)}s-{c.endTime.toFixed(1)}s · {TRANSITION_LABELS[c.transition] || c.transition}
                                    </span>
                                  </div>
                                  <p className="text-muted-foreground mt-0.5 truncate">{c.narration}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <p className="text-xs text-muted-foreground">{result.message}</p>

                        {/* 确认 / 重新生成 */}
                        <div className="space-y-2 pt-2 border-t">
                          <Button
                            size="sm" className="w-full"
                            disabled={isProcessing}
                            onClick={() => {
                              if (!result.approvedPlanData) return;
                              setResult(null);
                              setCreatedTaskId(null);
                              handleSend(lastPromptRef.current, result.approvedPlanData);
                            }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />确认并执行剪辑
                          </Button>
                          <Button size="sm" variant="outline" className="w-full text-xs"
                                  onClick={() => handleSend(lastPromptRef.current)}
                                  disabled={isProcessing || !lastPromptRef.current}>
                            <RefreshCw className="h-3 w-3 mr-1" />修改需求重新生成
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* ====== 最终结果视图 ====== */
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-green-600">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span className="truncate font-medium">{result.title}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{result.explanation}</p>

                      {(result.aspect || result.voiceId || result.bgmMood) && (
                        <div className="flex flex-wrap gap-1 p-2 rounded-md bg-amber-50/40 border border-amber-200/40">
                          {result.aspect && <Badge variant="outline" className="text-[10px]">
                            {ASPECT_LABELS[result.aspect] || result.aspect}
                            {result.resolution && <span className="ml-1 opacity-60">{result.resolution}</span>}
                          </Badge>}
                          {result.voiceId && <Badge variant="outline" className="text-[10px]">
                            {result.voiceId.split(/[_-]/).slice(-1)[0]}
                            {typeof result.speed === "number" && <span className="ml-1 opacity-60">{result.speed.toFixed(1)}x</span>}
                          </Badge>}
                          {result.bgmMood && result.bgmMood !== "none" && (
                            <Badge variant={result.bgmApplied ? "secondary" : "outline"} className="text-[10px]">
                              BGM:{BGM_MOOD_LABELS[result.bgmMood] || result.bgmMood}
                            </Badge>
                          )}
                        </div>
                      )}

                      {result.transitions && result.transitions.length > 0 && (
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Film className="h-3 w-3" />转场（{result.transitions.length}）
                          </Label>
                          <div className="flex flex-wrap gap-1">
                            {result.transitions.slice(0, 8).map((t, i) => (
                              <Badge key={i} variant="secondary" className="text-[10px] font-normal">
                                {TRANSITION_LABELS[t.type] || t.type}
                                <span className="ml-1 opacity-60">{t.duration.toFixed(1)}s</span>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {result.fileSize != null && (
                        <p className="text-xs text-muted-foreground">{formatSize(result.fileSize)}</p>
                      )}

                      {result.outputPath && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="flex-1"
                                  onClick={() => setPlayer({
                                    open: true,
                                    src: `/api/files/stream?path=${encodeURIComponent(result.outputPath!)}`,
                                    title: result.title,
                                    isAudio: result.isAudio ?? false,
                                  })}>
                            <Play className="h-3.5 w-3.5 mr-1" />预览
                          </Button>
                          <Button size="sm" variant="outline"
                                  onClick={() => {
                                    const a = document.createElement("a");
                                    a.href = `/api/files/stream?path=${encodeURIComponent(result.outputPath!)}`;
                                    a.download = result.outputPath!.split(/[/\\]/).pop() || "output";
                                    a.click();
                                  }}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}

                      <Button size="sm" variant="ghost" className="w-full text-xs"
                              onClick={() => handleSend(lastPromptRef.current)}
                              disabled={isProcessing || !lastPromptRef.current}>
                        <RefreshCw className="h-3 w-3 mr-1" />重新生成
                      </Button>
                    </div>
                    )
                  ) : errorMsg ? (
                    <div className="space-y-2 py-8 text-center">
                      <AlertCircle className="h-8 w-8 mx-auto text-red-500" />
                      <p className="text-sm font-medium">出错了</p>
                      <p className="text-xs text-muted-foreground">{errorMsg}</p>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Wand2 className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">还没有产物</p>
                      <p className="text-xs mt-1">在左侧对话框输入指令开始创作</p>
                    </div>
                  )}
                </CardContent>
              </ScrollArea>
            </Card>
          </TabsContent>

          <TabsContent value="tasks" className="flex-1 min-h-0 mt-3">
            <Card className="h-full">
              <ScrollArea className="h-full">
                <div className="p-3 space-y-2">
                  {projectTasks.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted-foreground">
                      <Clock className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      暂无任务
                    </div>
                  ) : projectTasks.slice(0, 30).map((t) => (
                    <TaskRow key={t.id} task={t}
                             onPreview={(src, title, isAudio) =>
                               setPlayer({ open: true, src, title, isAudio })} />
                  ))}
                </div>
              </ScrollArea>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <VideoPlayer
        open={player.open}
        onClose={() => setPlayer({ open: false, src: "", title: "", isAudio: false })}
        title={player.title}
        src={player.src}
        poster={player.poster}
        isAudio={player.isAudio}
      />
    </div>
  );
}

// ===================== 子组件 =====================

function StatusBadge({ status, progress }: { status: string; progress?: number }) {
  const cfg: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    none:       { label: "未分析", cls: "bg-muted text-muted-foreground", icon: null },
    queued:     { label: "排队中", cls: "bg-yellow-100 text-yellow-700", icon: <Clock className="h-2.5 w-2.5" /> },
    processing: { label: `分析中 ${progress ?? 0}%`, cls: "bg-blue-100 text-blue-700", icon: <Loader2 className="h-2.5 w-2.5 animate-spin" /> },
    completed:  { label: "已完成", cls: "bg-green-100 text-green-700", icon: <CheckCircle2 className="h-2.5 w-2.5" /> },
    failed:     { label: "失败",   cls: "bg-red-100 text-red-700",     icon: <AlertCircle className="h-2.5 w-2.5" /> },
  };
  const c = cfg[status] || cfg.none;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${c.cls}`}>
      {c.icon}{c.label}
    </span>
  );
}

const TASK_TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  analysis:         { label: "分析",   icon: <Sparkles className="h-3 w-3" /> },
  ai_video_creator: { label: "AI 创作", icon: <Wand2 className="h-3 w-3" /> },
  ai_edit:          { label: "AI 剪辑", icon: <Scissors className="h-3 w-3" /> },
  editing:          { label: "剪辑",   icon: <Scissors className="h-3 w-3" /> },
  subtitle:         { label: "字幕",   icon: <Subtitles className="h-3 w-3" /> },
  tts:              { label: "配音",   icon: <Volume2 className="h-3 w-3" /> },
  combined:         { label: "组合",   icon: <Sparkles className="h-3 w-3" /> },
};

function TaskRow({ task, onPreview }: {
  task: any;
  onPreview: (src: string, title: string, isAudio: boolean) => void;
}) {
  const meta = TASK_TYPE_LABELS[task.taskType] || { label: task.taskType, icon: null };
  const result = task.result as Record<string, any> | null;
  const outputPath = result?.outputPath;
  const title = result?.title || task.parameters?.prompt?.slice(0, 30) || meta.label;
  const isAudio = !!outputPath && (outputPath.endsWith(".mp3") || outputPath.endsWith(".wav"));
  const time = task.completedAt ? formatTime(task.completedAt) : task.createdAt ? formatTime(task.createdAt) : "";

  return (
    <div className="flex items-start gap-2 p-2 rounded-md border bg-card hover:bg-muted/30">
      <div className="shrink-0 mt-0.5">{meta.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium truncate">#{task.id} {title}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <StatusBadge status={task.status} progress={task.progress} />
          <span className="text-[10px] text-muted-foreground">{meta.label}</span>
          {time && <span className="text-[10px] text-muted-foreground">{time}</span>}
        </div>
        {task.status === "processing" && typeof task.progress === "number" && (
          <Progress value={task.progress} className="h-1 mt-1" />
        )}
      </div>
      {outputPath && task.status === "completed" && (
        <div className="shrink-0 flex gap-1">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                  onClick={() => onPreview(`/api/files/stream?path=${encodeURIComponent(outputPath)}`, title, isAudio)}>
            <Play className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = `/api/files/stream?path=${encodeURIComponent(outputPath)}`;
                    a.download = outputPath.split(/[/\\]/).pop() || "output";
                    a.click();
                  }}>
            <Download className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

function SelectionBar({
  videos, selectedIds, analyzedIds, onRemove, onClear, onSelectAllAnalyzed,
}: {
  videos: any[];
  selectedIds: Set<number>;
  analyzedIds: number[];
  onRemove: (id: number) => void;
  onClear: () => void;
  onSelectAllAnalyzed: () => void;
}) {
  const selectedVideos = videos.filter((v) => selectedIds.has(v.id));

  if (selectedIds.size === 0) {
    // 没选中:展示提示 + 快捷全选按钮（如有已分析素材）
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed bg-muted/30 text-xs">
        <AtSign className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground flex-1 truncate">
          未选择素材 — <code className="text-foreground">/剪辑</code> <code className="text-foreground">/字幕</code> <code className="text-foreground">/配音</code> 将使用<strong className="text-foreground">全部已分析</strong>素材
        </span>
        {analyzedIds.length > 0 && (
          <Button
            size="sm" variant="ghost"
            className="h-6 text-[11px] shrink-0"
            onClick={onSelectAllAnalyzed}
          >
            <CheckSquare className="h-3 w-3 mr-1" />
            全选 {analyzedIds.length} 个已分析
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent/10 border border-accent/30">
      <span className="text-xs text-muted-foreground shrink-0">作用于</span>
      <span className="text-xs font-medium text-foreground shrink-0">{selectedIds.size} 个素材：</span>
      <div className="flex gap-1.5 flex-1 overflow-x-auto scrollbar-none">
        {selectedVideos.map((v) => (
          <div
            key={v.id}
            className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-background border shrink-0 group"
            title={v.originalName}
          >
            <img
              src={`/api/videos/thumbnail/${v.id}`}
              alt=""
              className="h-5 w-8 object-cover rounded-sm"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span className="text-[11px] max-w-[100px] truncate">{v.originalName}</span>
            <button
              onClick={() => onRemove(v.id)}
              className="text-muted-foreground hover:text-destructive"
              title="移除"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <Button
        size="sm" variant="ghost"
        className="h-6 text-[11px] shrink-0"
        onClick={onClear}
      >
        清空
      </Button>
    </div>
  );
}
