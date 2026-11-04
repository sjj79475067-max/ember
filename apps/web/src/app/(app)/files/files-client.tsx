"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus, RefreshCw, CircleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { callTool } from "@/lib/ui-api";
import { relTime } from "@/lib/utils";
import { toast } from "sonner";

type F = { id: string; projectId: string; label: string; machine: string; path: string; url: string; archiveTo: string; status: string; lastVerifiedAt: number | null; stale: boolean };

export function FilesClient({ initial, projects, focus }: { initial: F[]; projects: Array<{ id: string; name: string; key: string }>; focus?: string }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [onlyStale, setOnlyStale] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ project: projects[0]?.id ?? "", label: "", machine: "", path: "", url: "", archive_to: "local" });

  const shown = rows.filter((f) => (!q || f.label.includes(q) || f.path.includes(q)) && (!onlyStale || f.stale || f.status === "missing"));
  const staleCount = rows.filter((f) => f.stale || f.status === "missing").length;

  async function add() {
    if (!form.label || (!form.path && !form.url)) return toast.error("名称和路径（或链接）必填");
    const r = await callTool("file_register", form);
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("已登记"); setOpen(false); router.refresh();
  }
  async function verify(f: F, result: "ok" | "missing") {
    const r = await callTool("file_verify", { file_id: f.id, result });
    if (!r.ok) return toast.error(r.error ?? "失败");
    setRows((prev) => prev.map((x) => x.id === f.id ? { ...x, status: result === "ok" ? "active" : "missing", stale: false, lastVerifiedAt: Date.now() / 1000 } : x));
    toast.success(result === "ok" ? "已核验" : "已标记丢失");
  }

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">资料位置</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">资料本体留在原处，这里只记录在哪、归档到哪、是否核验过。超过 30 天未核验会列为待核验。</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus /> 登记位置</Button>
      </header>
      <div className="mb-3 flex items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索资料…" className="h-8 w-56" />
        <button onClick={() => setOnlyStale((v) => !v)} className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs ${onlyStale ? "border-[var(--color-warn)] bg-[var(--color-warn)]/10 text-[oklch(0.5_0.12_70)]" : "border-[var(--color-line)] text-[var(--color-muted)]"}`}>
          <CircleAlert className="size-3.5" /> 待核验 {staleCount > 0 && `(${staleCount})`}
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]">
        {shown.length === 0 && <p className="p-10 text-center text-sm text-[var(--color-muted)]">没有资料记录。</p>}
        {shown.map((f) => {
          const p = projects.find((x) => x.id === f.projectId);
          return (
            <div key={f.id} className={`flex items-start gap-3 border-b border-[var(--color-line)] p-3.5 last:border-0 ${focus === f.id ? "bg-[var(--color-brand-soft)]/40" : ""}`}>
              <FolderOpen className="mt-0.5 size-4 shrink-0 text-[var(--color-muted)]" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm font-medium">{f.label}</p>
                  {p && <Badge tone="brand">{p.key}</Badge>}
                  <Badge>{f.archiveTo}</Badge>
                  {f.status === "missing" ? <Badge tone="danger">找不到</Badge> : f.stale ? <Badge tone="warn">待核验</Badge> : <Badge tone="ok">已核验</Badge>}
                </div>
                <p className="mt-0.5 truncate font-mono text-[12px] text-[var(--color-muted)]">{f.machine ? `${f.machine}:` : ""}{f.path || f.url}</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{f.lastVerifiedAt ? `上次核验 ${relTime(f.lastVerifiedAt)}` : "从未核验"}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => verify(f, "ok")}><RefreshCw /> 仍在</Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>登记资料位置</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">所属项目</span>
              <select value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">名称</span><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="部署手册" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">机器</span><Input value={form.machine} onChange={(e) => setForm({ ...form, machine: e.target.value })} placeholder="macmini" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">归档去向</span>
              <select value={form.archive_to} onChange={(e) => setForm({ ...form, archive_to: e.target.value })} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">
                <option value="local">本地</option><option value="github">GitHub</option><option value="r2">对象存储</option><option value="other">其他</option>
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">路径</span><Input value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} className="font-mono" /></label>
            <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">链接</span><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="font-mono" /></label>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button onClick={add}>登记</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
