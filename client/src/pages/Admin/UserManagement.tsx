import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Search, ShieldCheck, ShieldOff, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";

export default function UserManagement() {
  const [search, setSearch] = useState("");
  const usersQuery = trpc.admin.listUsers.useQuery();
  const setActiveMutation = trpc.admin.setUserActive.useMutation({
    onSuccess: () => usersQuery.refetch(),
  });
  const setRoleMutation = trpc.admin.setUserRole.useMutation({
    onSuccess: () => usersQuery.refetch(),
  });

  const users = usersQuery.data?.data ?? [];
  const filtered = users.filter(
    u =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const handleToggleActive = (userId: number, current: boolean) => {
    setActiveMutation.mutate(
      { userId, isActive: !current },
      { onSuccess: () => toast.success(!current ? "已启用用户" : "已禁用用户") }
    );
  };

  const handleToggleRole = (userId: number, current: string) => {
    const newRole = current === "admin" ? "user" : "admin";
    setRoleMutation.mutate(
      { userId, role: newRole },
      { onSuccess: () => toast.success(`已将用户设为 ${newRole === "admin" ? "管理员" : "普通用户"}`) }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索用户名或邮箱..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className="text-sm text-muted-foreground">共 {filtered.length} 位用户</span>
      </div>

      {usersQuery.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">用户</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">角色</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">状态</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">积分余额</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">注册时间</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">最后登录</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium">{u.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                      {u.role === "admin" ? "管理员" : "普通用户"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={u.isActive ? "outline" : "destructive"}>
                      {u.isActive ? "正常" : "已禁用"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {u.balance ?? 0}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString("zh-CN") : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString("zh-CN") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        title={u.role === "admin" ? "降为普通用户" : "提升为管理员"}
                        onClick={() => handleToggleRole(u.id, u.role)}
                        disabled={setRoleMutation.isPending}
                      >
                        {u.role === "admin" ? (
                          <ShieldOff className="h-3.5 w-3.5" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        title={u.isActive ? "禁用用户" : "启用用户"}
                        onClick={() => handleToggleActive(u.id, u.isActive)}
                        disabled={setActiveMutation.isPending}
                      >
                        {u.isActive ? (
                          <UserX className="h-3.5 w-3.5 text-destructive" />
                        ) : (
                          <UserCheck className="h-3.5 w-3.5 text-green-500" />
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    暂无用户数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
