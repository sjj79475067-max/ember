"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { callTool } from "@/lib/ui-api";
import { fmtDate, KIND_LABEL } from "@/lib/utils";
import { toast } from "sonner";

type P = { id: string; key: string; name: string; kind: string; status: string; summaryMd: string; dueAt: number | null; progress: { total: number; done: number; blocked: number; overdue: number } };

export function ProjectsClient({ initial, openNew }: { initial: P[]; openNew: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(openNew);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ key: "", name: "", kind: "admin", summary_md: "", due: "" });

  const filtered = initial.filter((p) => !q || p.name.includes(q) || p.key.toLowerCase().includes(q.toLowerCase()));

  async function submit() {
    if (!form.key.trim() || !form.name.trim()) return toast.error("代号和名称必填");
    const r = await callTool("project_create", {
      key: form.key.trim().toUpperCase(), name: form.name.trim(), kind: form.kind, summary_md: form.summary_md,
      due_at: form.due ? Math.floor(new Date(form.due + "T18:00:00").getTime() / 1000) : undefined,
    });
    if (!r.ok) return toast.error(r.error ?? "创建失败");
    toast.success("项目已创建");
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">项目</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-[var(--color-muted)]" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索" className="h-9 w-44 pl-8" />
          </div>
          <Button onClick={() => setOpen(true)}><Plus /> 新建项目</Button>
        </div>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => {
          const pct = p.progress.total ? Math.round((p.progress.done / p.progress.total) * 100) : 0;
          return (
            <Link key={p.id} href={`/p/${p.id}`}>
              <Card className="h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-[11px] text-[var(--color-muted)]">{p.key} · {KIND_LABEL[p.kind]}</p>
                    </div>
                    {p.status !== "active" && <Badge>{p.status === "done" ? "已完成" : p.status === "paused" ? "暂停" : "归档"}</Badge>}
                  </div>
                  {p.summaryMd && <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-[var(--color-muted)]">{p.summaryMd}</p>}
                  <div className="mt-3 mb-1 flex justify-between text-[11px] text-[var(--color-muted)]"><span>{p.progress.done}/{p.progress.total}</span><span>{pct}%</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]"><div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${pct}%` }} /></div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.progress.blocked > 0 && <Badge tone="danger">{p.progress.blocked} 阻塞</Badge>}
                    {p.progress.overdue > 0 && <Badge tone="warn">{p.progress.overdue} 逾期</Badge>}
                    {p.dueAt && <Badge>{fmtDate(p.dueAt)}</Badge>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新建项目</DialogTitle><DialogDescription>IT 项目、事务性工作、客户交付或资料库都能放。</DialogDescription></DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">代号</span><Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="IT" /></label>
            <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">名称</span><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="客户门户 V2 交付" /></label>
            <label className="col-span-1 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">类型</span>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">
                <option value="it">IT 项目</option><option value="admin">事务</option><option value="client">客户</option><option value="knowledge">资料库</option>
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">截止日期（可选）</span><Input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></label>
            <label className="col-span-3 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">说明</span><Textarea rows={3} value={form.summary_md} onChange={(e) => setForm({ ...form, summary_md: e.target.value })} placeholder="背景、目标、交付物…" /></label>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button onClick={submit}>创建</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
