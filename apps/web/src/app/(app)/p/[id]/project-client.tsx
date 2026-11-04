"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Check, Circle, Ban, Shuffle, ChevronDown, Calendar, Files as FilesIcon, MessageSquare, Scale, ListChecks, History, Link2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { callTool } from "@/lib/ui-api";
import { fmtDate, relTime, STATUS_LABEL, KIND_LABEL, daysLeft } from "@/lib/utils";
import { toast } from "sonner";

type Item = { id: string; position: number; title: string; detailMd: string; doneDefinition: string; status: string; priority: string; dueAt: number | null; evidence: string; blockReason: string; claimedBy: string; sourceType: string; version: number; updatedAt: number; projectId: string };
type Ev = { id: string; itemId: string; actorType: string; actorName: string; action: string; fromStatus: string; toStatus: string; note: string; evidence: string; createdAt: number };
type Data = {
  project: { id: string; key: string; name: string; kind: string; status: string; summaryMd: string; dueAt: number | null; githubRepo: string; localRoot: string; archiveNote: string };
  items: Item[]; meetings: Array<{ id: string; title: string; heldAt: number; summaryMd: string; source: string }>;
  decisions: Array<{ id: string; title: string; rationaleMd: string; createdAt: number }>;
  files: Array<{ id: string; label: string; machine: string; path: string; url: string; archiveTo: string; status: string; lastVerifiedAt: number | null }>;
  policies: Array<{ id: string; title: string; bodyMd: string; required: number; version: number }>;
  events: Ev[];
  progress: { total: number; done: number; doing: number; blocked: number; changed: number; overdue: number };
};

const TABS = [
  { id: "checklist", label: "清单", icon: ListChecks },
  { id: "meetings", label: "会议", icon: MessageSquare },
  { id: "files", label: "资料", icon: FilesIcon },
  { id: "decisions", label: "决定", icon: Scale },
  { id: "activity", label: "动态", icon: History },
] as const;

export function ProjectClient({ data }: { data: Data }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("checklist");
  const [filter, setFilter] = useState<"open" | "all" | "done">("open");
  const p = data.project;
  const pct = data.progress.total ? Math.round((data.progress.done / data.progress.total) * 100) : 0;

  const items = useMemo(() => {
    const list = [...data.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.updatedAt - b.updatedAt);
    if (filter === "open") return list.filter((i) => !["done", "dropped"].includes(i.status));
    if (filter === "done") return list.filter((i) => ["done", "dropped"].includes(i.status));
    return list;
  }, [data.items, filter]);

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <Link href="/projects" className="hover:underline">项目</Link><span>/</span><span>{p.key}</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{p.name}</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{p.summaryMd || "暂无说明"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone="brand">{KIND_LABEL[p.kind]}</Badge>
              {p.dueAt && <Badge>{fmtDate(p.dueAt)} 截止</Badge>}
              {p.githubRepo && <Badge>{p.githubRepo}</Badge>}
              {data.progress.overdue > 0 && <Badge tone="danger">{data.progress.overdue} 逾期</Badge>}
              {data.progress.blocked > 0 && <Badge tone="warn">{data.progress.blocked} 阻塞</Badge>}
              {data.progress.changed > 0 && <Badge tone="warn">{data.progress.changed} 变更</Badge>}
            </div>
          </div>
          <div className="w-56">
            <div className="mb-1 flex items-baseline justify-between"><span className="text-2xl font-semibold tabular-nums">{pct}%</span><span className="text-[11px] text-[var(--color-muted)]">{data.progress.done}/{data.progress.total} 完成</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--color-line)]"><div className="h-full rounded-full bg-gradient-to-r from-[var(--color-brand)] to-[oklch(0.72_0.15_60)] transition-all" style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
      </header>

      <div className="mb-4 flex gap-1 border-b border-[var(--color-line)]">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${tab === t.id ? "border-[var(--color-brand)] font-medium text-[var(--color-brand)]" : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}>
            <t.icon className="size-4" />{t.label}{t.id === "meetings" && data.meetings.length > 0 && <span className="text-[11px]">({data.meetings.length})</span>}
          </button>
        ))}
      </div>

      {tab === "checklist" && <Checklist items={items} projectId={p.id} filter={filter} setFilter={setFilter} onChange={() => router.refresh()} />}
      {tab === "meetings" && <Meetings projectId={p.id} meetings={data.meetings} />}
      {tab === "files" && <Files projectId={p.id} files={data.files} onChange={() => router.refresh()} />}
      {tab === "decisions" && <Decisions projectId={p.id} decisions={data.decisions} policies={data.policies} />}
      {tab === "activity" && <Activity events={data.events} items={data.items} />}
    </div>
  );
}

