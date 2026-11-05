"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, Check, X, Mic, MessageSquare, Smartphone, Globe, RotateCw, ArrowRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { toast } from "sonner";

type D = { id: string; type: string; projectId: string | null; projectName: string; confidence: number; title: string; detail: string; dueAt: number | null; priority: string; waitingFor: string; evidence: string; done: boolean; targetTitle: string; status: string; href: string | null };
type C = { id: string; channel: string; kind: string; text: string; status: string; error: string; parser: string; createdAt: number; drafts: D[] };
type Data = { captures: C[]; projects: Array<{ id: string; name: string }>; typeLabel: Record<string, string>; focus: string | null; showAll: boolean };

const CH: Record<string, { label: string; icon: typeof Globe }> = { feishu: { label: "飞书", icon: MessageSquare }, http: { label: "快捷指令", icon: Smartphone }, web: { label: "网页", icon: Globe } };

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/ui/capture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false, error: "网络错误" }));
  if (!r.ok) toast.error(r.error ?? "失败");
  return r;
}
const toDate = (t: number | null) => (t ? new Date(t * 1000).toLocaleDateString("sv-SE") : "");
const fromDate = (v: string) => (v ? Math.floor(new Date(v + "T18:00:00").getTime() / 1000) : null);
const ago = (t: number) => { const m = Math.floor((Date.now() / 1000 - t) / 60); return m < 1 ? "刚刚" : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.floor(m / 60)} 小时前` : `${Math.floor(m / 1440)} 天前`; };

export function CaptureClient({ data }: { data: Data }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    const r = await post({ action: "submit", text });
    setBusy(false);
    if (r.ok) { setText(""); toast.success(r.error ? `没整理成：${r.error}` : `整理出 ${r.drafts} 条`); router.refresh(); }
  }
  const pending = data.captures.reduce((n, c) => n + c.drafts.filter((d) => d.status === "pending").length, 0);
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">随手记</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">想到什么就说一句。手机上用飞书或快捷指令发过来也行。整理好的草稿要你确认后才落到项目里。</p>
        </div>
        <Link href={data.showAll ? "/capture" : "/capture?all=1"} className="text-[13px] text-[var(--color-brand)] hover:underline">{data.showAll ? "只看待处理" : "看历史"}</Link>
      </header>
      <Card className="mb-5"><CardContent className="p-3">
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
          placeholder={"比如：记账App的备案初审过了；下周三前给某银行发正式报价；买个 Type-C 扩展坞，预算 300"} />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-[var(--color-muted)]">⌘↵ 发送 · 一句话说多件事会拆开</span>
          <Button size="sm" disabled={busy || !text.trim()} onClick={submit}>{busy ? <RotateCw className="animate-spin" /> : <Send />} 整理</Button>
        </div>
      </CardContent></Card>

      {data.captures.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-line)] p-8 text-center text-sm text-[var(--color-muted)]">
          没有待确认的。<Link href="/settings?tab=capture" className="text-[var(--color-brand)] hover:underline">接上飞书或快捷指令</Link>，手机上也能随手记。
        </div>
      ) : (
        <>
          {pending > 0 && <p className="mb-2 text-[13px] text-[var(--color-muted)]">{pending} 条待确认</p>}
          <div className="flex flex-col gap-3">{data.captures.map((c) => <CaptureCard key={c.id} c={c} data={data} />)}</div>
        </>
      )}
    </div>
  );
}

function CaptureCard({ c, data }: { c: C; data: Data }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [src, setSrc] = useState(c.text);
  const ch = CH[c.channel] ?? CH.web;
  const pending = c.drafts.filter((d) => d.status === "pending");
  const act = async (body: Record<string, unknown>, msg?: string) => { const r = await post(body); if (r.ok) { if (msg) toast.success(msg); router.refresh(); } return r; };
  return (
    <Card className={data.focus === c.id ? "ring-2 ring-[var(--color-brand)]" : ""}><CardContent className="p-3">
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 text-[var(--color-muted)]">{c.kind === "audio" ? <Mic className="size-4" /> : <ch.icon className="size-4" />}</span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-col gap-1.5">
              <Textarea rows={3} value={src} onChange={(e) => setSrc(e.target.value)} />
              <div className="flex gap-1.5"><Button size="sm" onClick={() => act({ action: "reparse", capture_id: c.id, text: src }, "已重新整理").then(() => setEditing(false))}><Sparkles /> 重新整理</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>取消</Button></div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-[13px] leading-5">{c.text || <span className="text-[var(--color-muted)]">（语音没识别出来）</span>}</p>
          )}
          <p className="mt-1 text-[11px] text-[var(--color-muted)]">{ch.label}{c.kind === "audio" ? " · 语音" : ""} · {ago(c.createdAt)}{c.parser === "rules" ? " · 规则整理（没配 AI）" : c.parser === "ai" ? " · AI 整理" : ""}</p>
          {c.error && <p className="mt-1 text-[12px] text-[var(--color-warn)]">{c.error}</p>}
        </div>
        {!editing && <button onClick={() => setEditing(true)} className="shrink-0 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-brand)]">改原文</button>}
      </div>
      <div className="flex flex-col gap-2">{c.drafts.map((d) => <DraftRow key={d.id} d={d} data={data} />)}</div>
      {(pending.length > 1 || c.status !== "done") && (
        <div className="mt-2 flex flex-wrap justify-end gap-1.5">
          {c.status !== "done" && <Button size="sm" variant="ghost" onClick={() => act({ action: "dismiss", capture_id: c.id }, "已忽略")}>整条不要</Button>}
          {pending.length > 1 && <Button size="sm" variant="secondary" onClick={() => act({ action: "confirm_all", capture_id: c.id }, `已确认 ${pending.length} 条`)}><Check /> 全部确认</Button>}
        </div>
      )}
    </CardContent></Card>
  );
}

function DraftRow({ d, data }: { d: D; data: Data }) {
  const router = useRouter();
  const [f, setF] = useState({ type: d.type, projectId: d.projectId ?? "", title: d.title, due: toDate(d.dueAt), waitingFor: d.waitingFor, done: d.done });
  const sel = "h-8 rounded-md border border-[var(--color-line)] bg-[var(--color-card)] px-1.5 text-[12px]";
  if (d.status !== "pending") {
    return (
      <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] ${d.status === "confirmed" ? "bg-[var(--color-ok)]/8" : "bg-[var(--color-line)]/25 text-[var(--color-muted)]"}`}>
        <Badge tone={d.status === "confirmed" ? "ok" : "default"}>{d.status === "confirmed" ? "已落实" : "已忽略"}</Badge>
        <span className={`min-w-0 flex-1 truncate ${d.status === "rejected" ? "line-through" : ""}`}>{d.title}</span>
        {d.projectName && <span className="shrink-0 text-[11px] text-[var(--color-muted)]">{d.projectName}</span>}
        {d.href && <Link href={d.href} className="shrink-0 text-[var(--color-brand)]"><ArrowRight className="size-3.5" /></Link>}
      </div>
    );
  }
  async function confirm() {
    const patch = {
      type: f.type, projectId: f.projectId || null, title: f.title, dueAt: fromDate(f.due), waitingFor: f.waitingFor, done: f.done,
    };
    const r = await post({ action: "confirm", id: d.id, patch });
    if (r.ok) { toast.success("已落实"); router.refresh(); }
  }
  const lowConf = !f.projectId || (f.projectId === d.projectId && d.confidence > 0 && d.confidence < 70);
  return (
    <div className="rounded-lg border border-[var(--color-line)] p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <select className={sel} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          {Object.entries(data.typeLabel).filter(([k]) => k !== "progress" || d.targetTitle).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {f.type !== "progress" && (
          <select className={`${sel} ${lowConf ? "border-[var(--color-warn)]" : ""}`} value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
            <option value="">未定 → 收件箱</option>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {f.type === "progress" && <span className="text-[12px] text-[var(--color-muted)]">→「{d.targetTitle}」（{d.projectName}）</span>}
        {lowConf && f.type !== "progress" && <span className="text-[11px] text-[var(--color-warn)]">{f.projectId ? "不太确定" : "拿不准项目"}</span>}
      </div>
      <Input className="mt-1.5 h-9" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
        {["item", "purchase", "deal", "trip"].includes(f.type) && <label className="flex items-center gap-1 text-[var(--color-muted)]">{f.type === "trip" ? "出发" : f.type === "purchase" ? "需到货" : f.type === "deal" ? "下一步" : "截止"}<Input type="date" className="h-8 w-36" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>}
        {["item", "progress"].includes(f.type) && <Input className="h-8 w-40" value={f.waitingFor} onChange={(e) => setF({ ...f, waitingFor: e.target.value })} placeholder="在等谁（可空）" />}
        {f.type === "progress" && <label className="flex items-center gap-1"><input type="checkbox" checked={f.done} onChange={(e) => setF({ ...f, done: e.target.checked })} />已办完</label>}
      </div>
      {d.evidence && <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">依据：「{d.evidence}」</p>}
      <div className="mt-2 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => post({ action: "reject", id: d.id }).then((r) => r.ok && router.refresh())}><X /> 不要</Button>
        <Button size="sm" onClick={confirm}><Check /> 确认</Button>
      </div>
    </div>
  );
}
