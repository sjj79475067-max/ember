"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { callTool } from "@/lib/ui-api";
import { relTime } from "@/lib/utils";
import { toast } from "sonner";

type N = { id: string; projectId: string | null; title: string; bodyMd: string; tags: string; source: string; updatedAt: number };

export function NotesClient({ initial, projects }: { initial: N[]; projects: Array<{ id: string; name: string; key: string }> }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<N | null>(null);
  const [form, setForm] = useState({ title: "", body_md: "", tags: "", project: "" });

  const shown = initial.filter((n) => !q || n.title.includes(q) || n.bodyMd.includes(q) || n.tags.includes(q));

  function start(n?: N) {
    setEdit(n ?? null);
    setForm({ title: n?.title ?? "", body_md: n?.bodyMd ?? "", tags: n?.tags ?? "", project: n?.projectId ?? "" });
    setOpen(true);
  }
  async function save() {
    if (!form.title.trim()) return toast.error("请填写标题");
    const r = await callTool("note_save", { id: edit?.id, project: form.project || undefined, title: form.title, body_md: form.body_md, tags: form.tags });
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("已保存"); setOpen(false); router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">知识库</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">零散但重要的信息：咨询结论、规则、经验、账号归属。Agent 可直接写入与检索。</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-[var(--color-muted)]" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索" className="h-9 w-40 pl-8" /></div>
          <Button onClick={() => start()}><Plus /> 新建</Button>
        </div>
      </header>
      <div className="columns-1 gap-3 sm:columns-2">
        {shown.map((n) => {
          const p = projects.find((x) => x.id === n.projectId);
          return (
            <button key={n.id} onClick={() => start(n)} className="mb-3 block w-full break-inside-avoid text-left">
              <Card className="hover:shadow-md"><CardContent className="p-4">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[12.5px] leading-6 text-[var(--color-muted)]">{n.bodyMd}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {p && <Badge tone="brand">{p.key}</Badge>}
                  {n.tags.split(",").filter(Boolean).map((t) => <Badge key={t}>{t.trim()}</Badge>)}
                  <span className="ml-auto text-[11px] text-[var(--color-muted)]">{relTime(n.updatedAt)}</span>
                </div>
              </CardContent></Card>
            </button>
          );
        })}
        {shown.length === 0 && <p className="py-10 text-sm text-[var(--color-muted)]">还没有笔记。</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{edit ? "编辑笔记" : "新建笔记"}</DialogTitle></DialogHeader>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="标题" />
          <Textarea rows={12} value={form.body_md} onChange={(e) => setForm({ ...form, body_md: e.target.value })} placeholder="支持 Markdown" />
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">归属项目</span>
              <select value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">
                <option value="">无</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">标签（逗号分隔）</span><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button onClick={save}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
