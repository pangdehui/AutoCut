import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Loader2, FileText, Download } from "lucide-react";

const LANG_NAMES: Record<string, string> = {
  zh: "中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  pt: "Português",
  ru: "Русский",
};

function downloadSrt(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SubtitleViewer({ taskId }: { taskId: number }) {
  const [activeLang, setActiveLang] = useState<string>("zh");
  const { data, isLoading } = trpc.subtitles.byTaskId.useQuery({ taskId });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const subs = data?.data || [];
  const current = subs.find((s) => s.language === activeLang) || subs[0];

  if (subs.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">字幕尚未生成</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 语言切换 */}
      <div className="flex gap-2 flex-wrap">
        {subs.map((s) => (
          <Button
            key={s.language}
            variant={activeLang === s.language ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveLang(s.language)}
          >
            {LANG_NAMES[s.language] || s.language}
          </Button>
        ))}
      </div>

      {/* 字幕内容 */}
      {current && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {LANG_NAMES[current.language] || current.language} 字幕
            </span>
            {current.content && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadSrt(
                    current.content!,
                    `subtitle_${taskId}_${current.language}.srt`
                  )
                }
              >
                <Download className="h-3 w-3 mr-1" />
                下载 SRT
              </Button>
            )}
          </div>
          <div className="bg-muted/30 rounded-lg p-4 max-h-64 overflow-y-auto">
            <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
              {current.content || "（无内容）"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
