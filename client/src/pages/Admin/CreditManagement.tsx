import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Minus, Search } from "lucide-react";
import { toast } from "sonner";

export default function CreditManagement() {
  const [search, setSearch] = useState("");
  const [rechargeUserId, setRechargeUserId] = useState<number | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState("");
  const [rechargeDesc, setRechargeDesc] = useState("");
  const [deductUserId, setDeductUserId] = useState<number | null>(null);
  const [deductAmount, setDeductAmount] = useState("");
  const [deductDesc, setDeductDesc] = useState("");

  const usersQuery = trpc.admin.listUsers.useQuery();
  const txQuery = trpc.admin.creditTransactions.useQuery({ userId: undefined });
  const rechargeMutation = trpc.credits.recharge.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success("充值成功");
        setRechargeUserId(null);
        setRechargeAmount("");
        setRechargeDesc("");
        usersQuery.refetch();
        txQuery.refetch();
      } else {
        toast.error((res as any).message ?? "充值失败");
      }
    },
  });
  const deductMutation = trpc.credits.deduct.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success("扣除成功");
        setDeductUserId(null);
        setDeductAmount("");
        setDeductDesc("");
        usersQuery.refetch();
        txQuery.refetch();
      } else {
        toast.error((res as any).message ?? "扣除失败");
      }
    },
  });

  const users = usersQuery.data?.data ?? [];
  const transactions = txQuery.data?.data ?? [];

  const filteredUsers = users.filter(
    u =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const typeLabel: Record<string, string> = {
    analysis: "AI分析",
    editing: "视频剪辑",
    subtitle: "字幕生成",
    admin_recharge: "管理员充值",
    admin_deduction: "管理员扣除",
  };

  return (
    <div className="space-y-8">
      {/* 用户积分概览 */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索用户..."
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {usersQuery.isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">用户</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">当前余额</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">累计获得</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">累计消耗</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map(u => (
                  <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-accent">
                      {u.balance ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-green-600">
                      +{u.totalEarned ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-red-500">
                      -{u.totalUsed ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs text-green-600 border-green-300 hover:bg-green-50"
                          onClick={() => { setRechargeUserId(u.id); setDeductUserId(null); }}
                        >
                          <Plus className="h-3 w-3" /> 充值
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs text-red-500 border-red-300 hover:bg-red-50"
                          onClick={() => { setDeductUserId(u.id); setRechargeUserId(null); }}
                        >
                          <Minus className="h-3 w-3" /> 扣除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      暂无用户数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 充值弹出行 */}
      {rechargeUserId !== null && (
        <Card className="border-green-200 bg-green-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-green-700">
              充值积分 — {users.find(u => u.id === rechargeUserId)?.email}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                placeholder="充值数量"
                className="w-36"
                value={rechargeAmount}
                onChange={e => setRechargeAmount(e.target.value)}
              />
              <Input
                placeholder="备注（可选）"
                className="flex-1"
                value={rechargeDesc}
                onChange={e => setRechargeDesc(e.target.value)}
              />
              <Button
                className="bg-green-600 hover:bg-green-700"
                disabled={!rechargeAmount || rechargeMutation.isPending}
                onClick={() =>
                  rechargeMutation.mutate({
                    userId: rechargeUserId,
                    amount: Number(rechargeAmount),
                    description: rechargeDesc || undefined,
                  })
                }
              >
                {rechargeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "确认充值"}
              </Button>
              <Button variant="ghost" onClick={() => setRechargeUserId(null)}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 扣除弹出行 */}
      {deductUserId !== null && (
        <Card className="border-red-200 bg-red-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-red-600">
              扣除积分 — {users.find(u => u.id === deductUserId)?.email}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                placeholder="扣除数量"
                className="w-36"
                value={deductAmount}
                onChange={e => setDeductAmount(e.target.value)}
              />
              <Input
                placeholder="备注（可选）"
                className="flex-1"
                value={deductDesc}
                onChange={e => setDeductDesc(e.target.value)}
              />
              <Button
                variant="destructive"
                disabled={!deductAmount || deductMutation.isPending}
                onClick={() =>
                  deductMutation.mutate({
                    userId: deductUserId,
                    amount: Number(deductAmount),
                    description: deductDesc || undefined,
                  })
                }
              >
                {deductMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "确认扣除"}
              </Button>
              <Button variant="ghost" onClick={() => setDeductUserId(null)}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 积分流水记录 */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold">最近积分流水</h3>
        {txQuery.isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">用户</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">类型</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">金额</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">备注</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transactions.map(tx => (
                  <tr key={tx.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-xs">{tx.userName || "—"}</div>
                      <div className="text-xs text-muted-foreground">{tx.userEmail}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="text-xs">
                        {typeLabel[tx.type] ?? tx.type}
                      </Badge>
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono font-semibold ${tx.amount > 0 ? "text-green-600" : "text-red-500"}`}>
                      {tx.amount > 0 ? "+" : ""}{tx.amount}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">{tx.description || "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {new Date(tx.createdAt).toLocaleString("zh-CN")}
                    </td>
                  </tr>
                ))}
                {transactions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      暂无流水记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
