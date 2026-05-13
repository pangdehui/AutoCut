import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import VideoPlayer from "@/components/VideoPlayer";
import VoicePicker from "@/components/VoicePicker";
import {
  Sparkles, Loader2, Play, Download, CheckCircle2, AlertCircle, History, Clock, RefreshCw, Film, Trash2,
} from "lucide-react";

const TRANSITION_LABELS: Record<string, string> = {
  cut: "硬切",
  fade: "淡入",
  fadeblack: "黑场",
  fadewhite: "白场",
  dissolve: "叠化",
  slideleft: "左滑",
  slideright: "右滑",
  slideup: "上滑",
  slidedown: "下滑",
  wipeleft: "左擦",
  wiperight: "右擦",
  circleopen: "圆形展开",
  circleclose: "圆形闭合",
  zoomin: "推近",
};

const ASPECT_LABELS: Record<string, string> = {
  "16:9": "横屏 16:9",
  "9:16": "竖屏 9:16",
  "1:1": "方形 1:1",
};

const SUBTITLE_STYLE_LABELS: Record<string, string> = {
  default: "默认",
  bold_caption: "抖音大字",
  minimal: "极简",
  tiktok_yellow: "黄色加粗",
};

const BGM_MOOD_LABELS: Record<string, string> = {
  upbeat: "活力",
  calm: "舒缓",
  dramatic: "戏剧",
  warm: "温情",
  energetic: "动感",
  cinematic: "电影感",
  none: "无",
};

const SUGGESTED_PROMPTS = [
  "帮我做一个抖音风格的肉夹馍宣传短视频，要吸引人到店",
  "做一个抖音美食探店视频，突出诱人画面和口感描述",
  "生成一个产品推广抖音短视频，前3秒要抓眼球",
  "制作一个餐饮店铺引流短视频，结尾引导到店消费",
];

const WELCOME_MESSAGE = `你好！我是 AI 视频创作助手。

告诉我你想做什么样的视频，我会：
- 理解你的创作意图
- 从你的素材库中挑选合适的视频
- 撰写配音脚本并生成 AI 配音
- 自动剪辑合成最终视频

**试试下面的建议，或直接告诉我你的想法！**`;

const CHAT_STORAGE_KEY = "aimind_creator_chat";

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return [{ role: "assistant" as const, content: WELCOME_MESSAGE }];
}

function saveMessages(msgs: Message[]) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(msgs));
  } catch { /* ignore */ }
}

