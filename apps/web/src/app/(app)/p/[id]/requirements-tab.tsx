"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ChevronRight, ChevronDown, Split, Check, X, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { callTool } from "@/lib/ui-api";
import { REQ_STATUS_LABEL } from "@/lib/labels";
import { relTime } from "@/lib/utils";
import { toast } from "sonner";

export type Req = {
  id: string; code: string; title: string; detailMd: string; source: string; priority: string; status: string;
  milestoneId: string | null; closeReason: string; closeConfirmed: number; createdAt: number; createdBy: string;
  items: Array<{ id: string; title: string; status: string }>; stat: { total: number; open: number; done: number }; untriaged: boolean;
};
type Ms = { id: string; name: string };

const TONE: Record<string, "default" | "brand" | "ok" | "warn" | "danger"> = { proposed: "default", accepted: "brand", in_progress: "brand", done: "ok", dropped: "default" };

export function RequirementsTab({ projectId, reqs, milestones }: { projectId: string; reqs: Req[]; milestones: Ms[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"open" | "all" | "closed">("open");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", detail_md: "", source: "", priority: "P1", milestone: "" });
  const [splitFor, setSplitFor] = useState<Req | null>(null);
  const [splitText, setSplitText] = useState("");
  const [dropFor, setDropFor] = useState<Req | null>(null);
  const [dropReason, setDropReason] = useState("");

  const shown = useMemo(() => reqs.filter((r) => filter === "all" ? true : filter === "open" ? !["done", "dropped"].includes(r.status) : ["done", "dropped"].includes(r.status)), [reqs, filter]);
  const unconfirmed = reqs.filter((r) => r.status === "dropped" && r.closeConfirmed === 0);

  async function save(body: Record<string, unknown>, ok: string) {
    const r = await callTool("requirement_save", { project: projectId, ...body });
    if (!r.ok) { toast.error(r.error ?? "失败"); return false; }
    toast.success(ok); router.refresh(); return true;
  }
  async function add() {
    if (!form.title.trim()) return toast.error("写一句需求");
    if (await save({ title: form.title.trim(), detail_md: form.detail_md, source: form.source || "自己", priority: form.priority, milestone: form.milestone || undefined, status: "accepted" }, "需求已记录")) {
      setForm({ title: "", detail_md: "", source: "", priority: "P1", milestone: "" }); setAdding(false);
    }
  }
  async function split() {
    if (!splitFor) return;
    const lines = splitText.split("\n").map((l) => l.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean);
    if (!lines.length) return toast.error("每行一个事项");
    const r = await callTool("checklist_add", { project: projectId, items: lines.map((t) => ({ title: t, kind: "feature", requirement: splitFor.code, milestone: milestones.find((m) => m.id === splitFor.milestoneId)?.name })) });
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success(`已拆出 ${lines.length} 个事项`); setSplitFor(null); setSplitText(""); router.refresh();
  }
  async function drop() {
    if (!dropFor) return;
    if (dropReason.trim().length < 4) return toast.error("写明为什么不做");
    if (await save({ id: dropFor.id, status: "dropped", close_reason: dropReason.trim() }, "已放弃，原因已留档")) { setDropFor(null); setDropReason(""); }
  }
  async function confirm(r: Req, accept: boolean) {
    const res = await fetch("/api/ui/board", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm_drop", id: r.id, accept }) }).then((x) => x.json());
    if (!res.ok) return toast.error(res.error ?? "失败");
    toast.success(accept ? "已确认放弃" : "已驳回，需求恢复为确认要做"); router.refresh();
  }

  return (
    <div>
      <p className="mb-3 text-[13px] text-[var(--color-muted)]">需求是「要做成什么」，事项是「具体去做什么」。每条需求最后只能是<b>已完成</b>（关联事项全部完成，自动关闭）或<b>已放弃</b>（必须写原因）——提了就要有着落。</p>

      {unconfirmed.length > 0 && (
        <div className="mb-3 rounded-xl border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><AlertTriangle className="size-4" />agent 提议放弃 {unconfirmed.length} 条需求，等你确认</p>
          {unconfirmed.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 py-1 text-[13px]">
              <span className="font-mono text-[12px] text-[var(--color-muted)]">{r.code}</span><span>{r.title}</span>
              <span className="text-[12px] text-[var(--color-muted)]">理由：{r.closeReason}</span>
              <span className="ml-auto flex gap-1"><Button size="sm" variant="ghost" onClick={() => confirm(r, true)}><Check /> 同意放弃</Button><Button size="sm" variant="outline" onClick={() => confirm(r, false)}><X /> 继续做</Button></span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg bg-[var(--color-line)]/40 p-0.5 text-xs">
          {([["open", "未关闭"], ["all", "全部"], ["closed", "已关闭"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 ${filter === k ? "bg-[var(--color-card)] font-medium shadow-sm" : "text-[var(--color-muted)]"}`}>{l}</button>
          ))}
        </div>
        <Button size="sm" onClick={() => setAdding(true)}><Plus /> 记需求</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]">
        {shown.length === 0 && <p className="p-8 text-center text-sm text-[var(--color-muted)]">{filter === "open" ? "没有未关闭的需求。" : "暂无。"}</p>}
        {shown.map((r) => {
          const isOpen = open[r.id];
          const pct = r.stat.total ? Math.round((r.stat.done / r.stat.total) * 100) : 0;
          return (
            <div key={r.id} className="border-b border-[var(--color-line)] last:border-0">
              <div className="flex items-start gap-2 p-3">
                <button onClick={() => setOpen({ ...open, [r.id]: !isOpen })} title={isOpen ? "收起关联事项" : "展开关联事项"} aria-label={isOpen ? "收起关联事项" : "展开关联事项"} className="mt-0.5 text-[var(--color-muted)]">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[12px] text-[var(--color-muted)]">{r.code}</span>
                    <p className={`text-sm ${r.status === "dropped" ? "text-[var(--color-muted)] line-through" : "font-medium"}`}>{r.title}</p>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={TONE[r.status]}>{REQ_STATUS_LABEL[r.status]}</Badge>
                    {r.priority !== "P1" && <Badge tone={r.priority === "P0" ? "danger" : "default"}>{r.priority}</Badge>}
                    {r.milestoneId && <Badge>{milestones.find((m) => m.id === r.milestoneId)?.name ?? "阶段"}</Badge>}
                    {r.untriaged && r.status !== "proposed" && <Badge tone="danger">未拆解</Badge>}
                    {r.stat.total > 0 && <span className="text-[11px] text-[var(--color-muted)]">事项 {r.stat.done}/{r.stat.total}</span>}
                    {r.source && <span className="text-[11px] text-[var(--color-muted)]">来源：{r.source}</span>}
                    <span className="text-[11px] text-[var(--color-muted)]">{relTime(r.createdAt)}</span>
                  </div>
                  {r.stat.total > 0 && r.status !== "dropped" && <div className="mt-1.5 h-1 w-40 overflow-hidden rounded-full bg-[var(--color-line)]"><div className="h-full rounded-full bg-[var(--color-ok)]" style={{ width: `${pct}%` }} /></div>}
                  {["done", "dropped"].includes(r.status) && r.closeReason && <p className="mt-1 text-[12px] text-[var(--color-muted)]">{r.status === "done" ? "完成说明" : "放弃原因"}：{r.closeReason}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {r.status === "proposed" && <Button size="sm" variant="ghost" onClick={() => save({ id: r.id, status: "accepted" }, "已确认要做")}><Check /> 确认要做</Button>}
                  {!["done", "dropped"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => { setSplitFor(r); setSplitText(""); }}><Split /> 拆事项</Button>}
                  {!["done", "dropped"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => { setDropFor(r); setDropReason(""); }}><X /> 不做了</Button>}
                  {["done", "dropped"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => save({ id: r.id, status: "accepted" }, "已重新打开")}>重新打开</Button>}
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-[var(--color-line)] bg-[var(--color-line)]/10 px-10 py-2 text-[12px]">
                  {r.detailMd && <p className="mb-2 whitespace-pre-wrap">{r.detailMd}</p>}
                  {r.items.length === 0 ? <p className="text-[var(--color-muted)]">还没有拆出事项。</p> : (
                    <ul className="flex flex-col gap-1">{r.items.map((i) => <li key={i.id} className="flex items-center gap-2"><Badge tone={i.status === "done" ? "ok" : i.status === "blocked" ? "danger" : "default"}>{i.status === "done" ? "完成" : i.status === "doing" ? "进行中" : i.status === "blocked" ? "阻塞" : i.status === "dropped" ? "放弃" : "待办"}</Badge>{i.title}</li>)}</ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>记一条需求</DialogTitle><DialogDescription>一句话写清「要做成什么」。确认后在需求上点「拆事项」。</DialogDescription></DialogHeader>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：用户可以用微信一键登录" />
          <Textarea rows={3} value={form.detail_md} onChange={(e) => setForm({ ...form, detail_md: e.target.value })} placeholder="细节、验收口径、约束（可选）" />
          <div className="grid grid-cols-3 gap-2">
            <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="来源：客户/会议/自己" />
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">{["P0", "P1", "P2", "P3"].map((p) => <option key={p}>{p}</option>)}</select>
            <select value={form.milestone} onChange={(e) => setForm({ ...form, milestone: e.target.value })} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm"><option value="">不指定阶段</option>{milestones.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}</select>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setAdding(false)}>取消</Button><Button onClick={add}>记录</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!splitFor} onOpenChange={(o) => !o && setSplitFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>拆成事项：{splitFor?.code} {splitFor?.title}</DialogTitle><DialogDescription>每行一个可验收的事项。全部完成后，需求会自动关闭。</DialogDescription></DialogHeader>
          <Textarea rows={6} value={splitText} onChange={(e) => setSplitText(e.target.value)} placeholder={"申请微信开放平台网站应用\n后端接入扫码登录回调\n前端登录页加微信按钮\n真机联调"} />
          <DialogFooter><Button variant="ghost" onClick={() => setSplitFor(null)}>取消</Button><Button onClick={split}>拆分</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dropFor} onOpenChange={(o) => !o && setDropFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>不做「{dropFor?.title}」</DialogTitle><DialogDescription>写明原因留档，之后看得到为什么没做。关联事项不会被删除。</DialogDescription></DialogHeader>
          <Textarea rows={3} value={dropReason} onChange={(e) => setDropReason(e.target.value)} placeholder="例如：客户确认二期再做 / 成本太高改用第三方 / 与核心目标无关" />
          <DialogFooter><Button variant="ghost" onClick={() => setDropFor(null)}>取消</Button><Button onClick={drop}>确认放弃</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}