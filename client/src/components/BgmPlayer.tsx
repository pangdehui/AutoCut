import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Music } from "lucide-react";

const MOOD_LABELS: Record<string, string> = {
  upbeat: "欢快",
  calm: "舒缓",
  dramatic: "戏剧感",
  warm: "温暖",
  energetic: "活力",
  cinematic: "电影感",
  other: "其他",
};

const MOOD_COLORS: Record<string, string> = {
  upbeat: "bg-amber-100 text-amber-700",
  calm: "bg-blue-100 text-blue-700",
  dramatic: "bg-purple-100 text-purple-700",
  warm: "bg-orange-100 text-orange-700",
  energetic: "bg-red-100 text-red-700",
  cinematic: "bg-slate-200 text-slate-700",
  other: "bg-gray-100 text-gray-600",
};

export default function BgmPlayer() {
  const { data, isLoading } = trpc.bgm.list.useQuery();
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const grouped = useCallback(() => {
    if (!data?.data) return {};
    const map: Record<string, typeof data.data> = {};
    for (const f of data.data) {
      (map[f.mood] ??= []).push(f);
    }
    return map;
  }, [data]);

  const handlePlay = (path: string) => {
    if (playing === path) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const a = new Audio(`/api/files/stream?path=${encodeURIComponent(path)}`);
    a.onended = () => setPlaying(null);
    a.play();
    audioRef.current = a;
    setPlaying(path);
  };

  if (isLoading) return <p className="text-xs text-muted-foreground">加载中...</p>;

  const groups = grouped();
  const moods = Object.keys(groups);
  if (moods.length === 0) {
    return <p className="text-xs text-muted-foreground">还没有 BGM 素材</p>;
  }

  return (
    <div className="space-y-2">
      {moods.map((mood) => (
        <div key={mood}>
          <Badge variant="secondary" className={`text-[10px] mb-1 ${moods.length > 1 ? "" : "hidden"}`}>
            {MOOD_LABELS[mood] || mood}
          </Badge>
          <div className="space-y-0.5">
            {groups[mood].map((f) => (
              <div key={f.path} className="flex items-center gap-1.5 py-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={() => handlePlay(f.path)}
                >
                  {playing === f.path
                    ? <Pause className="h-3.5 w-3.5 text-accent" />
                    : <Play className="h-3.5 w-3.5" />}
                </Button>
                <span className="text-xs truncate flex-1" title={f.name}>{f.name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