export default function AiCreatorPanel() {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [isProcessing, setIsProcessing] = useState(false);
  const [createdTaskId, setCreatedTaskId] = useState<number | null>(null);
  const [result, setResult] = useState<{
    outputPath: string;
    title: string;
    explanation: string;
    fileSize: number;
    isAudio: boolean;
    script?: string;
    transitions?: { type: string; duration: number }[];
    voiceId?: string;
    speed?: number;
    aspect?: string;
    resolution?: string;
    subtitleStyle?: string;
    bgmMood?: string;
    bgmApplied?: boolean;
    bgmFile?: string | null;
    autoMode?: boolean;
    autoReasoning?: string | null;
    srtPath?: string | null;
    srtContent?: string | null;
    noAudio?: boolean;
  } | null>(null);
  const [editedPrompt, setEditedPrompt] = useState("");
  const [editedScript, setEditedScript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState(true);
  const [voiceId, setVoiceId] = useState("female-tianmei");
  const [speed, setSpeed] = useState(1.0);
  const [noAudio, setNoAudio] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [burnSubtitles, setBurnSubtitles] = useState(false);
  // 重新生成时的微调覆盖（"" 表示沿用 AI 决策）
  const [regenAspect, setRegenAspect] = useState<string>("");
  const [regenBgmMood, setRegenBgmMood] = useState<string>("");
  const [regenVoiceId, setRegenVoiceId] = useState<string>("");
  const lastPromptRef = useRef("");

  const [player, setPlayer] = useState<{
    open: boolean; src: string; title: string; isAudio: boolean;
  }>({ open: false, src: "", title: "", isAudio: false });

  const createTaskMutation = trpc.tasks.create.useMutation();
  const taskQuery = trpc.tasks.getById.useQuery(
    { id: createdTaskId! },
    { enabled: !!createdTaskId, refetchInterval: 2000 }
  );
  const historyQuery = trpc.tasks.list.useQuery(
    { status: "completed" },
    { refetchInterval: 5000 }
  );

  // 消息变更时自动保存到 localStorage
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  const taskData = taskQuery.data?.data;
  const taskStatus = (taskData as any)?.status;
  const taskProgress = (taskData as any)?.progress ?? 0;
  const taskResult = (taskData as any)?.result;

  // 任务完成时更新结果
  useEffect(() => {
    if (taskStatus === "completed" && taskResult && !result && isProcessing) {
      const outputPath = taskResult.outputPath;
      const isAudio = outputPath?.endsWith(".mp3") || outputPath?.endsWith(".wav");
      const script = taskResult.script || "";
      setResult({
        outputPath,
        title: taskResult.title || "AI 创作视频",
        explanation: taskResult.explanation || taskResult.message || "创作完成",
        fileSize: taskResult.fileSize || 0,
        isAudio,
        script,
        transitions: Array.isArray(taskResult.transitions) ? taskResult.transitions : undefined,
        voiceId: taskResult.voiceId,
        speed: typeof taskResult.speed === "number" ? taskResult.speed : undefined,
        aspect: taskResult.aspect,
        resolution: taskResult.resolution,
        subtitleStyle: taskResult.subtitleStyle,
        bgmMood: taskResult.bgmMood,
        bgmApplied: !!taskResult.bgmApplied,
        bgmFile: taskResult.bgmFile ?? null,
        autoMode: !!taskResult.autoMode,
        autoReasoning: taskResult.autoReasoning ?? null,
        srtPath: taskResult.srtPath ?? null,
        srtContent: taskResult.srtContent ?? null,
        noAudio: !!taskResult.noAudio,
      });
      setEditedPrompt(lastPromptRef.current);
      setEditedScript(script);
      setIsProcessing(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `视频创作完成！\n\n**${taskResult.title || "作品"}**\n${taskResult.explanation || ""}\n\n你可以在下方预览和下载。`,
        },
      ]);
    }
  }, [taskStatus, taskResult, result, isProcessing]);

  // 任务失败时更新
  useEffect(() => {
    if (taskStatus === "failed" && isProcessing) {
      const errMsg = (taskData as any)?.errorMessage || "创作失败";
      setError(errMsg);
      setIsProcessing(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `抱歉，创作过程出现问题：${errMsg}\n\n请检查你的素材库是否有已分析的视频，然后重试。` },
      ]);
    }
  }, [taskStatus, isProcessing, taskData]);

  const handleSendMessage = useCallback(
    async (
      content: string,
      overrides?: { aspect?: string; bgmMood?: string; voiceId?: string },
    ) => {
      setError(null);
      setResult(null);
      setCreatedTaskId(null);

      const userMsg: Message = { role: "user", content };
      lastPromptRef.current = content;
      setMessages((prev) => [...prev, userMsg]);
      setIsProcessing(true);

      try {
        const baseParams: Record<string, unknown> = {
          prompt: content,
          autoMode,
          // 仅在手动模式下才把用户的覆盖值传过去；自动模式下让 LLM 全权决定
          ...(autoMode
            ? {}
            : {
                voiceId,
                speed,
                noAudio,
                ...(showSubtitles
                  ? { subtitles: { enabled: true, burnIn: burnSubtitles } }
                  : { subtitles: { enabled: false, burnIn: false } }),
              }),
        };
        // 微调覆盖：永远生效，优先级高于 Phase 0 / 手动模式
        if (overrides?.aspect)   baseParams.aspect   = overrides.aspect;
        if (overrides?.bgmMood)  baseParams.bgmMood  = overrides.bgmMood;
        if (overrides?.voiceId)  baseParams.voiceId  = overrides.voiceId;

        const res = await createTaskMutation.mutateAsync({
          videoId: 0,
          taskType: "ai_video_creator",
          parameters: baseParams,
        });

        if (!res.success || !res.data) {
          setError(res.message || "创建任务失败");
          setIsProcessing(false);
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `创建任务失败：${res.message || "未知错误"}` },
          ]);
          return;
        }

        setCreatedTaskId(res.data.id);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `已收到你的需求！正在为你创作视频...\n\n当前进度：0%`,
          },
        ]);
      } catch (e: any) {
        setError(e?.message || "请求失败");
        setIsProcessing(false);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `请求异常：${e?.message || "网络错误"}` },
        ]);
      }
    },
    [createTaskMutation, autoMode, voiceId, speed, noAudio, showSubtitles, burnSubtitles]
  );

  // 更新进度消息
  const lastProgressRef = useRef(-1);
  useEffect(() => {
    if (isProcessing && taskProgress > lastProgressRef.current) {
      lastProgressRef.current = taskProgress;
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === "assistant" && last.content.includes("当前进度")) {
          updated[updated.length - 1] = {
            ...last,
            content: `已收到你的需求！正在为你创作视频...\n\n${getProgressMessage(taskProgress)}`,
          };
        }
        return updated;
      });
    }
    if (!isProcessing) {
      lastProgressRef.current = -1;
    }
  }, [isProcessing, taskProgress]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-amber-500" />
          AI 视频创作
        </h2>
        <p className="text-muted-foreground text-sm">
          用自然语言描述你的需求，AI 自动完成选素材 → 写脚本 → 配音 → 剪辑
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <div className="flex items-center justify-end mb-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                disabled={isProcessing}
                onClick={() => {
                  const welcome = { role: "assistant" as const, content: WELCOME_MESSAGE };
                  setMessages([welcome]);
                  saveMessages([welcome]);
                }}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                清空对话
              </Button>
            </div>
            <AIChatBox
              messages={messages}
              onSendMessage={handleSendMessage}
              isLoading={isProcessing}
              placeholder="描述你想做什么样的视频..."
              height={520}
              suggestedPrompts={SUGGESTED_PROMPTS}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span>创作参数</span>
              <Badge variant={autoMode ? "default" : "outline"} className="text-[10px]">
                {autoMode ? "AI 自动" : "手动覆盖"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* AI 自动模式开关 */}
            <div className="flex items-start justify-between gap-3 p-3 rounded-md bg-amber-50 border border-amber-200/50">
              <div className="flex-1">
                <Label className="text-xs font-medium">AI 自动模式</Label>
                <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                  {autoMode
                    ? "由 AI 决定音色、语速、画幅、分辨率、字幕样式、BGM 等全部参数"
                    : "你手动设置以下参数，AI 不会再自动决策"}
                </p>
              </div>
              <Switch
                checked={autoMode}
                onCheckedChange={setAutoMode}
                disabled={isProcessing}
              />
            </div>

            {/* 手动模式下显示详细设置 */}
            {!autoMode && (
              <>
                {/* 音色选择 */}
                <div className="space-y-2">
                  <Label className="text-xs">配音音色</Label>
                  <VoicePicker value={voiceId} onChange={setVoiceId} disabled={isProcessing} />
                </div>

                {/* 语速 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">语速</Label>
                    <span className="text-xs text-muted-foreground">{speed.toFixed(1)}x</span>
                  </div>
                  <Slider
                    value={[speed]}
                    onValueChange={([v]) => setSpeed(v)}
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    disabled={isProcessing}
                  />
                </div>

                {/* 无音频模式 */}
                <div className="space-y-3 pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs">无音频（仅字幕）</Label>
                      <p className="text-[10px] text-muted-foreground">跳过配音，只生成字幕</p>
                    </div>
                    <Switch
                      checked={noAudio}
                      onCheckedChange={(v) => {
                        setNoAudio(v);
                        if (v) {
                          setShowSubtitles(true);
                          setBurnSubtitles(true);
                        }
                      }}
                      disabled={isProcessing}
                    />
                  </div>
                </div>

                {/* 字幕 */}
                <div className="space-y-3 pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">生成字幕</Label>
                    <Switch
                      checked={showSubtitles}
                      onCheckedChange={setShowSubtitles}
                      disabled={isProcessing}
                    />
                  </div>
                  {showSubtitles && (
                    <div className="flex items-center justify-between pl-2">
                      <Label className="text-xs text-muted-foreground">烧录到视频</Label>
                      <Switch
                        checked={burnSubtitles}
                        onCheckedChange={setBurnSubtitles}
                        disabled={isProcessing}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">创作状态</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isProcessing ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                  <span>AI 正在创作中...</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-500"
                    style={{ width: `${taskProgress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {getProgressMessage(taskProgress)}
                </p>
              </div>
            ) : result ? (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span className="truncate">{result.title}</span>
                </div>

                {/* 生成的脚本 */}
                {editedScript && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">生成的口播文案（可编辑）</Label>
                    <Textarea
                      className="text-xs min-h-[80px] resize-y"
                      value={editedScript}
                      onChange={(e) => setEditedScript(e.target.value)}
                      disabled={isProcessing}
                    />
                  </div>
                )}

                {/* 可编辑的需求描述 */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">需求描述（可修改后重新生成）</Label>
                  <Textarea
                    className="text-xs min-h-[50px] resize-y"
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
                    disabled={isProcessing}
                    placeholder="修改你的需求描述..."
                  />
                </div>

                {/* AI 决策卡片：展示 LLM/管线最终采用的参数 */}
                {(result.aspect || result.voiceId || result.bgmMood) && (
                  <div className="space-y-1.5 p-2.5 rounded-md bg-amber-50/40 border border-amber-200/40">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-amber-500" />
                      AI 决策
                    </Label>
                    <div className="flex flex-wrap gap-1">
                      {result.aspect && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {ASPECT_LABELS[result.aspect] || result.aspect}
                          {result.resolution && (
                            <span className="ml-1 opacity-60">{result.resolution}</span>
                          )}
                        </Badge>
                      )}
                      {result.voiceId && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          音色：{result.voiceId.split(/[_-]/).slice(-1)[0]}
                          {typeof result.speed === "number" && (
                            <span className="ml-1 opacity-60">{result.speed.toFixed(1)}x</span>
                          )}
                        </Badge>
                      )}
                      {result.subtitleStyle && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          字幕：{SUBTITLE_STYLE_LABELS[result.subtitleStyle] || result.subtitleStyle}
                        </Badge>
                      )}
                      {result.bgmMood && result.bgmMood !== "none" && (
                        <Badge
                          variant={result.bgmApplied ? "secondary" : "outline"}
                          className="text-[10px] font-normal"
                        >
                          BGM：{BGM_MOOD_LABELS[result.bgmMood] || result.bgmMood}
                          {!result.bgmApplied && (
                            <span className="ml-1 opacity-60">(无素材)</span>
                          )}
                        </Badge>
                      )}
                    </div>
                    {result.autoReasoning && (
                      <p className="text-[10px] text-muted-foreground leading-snug pt-1">
                        {result.autoReasoning}
                      </p>
                    )}
                  </div>
                )}

                {/* AI 选择的转场序列 */}
                {result.transitions && result.transitions.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Film className="h-3 w-3" />
                      AI 编排的转场（{result.transitions.length} 个）
                    </Label>
                    <div className="flex flex-wrap gap-1">
                      {result.transitions.map((t, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px] font-normal">
                          {TRANSITION_LABELS[t.type] || t.type}
                          <span className="ml-1 opacity-60">{t.duration.toFixed(1)}s</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  文件大小：{formatSize(result.fileSize)}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setPlayer({
                        open: true,
                        src: `/api/files/stream?path=${encodeURIComponent(result.outputPath)}`,
                        title: result.title,
                        isAudio: result.isAudio,
                      });
                    }}
                  >
                    <Play className="h-3.5 w-3.5 mr-1" />
                    预览
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = `/api/files/stream?path=${encodeURIComponent(result.outputPath)}`;
                      a.download = result.outputPath.split(/[/\\]/).pop() || "output";
                      a.click();
                    }}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {/* SRT 字幕下载：仅在未烧录但有字幕文件时显示 */}
                {result.srtContent && (
                  <div className="pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-xs"
                      onClick={() => {
                        const blob = new Blob([result.srtContent!], { type: "text/plain;charset=utf-8" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `subtitle_${result.title || "output"}.srt`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="h-3.5 w-3.5 mr-1" />
                      下载字幕文件 (.srt)
                    </Button>
                  </div>
                )}
                {/* 重新生成微调：换 BGM / 音色 / 比例 */}
                <div className="space-y-2 pt-2 border-t">
                  <Label className="text-xs text-muted-foreground">
                    重新生成微调（留空＝沿用 AI 决策）
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={regenAspect || "_auto"} onValueChange={(v) => setRegenAspect(v === "_auto" ? "" : v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="画幅" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_auto" className="text-xs">画幅：AI 决定</SelectItem>
                        <SelectItem value="9:16" className="text-xs">竖屏 9:16</SelectItem>
                        <SelectItem value="16:9" className="text-xs">横屏 16:9</SelectItem>
                        <SelectItem value="1:1"  className="text-xs">方形 1:1</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={regenBgmMood || "_auto"} onValueChange={(v) => setRegenBgmMood(v === "_auto" ? "" : v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="BGM" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_auto"     className="text-xs">BGM：AI 决定</SelectItem>
                        <SelectItem value="upbeat"    className="text-xs">活力</SelectItem>
                        <SelectItem value="calm"      className="text-xs">舒缓</SelectItem>
                        <SelectItem value="dramatic"  className="text-xs">戏剧</SelectItem>
                        <SelectItem value="warm"      className="text-xs">温情</SelectItem>
                        <SelectItem value="energetic" className="text-xs">动感</SelectItem>
                        <SelectItem value="cinematic" className="text-xs">电影感</SelectItem>
                        <SelectItem value="none"      className="text-xs">无 BGM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground mb-1 block">换音色</Label>
                    <VoicePicker
                      value={regenVoiceId}
                      onChange={setRegenVoiceId}
                      placeholder="音色：AI 决定"
                      disabled={isProcessing}
                    />
                    {regenVoiceId && (
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-foreground mt-1"
                        onClick={() => setRegenVoiceId("")}
                      >
                        清空 → 让 AI 决定
                      </button>
                    )}
                  </div>
                </div>

                <Button
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    handleSendMessage(editedPrompt, {
                      aspect: regenAspect || undefined,
                      bgmMood: regenBgmMood || undefined,
                      voiceId: regenVoiceId || undefined,
                    })
                  }
                  disabled={isProcessing || !editedPrompt.trim()}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  重新生成
                </Button>
              </div>
            ) : error ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-red-500">
                  <AlertCircle className="h-4 w-4" />
                  <span>出错了</span>
                </div>
                <p className="text-xs text-muted-foreground">{error}</p>
              </div>
            ) : (
              <div className="text-center py-8">
                <Sparkles className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">等待创作指令...</p>
                <p className="text-xs text-muted-foreground mt-1">
                  在左侧输入你想要的视频描述
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 历史记录 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            创作历史
          </CardTitle>
        </CardHeader>
        <CardContent>
          <HistoryList
            tasks={(historyQuery.data?.data || []).filter((t: any) => t.taskType === "ai_video_creator")}
            isLoading={historyQuery.isLoading}
            onPreview={(src, title, isAudio) => setPlayer({ open: true, src, title, isAudio })}
          />
        </CardContent>
      </Card>

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

function HistoryList({ tasks, isLoading, onPreview }: {
  tasks: any[];
  isLoading: boolean;
  onPreview: (src: string, title: string, isAudio: boolean) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="text-center py-4">
        <Clock className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
        <p className="text-xs text-muted-foreground">暂无创作记录</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {tasks.slice(0, 20).map((task: any) => {
        const result = task.result as Record<string, any> | null;
        const outputPath = result?.outputPath;
        const title = result?.title || task.parameters?.prompt?.slice(0, 30) || "AI 创作";
        const isAudio = outputPath?.endsWith(".mp3") || outputPath?.endsWith(".wav");
        const time = task.completedAt
          ? new Date(task.completedAt).toLocaleString("zh-CN")
          : "";

        return (
          <div
            key={task.id}
            className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">#{task.id} {title}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{time}</span>
                {result && result.fileSize > 0 && <span>{formatSize(result.fileSize)}</span>}
              </div>
            </div>
            {outputPath && (
              <div className="flex gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() =>
                    onPreview(
                      `/api/files/stream?path=${encodeURIComponent(outputPath)}`,
                      title,
                      isAudio,
                    )
                  }
                >
                  <Play className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = `/api/files/stream?path=${encodeURIComponent(outputPath)}`;
                    a.download = outputPath.split(/[/\\]/).pop() || "output";
                    a.click();
                  }}
                >
                  <Download className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getProgressMessage(progress: number): string {
  if (progress < 10) return `正在分析需求... (${progress}%)`;
  if (progress < 25) return `正在理解意图并选择素材... (${progress}%)`;
  if (progress < 40) return `正在撰写配音脚本和剪辑计划... (${progress}%)`;
  if (progress < 60) return `正在生成 AI 配音... (${progress}%)`;
  if (progress < 95) return `正在剪辑和合成视频... (${progress}%)`;
  return `正在完成最后的处理... (${progress}%)`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}
