"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShieldCheck, Check, X, Clock, Archive, RefreshCw, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { fmtDate } from "@/lib/utils";
import { toast } from "sonner";

type P = {
  id: string; title: string; bodyMd: string; version: number; required: number; appliesToTools: string; projectId: string | null;
  acked: boolean; live?: boolean; expired?: boolean; needReview?: boolean; tools?: string[]; status: string; purpose: string;
  scopeMode: string; expiresAt: number | null; reviewEveryDays: number | null; lastReviewedAt: number | null;
  proposedBy: string; approvedBy: string; approvedAt: number | null;
};

const WRITE_CHOICES = [
  ["checklist_add", "添加任务"], ["checklist_update", "核销/变更任务"], ["meeting_import", "导入会议"],
  ["ingest_history", "归集历史"], ["note_save", "写笔记"], ["decision_record", "记录决定"],
  ["file_register", "登记资料"], ["item_move", "分拣任务"], ["project_create", "新建项目"],
] as const;

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  active: { label: "生效中", tone: "ok" }, pending: { label: "待批准", tone: "warn" },
  draft: { label: "草稿", tone: "default" }, retired: { label: "已废止", tone: "default" },
};

const blank = { title: "", body_md: "", required: true, project_id: "", applies_to_tools: "", scope_mode: "tools", purpose: "", expires_at: "", review_every_days: "" };

