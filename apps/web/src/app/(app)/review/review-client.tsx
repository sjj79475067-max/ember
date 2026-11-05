"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Hourglass, Snail, Inbox, FolderX, Target, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { toast } from "sonner";

type T3 = { title: string; itemId?: string; status?: string | null };
type Data = {
  week: string; thisWeek: string; inboxId: string | null;
  done: Array<{ projectId: string; projectName: string; titles: string[] }>;
  stats: { done: number; created: number; dropped: number; slipped: number };
  dropped: Array<{ id: string; title: string }>; slipped: Array<{ id: string; title: string; dueAt: number }>;
  noNextProjects: Array<{ id: string; name: string }>; inboxCount: number;
  waiting: Array<{ id: string; title: string; projectName: string; waitingFor: string; waitedDays: number | null; nudge: boolean }>;
  stale: Array<{ id: string; title: string; projectName: string; reason: string; rollCount: number; idleDays: number }>;
  prevTop3: T3[];
  review: { status: string; top3: T3[]; notesMd: string; author: string } | null;
  options: Array<{ id: string; title: string; projectName: string; priority: string }>;
};

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/ui/today", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false, error: "网络错误" }));
  if (!r.ok) toast.error(r.error ?? "失败");
  return r.ok as boolean;
}
function shift(week: string, days: number) {
  const [y, m, d] = week.split("-").map(Number);
  const x = new Date(y, m - 1, d + days, 12);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export function ReviewClient({ data }: { data: Data }) {
  const router = useRouter();
  const [top3, setTop3] = useState<T3[]>(() => { const t = data.review?.top3 ?? []; return [...t, ...Array(3 - t.length).fill({ title: "" })].slice(0, 3); });
  const [notes, setNotes] = useState(data.review?.notesMd ?? "");
  const act = async (body: Record<string, unknown>, msg: string) => { if (await post(body)) { toast.success(msg); router.refresh(); } };
  const end = shift(data.week, 6);
  const isCurrent = data.week === data.thisWeek;

  async function save() {
    const list = top3.filter((x) => x.title.trim());
    if (!list.length) return toast.error("至少写一件下周最重要的事");
    if (await post({ action: "review", week: data.week, top3: list, notes })) { toast.success("复盘已保存"); router.refresh(); }
  }

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">每周复盘</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">三步：看看这周做了什么 → 把挂着的事清一遍 → 定下周三件事。十分钟就够。</p>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <button onClick={() => router.push(`/review?week=${shift(data.week, -7)}`)} title="上一周" aria-label="上一周" className="rounded-md p-1.5 hover:bg-[var(--color-line)]/40"><ChevronLeft className="size-4" /></button>
          <span className="tabular-nums">{data.week.slice(5)} ~ {end.slice(5)}{isCurrent && " · 本周"}</span>
          <button disabled={isCurrent} onClick={() => router.push(`/review?week=${shift(data.week, 7)}`)} title="下一周" aria-label="下一周" className="rounded-md p-1.5 hover:bg-[var(--color-line)]/40 disabled:opacity-30"><ChevronRight className="size-4" /></button>
        </div>
      </header>

      <Step n={1} title="这周做了什么">
        <div className="keep-cols mb-3 grid grid-cols-4 gap-2">
          <Stat label="完成" v={data.stats.done} tone="ok" /><Stat label="新增" v={data.stats.created} /><Stat label="延期" v={data.stats.slipped} tone={data.stats.slipped ? "warn" : undefined} /><Stat label="放弃" v={data.stats.dropped} />
        </div>
        {data.prevTop3.length > 0 && (
          <div className="mb-3 rounded-lg bg-[var(--color-line)]/25 p-2.5 text-[13px]">
            <p className="mb-1 text-[11px] font-semibold text-[var(--color-muted)]">上周定的三件事</p>
            {data.prevTop3.map((x, i) => <p key={i}>{x.status === "done" ? "✅" : x.status ? "⬜" : "•"} {x.title}</p>)}
          </div>
        )}
        {data.done.length === 0 ? <p className="text-[12px] text-[var(--color-muted)]">这周还没有完成的事项。</p> : (
          <div className="grid gap-2 sm:grid-cols-2">
            {data.done.map((g) => (
              <div key={g.projectId} className="rounded-lg border border-[var(--color-line)] p-2.5">
                <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold"><CheckCircle2 className="size-3.5 text-[var(--color-ok)]" />{g.projectName}<span className="font-normal text-[var(--color-muted)]">{g.titles.length}</span></p>
                <ul className="list-disc pl-5 text-[12px] leading-5">{g.titles.slice(0, 8).map((t, i) => <li key={i}>{t}</li>)}{g.titles.length > 8 && <li className="text-[var(--color-muted)]">还有 {g.titles.length - 8} 件</li>}</ul>
              </div>
            ))}
          </div>
        )}
        {data.slipped.length > 0 && <p className="mt-2 text-[12px] text-[var(--color-warn)]">延期：{data.slipped.map((x) => x.title).join("、")}</p>}
      </Step>

      <Step n={2} title="把挂着的事清一遍">
        <div className="flex flex-col gap-3">
          <Block icon={<Hourglass />} title={`在等别人（${data.waiting.length}）`} empty="没有在等的事">
            {data.waiting.map((w) => (
              <Row key={w.id} title={w.title} sub={`等 ${w.waitingFor}${w.waitedDays != null ? ` · ${w.waitedDays} 天` : ""} · ${w.projectName}`} badge={w.nudge ? <Badge tone="warn">该催了</Badge> : null}>
                <Button size="sm" variant="ghost" onClick={() => act({ action: "nudged", id: w.id }, "已记录催办")}>催过了</Button>
                <Button size="sm" variant="ghost" onClick={() => act({ action: "unwait", id: w.id, note: `${w.waitingFor} 已回复` }, "已收到回复")}>有回复了</Button>
                <Button size="sm" variant="ghost" className="text-[var(--color-danger)]" onClick={() => act({ action: "drop", id: w.id, note: "复盘：不等了" }, "已放弃")}>不等了</Button>
              </Row>
            ))}
          </Block>
          <Block icon={<Snail />} title={`拖着没动（${data.stale.length}）`} empty="没有拖着的事">
            {data.stale.map((x) => (
              <Row key={x.id} title={x.title} sub={`${x.reason === "rolled" ? `连拖 ${x.rollCount} 天` : `${x.idleDays} 天没动`} · ${x.projectName}`}>
                <Button size="sm" variant="ghost" onClick={() => act({ action: "tomorrow", id: x.id }, "排到明天")}>排明天</Button>
                <Button size="sm" variant="ghost" onClick={() => act({ action: "defer", id: x.id, days: 30 }, "先放一个月")}>放一个月</Button>
                <Button size="sm" variant="ghost" className="text-[var(--color-danger)]" onClick={() => act({ action: "drop", id: x.id }, "已放弃")}>不做了</Button>
              </Row>
            ))}
          </Block>
          {(data.inboxCount > 0 || data.noNextProjects.length > 0) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {data.inboxCount > 0 && data.inboxId && <Link href={`/p/${data.inboxId}?tab=checklist`} className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] p-2.5 text-[13px] hover:bg-[var(--color-brand-soft)]/30"><Inbox className="size-4 text-[var(--color-brand)]" />收件箱还有 {data.inboxCount} 条没分拣 →</Link>}
              {data.noNextProjects.length > 0 && (
                <div className="rounded-lg border border-[var(--color-line)] p-2.5 text-[13px]">
                  <p className="flex items-center gap-1.5"><FolderX className="size-4 text-[var(--color-warn)]" />这些项目没有下一步：</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">{data.noNextProjects.map((p) => <Link key={p.id} href={`/p/${p.id}`} className="text-[var(--color-brand)] hover:underline">{p.name}</Link>)}</p>
                  <p className="mt-1 text-[11px] text-[var(--color-muted)]">加一件下一步要做的事，或者把项目暂停/归档。</p>
                </div>
              )}
            </div>
          )}
        </div>
      </Step>

      <Step n={3} title="定下周三件事">
        {data.review?.status === "draft" && <p className="mb-2 text-[12px] text-[var(--color-warn)]">这是 {data.review.author} 起草的，改好后点保存才生效。</p>}
        {data.review?.status === "done" && <p className="mb-2 text-[12px] text-[var(--color-ok)]">已确认。可以随时改。</p>}
        <div className="flex flex-col gap-2">
          {top3.map((x, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-4 text-center font-semibold text-[var(--color-brand)]">{i + 1}</span>
              <Input className="flex-1" value={x.title} onChange={(e) => setTop3(top3.map((y, j) => (j === i ? { title: e.target.value, itemId: y.itemId && e.target.value === y.title ? y.itemId : undefined } : y)))} placeholder="写一件事，或从右边选已有事项" />
              <select className="h-9 w-36 shrink-0 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-[12px] sm:w-56" value={x.itemId ?? ""} onChange={(e) => { const o = data.options.find((z) => z.id === e.target.value); setTop3(top3.map((y, j) => (j === i ? (o ? { title: o.title, itemId: o.id } : { title: y.title }) : y))); }}>
                <option value="">从事项里选…</option>
                {data.options.map((o) => <option key={o.id} value={o.id}>{o.priority} {o.title}（{o.projectName}）</option>)}
              </select>
              {x.title && <button onClick={() => setTop3(top3.map((y, j) => (j === i ? { title: "" } : y)))} title="清空这一条" aria-label="清空这一条" className="text-[var(--color-muted)] hover:text-[var(--color-danger)]"><Trash2 className="size-4" /></button>}
            </div>
          ))}
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="一句复盘：这周哪里顺、哪里卡、下周要改什么" />
          <div><Button onClick={save}><Target /> 保存复盘</Button></div>
        </div>
      </Step>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card className="mb-4"><CardContent className="p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><span className="grid size-6 place-items-center rounded-full bg-[var(--color-brand)] text-[12px] text-white">{n}</span>{title}</h2>
      {children}
    </CardContent></Card>
  );
}
function Stat({ label, v, tone }: { label: string; v: number; tone?: "ok" | "warn" }) {
  return <div className="rounded-lg bg-[var(--color-line)]/25 p-2 text-center"><p className={`text-lg font-semibold tabular-nums ${tone === "ok" ? "text-[var(--color-ok)]" : tone === "warn" ? "text-[var(--color-warn)]" : ""}`}>{v}</p><p className="text-[11px] text-[var(--color-muted)]">{label}</p></div>;
}
function Block({ icon, title, empty, children }: { icon: React.ReactNode; title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-[13px] font-medium [&_svg]:size-4 [&_svg]:text-[var(--color-brand)]">{icon}{title}</p>
      {children.length === 0 ? <p className="text-[12px] text-[var(--color-muted)]">{empty}</p> : <ul className="divide-y divide-[var(--color-line)]">{children}</ul>}
    </div>
  );
}
function Row({ title, sub, badge, children }: { title: string; sub: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-1.5 py-2">
      <div className="min-w-0 flex-1"><p className="text-[13px]">{title}</p><p className="text-[11px] text-[var(--color-muted)]">{sub}</p></div>
      {badge}{children}
    </li>
  );
}
