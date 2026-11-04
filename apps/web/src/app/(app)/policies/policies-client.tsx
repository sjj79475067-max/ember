"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShieldCheck, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

type P = { id: string; title: string; bodyMd: string; version: number; required: number; appliesToTools: string; projectId: string | null; acked: boolean };

export function PoliciesClient({ initial, projects }: { initial: P[]; projects: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<P | null>(null);
  const [form, setForm] = useState({ title: "", body_md: "", required: true, project_id: "", applies_to_tools: "" });

  function startNew() { setEdit(null); setForm({ title: "", body_md: "", required: true, project_id: "", applies_to_tools: "" }); setOpen(true); }
  function startEdit(p: P) { setEdit(p); setForm({ title: p.title, body_md: p.bodyMd, required: !!p.required, project_id: p.projectId ?? "", applies_to_tools: p.appliesToTools }); setOpen(true); }

  async function save() {
    if (!form.title.trim()) return toast.error("请填写标题");
    const r = await fetch("/api/ui/policies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: edit?.id, title: form.title, body_md: form.body_md, required: form.required, project_id: form.project_id || null, applies_to_tools: form.applies_to_tools }) }).then((x) => x.json());
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("已保存"); setOpen(false); router.refresh();
  }

  async function ack(p: P) {
    await fetch("/api/ui/policies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ack", id: p.id }) });
    toast.success("已确认"); router.refresh();
  }

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">条例</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">你对 agent 的硬性要求。标记为「必读」的条例，agent 未确认前写操作会被拦截。</p>
        </div>
        <Button onClick={startNew}><Plus /> 新增条例</Button>
      </header>
      <div className="flex flex-col gap-3">
        {initial.length === 0 && <div className="rounded-xl border border-dashed border-[var(--color-line)] p-10 text-center text-sm text-[var(--color-muted)]">还没有条例。建议先写一条：完成任务必须提供证据。</div>}
        {initial.map((p) => (
          <Card key={p.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-[var(--color-brand)]" /><p className="text-sm font-medium">{p.title}</p></div>
                <div className="flex items-center gap-1.5">
                  <Badge>v{p.version}</Badge>
                  {p.required ? <Badge tone="danger">必读</Badge> : <Badge>参考</Badge>}
                  <Badge>{p.projectId ? projects.find((x) => x.id === p.projectId)?.name ?? "项目" : "全局"}</Badge>
                  {p.acked ? <Badge tone="ok">已确认</Badge> : p.required ? (
                    <button onClick={() => ack(p)} className="flex items-center gap-1 rounded-md bg-[var(--color-brand-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-brand)]"><Check className="size-3" />确认已读</button>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[var(--color-muted)]">{p.bodyMd}</p>
              <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" onClick={() => startEdit(p)}>编辑</Button></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit ? "编辑条例" : "新增条例"}</DialogTitle><DialogDescription>修改内容会自动升版本，agent 需重新确认。</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-3">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="标题，如：AI 操作基本条例" />
            <Textarea rows={8} value={form.body_md} onChange={(e) => setForm({ ...form, body_md: e.target.value })} placeholder={"1. 完成任务必须提供 evidence…\n2. 对外发送前必须让用户确认…"} />
            <div className="flex items-center gap-3">
              <label className="flex flex-1 flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">适用项目</span>
                <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">
                  <option value="">全局</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> 必读（拦截写操作）</label>
            </div>
            <Input value={form.applies_to_tools} onChange={(e) => setForm({ ...form, applies_to_tools: e.target.value })} placeholder="限定工具（逗号分隔，留空=全部写操作）" />
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button onClick={save}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
