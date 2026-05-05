import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Loader2, Film, Tag, Star, FileText, FolderOpen } from "lucide-react";

export default function AnalysisViewer({ taskId }: { taskId: number }) {
  const { data, isLoading } = trpc.analysis.byTaskId.useQuery({ taskId });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.success || !data.data) {
    return (
      <div className="text-center py-12">
        <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">分析结果尚未生成</p>
      </div>
    );
  }

  const result = data.data as Record<string, any>;
  const scenes = (result.sceneDescriptions || []) as any[];
  const keywords = (result.keywords || []) as string[];
  const highlights = (result.highlights || []) as any[];
  const metadata = (result.metadata || {}) as Record<string, any>;
  const summary = metadata.summary as string;
  const category = metadata.category as string;

  return (
    <div className="space-y-6">
      {/* 概述 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-accent" />
            分析概览
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {category && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">分类：</span>
              <Badge variant="secondary">{category}</Badge>
            </div>
          )}
          {summary && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">总结：</p>
              <p className="text-sm">{summary}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 关键词 */}
      {keywords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-accent" />
              关键词
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {keywords.map((kw, i) => (
                <Badge key={i} variant="outline" className="text-sm">
                  {kw}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 场景描述 */}
      {scenes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Film className="h-5 w-5 text-accent" />
              场景分析
            </CardTitle>
            <CardDescription>共识别 {scenes.length} 个场景</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {scenes.map((scene, i) => (
                <div key={i} className="flex gap-4 p-3 rounded-lg border">
                  <div className="text-accent font-mono text-sm shrink-0 pt-0.5">
                    {scene.timestamp || `场景 ${i + 1}`}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{scene.description}</p>
                    {scene.tags && scene.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {scene.tags.map((t: string, j: number) => (
                          <Badge key={j} variant="secondary" className="text-xs">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 精彩片段 */}
      {highlights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" />
              精彩片段
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {highlights.map((hl, i) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-lg border">
                  <div className="flex items-center gap-1 shrink-0">
                    <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                    <span className="text-sm font-bold">{hl.score || "-"}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{hl.description}</p>
                  </div>
                  <div className="text-accent font-mono text-sm shrink-0">
                    {hl.timestamp || ""}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