function Checklist({ items, projectId, filter, setFilter, onChange }: { items: Item[]; projectId: string; filter: string; setFilter: (f: "open" | "all" | "done") => void; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(it: Item) {
    if (busy) return;
    if (it.status === "done") {
      setBusy(it.id);
      await callTool("checklist_update", { item_id: it.id, status: "todo", expected_version: it.version });
      setBusy(null); onChange(); return;
    }
    const evidence = window.prompt(`完成「${it.title}」\n\n请写下完成证据（做了什么 / 在哪验证 / 链接或路径）：`, "");
    if (evidence === null) return;
    if (!evidence.trim()) return toast.error("必须写完成证据");
    setBusy(it.id);
    const r = await callTool("checklist_update", { item_id: it.id, status: "done", evidence: evidence.trim(), expected_version: it.version });
    setBusy(null);
    if (r.ok) { toast.success("已核销"); onChange(); } else toast.error(r.error ?? "更新失败");
  }

  async function block(it: Item) {
    const reason = window.prompt("阻塞原因（需要谁做什么）：", it.blockReason);
    if (!reason) return;
    await callTool("checklist_update", { item_id: it.id, status: "blocked", block_reason: reason, expected_version: it.version });
    toast.success("已标记阻塞"); onChange();
  }

  async function change(it: Item) {
    const note = window.prompt("变更说明（哪些部分做了调整）：", "");
    if (!note) return;
    await callTool("checklist_update", { item_id: it.id, status: "changed", note, evidence: note, expected_version: it.version });
    toast.success("已记录变更"); onChange();
  }

  async function add() {
    const lines = bulk.split("\n").map((l) => l.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean);
    if (!lines.length) return;
    const r = await callTool("checklist_add", { project: projectId, items: lines.map((t) => ({ title: t })) });
    if (!r.ok) return toast.error(r.error ?? "添加失败");
    toast.success(`已添加 ${lines.length} 条`); setBulk(""); setAdding(false); onChange();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg bg-[var(--color-line)]/40 p-0.5 text-xs">
          {([["open", "未完成"], ["all", "全部"], ["done", "已完成"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 transition-colors ${filter === k ? "bg-[var(--color-card)] font-medium shadow-sm" : "text-[var(--color-muted)]"}`}>{l}</button>
          ))}
        </div>
        <Button size="sm" onClick={() => setAdding(true)}><Plus /> 添加任务</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]">
        {items.length === 0 && <p className="p-8 text-center text-sm text-[var(--color-muted)]">没有任务。可以导入会议记录自动生成，或手动添加。</p>}
        {items.map((it) => {
          const d = daysLeft(it.dueAt);
          return (
            <div key={it.id} className="group flex items-start gap-3 border-b border-[var(--color-line)] p-3 last:border-0 hover:bg-[var(--color-brand-soft)]/25">
              <button onClick={() => toggle(it)} disabled={busy === it.id} className="mt-0.5 shrink-0 rounded-full p-0.5 transition-transform hover:scale-110" title={it.status === "done" ? "重新打开" : "标记完成"}>
                {it.status === "done" ? <Check className="size-5 rounded-full bg-[var(--color-ok)] p-0.5 text-white" /> : it.status === "blocked" ? <Ban className="size-5 text-[var(--color-danger)]" /> : <Circle className="size-5 text-[var(--color-line)] group-hover:text-[var(--color-brand)]" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${it.status === "done" ? "text-[var(--color-muted)] line-through" : "font-medium"}`}>{it.title}</p>
                {it.doneDefinition && it.status !== "done" && <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">完成标准：{it.doneDefinition}</p>}
                {it.status === "blocked" && it.blockReason && <p className="mt-0.5 text-[12px] text-[var(--color-danger)]">阻塞：{it.blockReason}</p>}
                {it.evidence && <p className="mt-0.5 line-clamp-1 text-[12px] text-[var(--color-muted)]">证据：{it.evidence}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={it.status} />
                  {it.priority !== "P1" && <Badge tone={it.priority === "P0" ? "danger" : "default"}>{it.priority}</Badge>}
                  {it.dueAt && <Badge tone={d! < 0 ? "danger" : d! <= 2 ? "warn" : "default"}><Calendar className="size-3" />{fmtDate(it.dueAt)}{d! < 0 ? ` 逾期${-d!}天` : ""}</Badge>}
                  {it.claimedBy && <Badge tone="brand">认领中</Badge>}
                  {it.sourceType === "meeting" && <Badge>来自会议</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <IconBtn title="标记阻塞" onClick={() => block(it)}><Ban /></IconBtn>
                <IconBtn title="记录变更" onClick={() => change(it)}><Shuffle /></IconBtn>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>添加任务</DialogTitle><DialogDescription>每行一条，可直接粘贴清单。</DialogDescription></DialogHeader>
          <Textarea rows={8} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"完成登录模块改造\n接入数据看板\n交付前全量回归"} />
          <DialogFooter><Button variant="ghost" onClick={() => setAdding(false)}>取消</Button><Button onClick={add}>添加</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "done" ? "ok" : status === "blocked" ? "danger" : status === "doing" ? "brand" : status === "changed" ? "warn" : "default";
  return <Badge tone={tone as never}>{STATUS_LABEL[status] ?? status}</Badge>;
}
function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return <button title={title} onClick={onClick} className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-line)]/60 hover:text-[var(--color-fg)] [&_svg]:size-3.5">{children}</button>;
}

function Meetings({ projectId, meetings }: { projectId: string; meetings: Array<{ id: string; title: string; heldAt: number; summaryMd: string; source: string }> }) {
  return (
    <div className="flex flex-col gap-3">
      {meetings.length === 0 && <div className="rounded-xl border border-dashed border-[var(--color-line)] p-8 text-center text-sm text-[var(--color-muted)]">还没有会议档案。<Link href={`/import?project=${projectId}`} className="text-[var(--color-brand)] hover:underline">导入会议记录</Link></div>}
      {meetings.map((m) => (
        <Link key={m.id} href={`/meetings/${m.id}`} className="block">
          <Card className="hover:shadow-md"><CardContent className="p-4">
            <div className="flex items-center justify-between"><p className="text-sm font-medium">{m.title}</p><span className="text-[11px] text-[var(--color-muted)]">{fmtDate(m.heldAt, true)} · {m.source}</span></div>
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-6 text-[var(--color-muted)]">{m.summaryMd}</p>
          </CardContent></Card>
        </Link>
      ))}
    </div>
  );
}

function Files({ projectId, files, onChange }: { projectId: string; files: Array<{ id: string; label: string; machine: string; path: string; url: string; archiveTo: string; status: string; lastVerifiedAt: number | null }>; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: "", machine: "", path: "", url: "", archive_to: "local" });
  async function add() {
    const r = await callTool("file_register", { project: projectId, label: form.label, machine: form.machine, path: form.path, url: form.url, archive_to: form.archive_to });
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("已登记"); setOpen(false); setForm({ label: "", machine: "", path: "", url: "", archive_to: "local" }); onChange();
  }
  return (
    <div>
      <div className="mb-3 flex justify-end"><Button size="sm" onClick={() => setOpen(true)}><Plus /> 登记资料位置</Button></div>
      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]">
        {files.length === 0 && <p className="p-8 text-center text-sm text-[var(--color-muted)]">还没有登记资料位置。资料本体留在原处，这里只记录在哪。</p>}
        {files.map((f) => {
          const stale = !f.lastVerifiedAt || Date.now() / 1000 - f.lastVerifiedAt > 30 * 86400;
          return (
            <div key={f.id} className="flex items-start gap-3 border-b border-[var(--color-line)] p-3 last:border-0">
              <Link2 className="mt-0.5 size-4 shrink-0 text-[var(--color-muted)]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{f.label}</p>
                <p className="truncate font-mono text-[12px] text-[var(--color-muted)]">{f.machine ? `${f.machine}:` : ""}{f.path || f.url}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge>{f.archiveTo}</Badge>
                {f.status === "missing" ? <Badge tone="danger">找不到</Badge> : stale ? <Badge tone="warn">待核验</Badge> : <Badge tone="ok">已核验</Badge>}
              </div>
            </div>
          );
        })}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>登记资料位置</DialogTitle><DialogDescription>选填路径或链接；资料本体不复制到中心。</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">名称</span><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="部署手册" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">机器</span><Input value={form.machine} onChange={(e) => setForm({ ...form, machine: e.target.value })} placeholder="macmini" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">归档去向</span>
              <select value={form.archive_to} onChange={(e) => setForm({ ...form, archive_to: e.target.value })} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">
                <option value="local">本地</option><option value="github">GitHub</option><option value="r2">对象存储</option><option value="other">其他</option>
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">路径</span><Input value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} placeholder="~/projects/portal/DEPLOY.md" className="font-mono" /></label>
            <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">或链接</span><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://github.com/..." className="font-mono" /></label>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button onClick={add}>登记</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Decisions({ projectId, decisions, policies }: { projectId: string; decisions: Array<{ id: string; title: string; rationaleMd: string; createdAt: number }>; policies: Array<{ id: string; title: string; bodyMd: string; required: number; version: number }> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", rationale_md: "" });
  async function add() {
    const r = await callTool("decision_record", { project: projectId, title: form.title, rationale_md: form.rationale_md });
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("已记录"); setOpen(false); setForm({ title: "", rationale_md: "" }); location.reload();
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="mb-3 flex justify-end"><Button size="sm" onClick={() => setOpen(true)}><Plus /> 记录决定</Button></div>
        <div className="flex flex-col gap-3">
          {decisions.length === 0 && <p className="rounded-xl border border-dashed border-[var(--color-line)] p-8 text-center text-sm text-[var(--color-muted)]">还没有决定记录。</p>}
          {decisions.map((d) => (
            <Card key={d.id}><CardContent className="p-4">
              <p className="text-sm font-medium">{d.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-[var(--color-muted)]">{d.rationaleMd}</p>
              <p className="mt-2 text-[11px] text-[var(--color-muted)]">{fmtDate(d.createdAt, true)}</p>
            </CardContent></Card>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-[var(--color-muted)]">项目条例</h3>
        {policies.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--color-line)] p-4 text-xs text-[var(--color-muted)]">暂无项目条例。可到「条例」页新增。</p> :
          <div className="flex flex-col gap-2">{policies.map((p) => (
            <Card key={p.id}><CardContent className="p-3"><div className="flex items-center justify-between"><p className="text-[13px] font-medium">{p.title}</p><Badge>{`v${p.version}`}</Badge></div><p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-[var(--color-muted)]">{p.bodyMd}</p></CardContent></Card>
          ))}</div>}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>记录决定</DialogTitle></DialogHeader>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="决定标题" />
          <Textarea rows={5} value={form.rationale_md} onChange={(e) => setForm({ ...form, rationale_md: e.target.value })} placeholder="为什么这么定、影响哪些事" />
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button onClick={add}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Activity({ events, items }: { events: Ev[]; items: Item[] }) {
  const titleOf = (id: string) => items.find((i) => i.id === id)?.title ?? id.slice(0, 8);
  const ACTION: Record<string, string> = { create: "创建", update: "更新", claim: "认领", release: "释放", complete: "完成", change: "变更", block: "阻塞" };
  return (
    <div className="relative ml-2 border-l border-[var(--color-line)] pl-5">
      {events.length === 0 && <p className="py-8 text-sm text-[var(--color-muted)]">暂无动态。</p>}
      {events.map((e) => (
        <div key={e.id} className="relative pb-4">
          <span className="absolute -left-[26px] top-1.5 size-2.5 rounded-full border-2 border-[var(--color-bg)] bg-[var(--color-brand)]" />
          <p className="text-[13px]"><span className="font-medium">{e.actorName || e.actorType}</span> {ACTION[e.action] ?? e.action} <span className="font-medium">{titleOf(e.itemId)}</span>{e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus && <span className="text-[var(--color-muted)]">（{STATUS_LABEL[e.fromStatus] ?? e.fromStatus} → {STATUS_LABEL[e.toStatus] ?? e.toStatus}）</span>}</p>
          {(e.evidence || e.note) && <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--color-muted)]">{e.evidence || e.note}</p>}
          <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{relTime(e.createdAt)}</p>
        </div>
      ))}
    </div>
  );
}