export function PoliciesClient({ initial, projects }: { initial: P[]; projects: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<P | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [showRetired, setShowRetired] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const visible = useMemo(() => initial.filter((p) => (showRetired ? true : p.status !== "retired")), [initial, showRetired]);
  const pending = visible.filter((p) => p.status === "pending");

  function startNew() { setEdit(null); setForm({ ...blank }); setOpen(true); }
  function startEdit(p: P) {
    setEdit(p);
    setForm({
      title: p.title, body_md: p.bodyMd, required: !!p.required, project_id: p.projectId ?? "",
      applies_to_tools: p.appliesToTools, scope_mode: p.scopeMode === "all" ? "all" : "tools", purpose: p.purpose,
      expires_at: p.expiresAt ? new Date(p.expiresAt * 1000).toISOString().slice(0, 10) : "",
      review_every_days: p.reviewEveryDays ? String(p.reviewEveryDays) : "",
    });
    setOpen(true);
  }

  async function post(body: Record<string, unknown>, okMsg: string) {
    const r = await fetch("/api/ui/policies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
    if (!r.ok) { toast.error(r.error ?? "失败"); return false; }
    toast.success(okMsg); router.refresh(); return true;
  }

  async function save(opts: { approve?: boolean } = {}) {
    if (!form.title.trim()) return toast.error("请填写标题");
    if (!form.body_md.trim()) return toast.error("请填写正文");
    if (form.required && form.scope_mode === "tools" && !form.applies_to_tools.trim()) return toast.error("必读条例必须勾选它要约束的操作");
    const body = {
      id: edit?.id, title: form.title, body_md: form.body_md, required: form.required,
      project_id: form.project_id || null, applies_to_tools: form.applies_to_tools, scope_mode: form.scope_mode,
      purpose: form.purpose, expires_at: form.expires_at ? Math.floor(new Date(form.expires_at + "T23:59:59").getTime() / 1000) : null,
      review_every_days: form.review_every_days ? Number(form.review_every_days) : null,
      approved: opts.approve || undefined,
    };
    if (await post(body, opts.approve ? "已批准并生效" : "已保存")) setOpen(false);
  }

  async function act(p: P, action: "approve" | "retire" | "review" | "ack", msg: string) {
    setBusy(p.id);
    await post({ action, id: p.id }, msg);
    setBusy(null);
  }

  function toggle(v: string) {
    const set = new Set(form.applies_to_tools.split(",").map((x) => x.trim()).filter(Boolean));
    if (set.has(v)) set.delete(v); else set.add(v);
    setForm({ ...form, applies_to_tools: [...set].join(",") });
  }

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">条例</h1>
          <p className="mt-1 max-w-xl text-sm text-[var(--color-muted)]">
            agent 的硬性要求。<b>只有你在这里批准过的必读条例</b>才会拦截操作；agent 只能「提议」，进待批准区。每条必读条例必须限定到具体操作，同一范围最多 5 条，避免越堆越乱。
          </p>
        </div>
        <Button onClick={startNew}><Plus /> 新增条例</Button>
      </header>

      {pending.length > 0 && (
        <div className="mb-4 rounded-xl border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><AlertTriangle className="size-4" />{pending.length} 条由 agent 提议的条例待你审阅（未生效）</p>
          <div className="flex flex-wrap gap-1.5">{pending.map((p) => <button key={p.id} onClick={() => startEdit(p)} className="rounded-md bg-[var(--color-card)] px-2 py-1 text-xs shadow-sm">{p.title}</button>)}</div>
        </div>
      )}

      <div className="mb-3 flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 text-[var(--color-muted)]"><input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> 显示已废止</label>
      </div>

      <div className="flex flex-col gap-3">
        {visible.length === 0 && <div className="rounded-xl border border-dashed border-[var(--color-line)] p-10 text-center text-sm text-[var(--color-muted)]">还没有条例。建议先写一条：完成任务必须提供证据。</div>}
        {visible.map((p) => {
          const st = STATUS_LABEL[p.status] ?? STATUS_LABEL.active;
          const tone = p.expired ? "default" : st.tone;
          return (
            <Card key={p.id} className={p.status === "retired" ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ShieldCheck className="size-4 shrink-0 text-[var(--color-brand)]" />
                    <p className="text-sm font-medium">{p.title}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge>v{p.version}</Badge>
                    <Badge tone={tone as never}>{p.expired ? "已过期" : st.label}</Badge>
                    {!!p.required && p.status === "active" && !p.expired && <Badge tone="danger">必读</Badge>}
                    {p.needReview && <Badge tone="warn">该复核</Badge>}
                    <Badge>{p.projectId ? projects.find((x) => x.id === p.projectId)?.name ?? "项目" : "全局"}</Badge>
                    {p.scopeMode === "all" ? <Badge tone="warn">所有写操作</Badge> : (p.tools?.length ? <Badge>{(p.tools ?? []).length} 个操作</Badge> : null)}
                    {!!p.live && !!p.required && (p.acked ? <Badge tone="ok">已确认</Badge> : <Badge>待确认</Badge>)}
                  </div>
                </div>
                {p.purpose && <p className="mt-2 text-[12px] text-[var(--color-muted)]">管什么：{p.purpose}</p>}
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[var(--color-muted)]">{p.bodyMd}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
                  <span className="inline-flex items-center gap-1"><Clock className="size-3" />{p.expiresAt ? `${fmtDate(p.expiresAt)} 到期` : "长期有效"}{p.reviewEveryDays ? ` · 每 ${p.reviewEveryDays} 天复核` : ""}</span>
                  {p.proposedBy && <span>· 提议：{p.proposedBy}</span>}
                  {p.approvedBy && <span>· 批准：{p.approvedBy}</span>}
                </div>
                <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                  {p.status === "pending" && <>
                    <Button size="sm" onClick={() => startEdit(p)}>审阅</Button>
                    <Button size="sm" variant="ghost" onClick={() => act(p, "approve", "已批准并生效")} disabled={busy === p.id}><Check /> 批准</Button>
                  </>}
                  {p.live && p.status === "active" && !!p.required && !p.acked && <Button size="sm" variant="ghost" onClick={() => act(p, "ack", "已确认")} disabled={busy === p.id}><Check /> 确认已读</Button>}
                  {p.status === "active" && p.needReview && <Button size="sm" variant="ghost" onClick={() => act(p, "review", "已记录复核")} disabled={busy === p.id}><RefreshCw /> 已复核</Button>}
                  {p.status === "active" && <Button size="sm" variant="ghost" onClick={() => act(p, "retire", "已废止")} disabled={busy === p.id}><Archive /> 废止</Button>}
                  <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>编辑</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{edit ? "编辑条例" : "新增条例"}</DialogTitle>
            <DialogDescription>修改正文会自动升版本，agent 需重新确认。你保存即生效；agent 只能提议，由你批准。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="标题，如：变更前必须留证据" maxLength={80} />
            <Textarea rows={6} maxLength={2000} value={form.body_md} onChange={(e) => setForm({ ...form, body_md: e.target.value })} placeholder={"1. 客户资料不得出现在公开仓库…\n2. 完成事项必须写 evidence…"} />
            <p className="-mt-2 text-right text-[11px] text-[var(--color-muted)]">{form.body_md.length}/2000</p>
            <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="这条规矩管什么、依据是什么（供你日后判断是否还适用）" />

            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-1 flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">适用项目</span>
                <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">
                  <option value="">全局</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> 必读（拦截操作）</label>
            </div>

            <div>
              <p className="mb-1.5 text-xs text-[var(--color-muted)]">约束哪些操作 {form.required && "(必读条例必填)"}</p>
              <div className="flex flex-wrap gap-1.5">
                {WRITE_CHOICES.map(([v, l]) => {
                  const on = form.applies_to_tools.split(",").map((x) => x.trim()).includes(v);
                  return <button key={v} type="button" onClick={() => toggle(v)} className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]" : "border-[var(--color-line)] text-[var(--color-muted)] hover:bg-[var(--color-line)]/40"}`}>{l}</button>;
                })}
              </div>
              <label className="mt-2 flex items-center gap-2 text-[12px] text-[var(--color-muted)]"><input type="checkbox" checked={form.scope_mode === "all"} onChange={(e) => setForm({ ...form, scope_mode: e.target.checked ? "all" : "tools", applies_to_tools: e.target.checked ? "" : form.applies_to_tools })} /> 作用于所有写操作（慎用，会拦住全部 agent 写入）</label>
            </div>

            <div className="flex flex-wrap gap-3">
              <label className="flex flex-1 flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">到期日（可选，到期自动失效）</span>
                <Input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
              </label>
              <label className="flex flex-1 flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">每 N 天复核（可选）</span>
                <Input type="number" min={7} value={form.review_every_days} onChange={(e) => setForm({ ...form, review_every_days: e.target.value })} placeholder="如 180" />
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            {edit?.status === "pending" && <Button variant="secondary" onClick={() => save({ approve: true })}><Check /> 保存并批准</Button>}
            <Button onClick={() => save()}><Check /> 保存生效</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}