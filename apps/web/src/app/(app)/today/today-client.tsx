"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sun, Gavel, Hourglass, CalendarClock, Snail, Plus, Check, ArrowRight, Bell, X, Target, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

type TItem = { id: string; title: string; projectId: string; projectName: string; status: string; priority: string; dueAt: number | null; plannedFor: string; rollCount: number; why: string; waitingFor: string; blockReason: string };
type Data = {
  date: string; today: TItem[];
  waiting: Array<{ id: string; title: string; projectId: string; projectName: string; waitingFor: string; delegatedAt: number | null; followUpAt: number | null; waitedDays: number | null; nudge: boolean }>;
  decisions: Array<{ kind: string; label: string; title: string; detail: string; href: string; targetId: string }>;
  upcoming: Array<{ id: string; kind: string; title: string; start: number; href: string; tone: string; note?: string }>;
  stale: Array<{ id: string; title: string; projectId: string; projectName: string; status: string; rollCount: number; idleDays: number; reason: string }>;
  top3: Array<{ title: string; itemId?: string; status: string | null }>; reviewStatus: string | null;
  counts: Record<string, number>;
  candidates: Array<{ id: string; title: string; projectName: string; priority: string; dueAt: number | null }>;
};

const WHY: Record<string, { label: string; tone: "danger" | "warn" | "brand" | "default" }> = {
  overdue: { label: "逾期", tone: "danger" }, due_today: { label: "今天到期", tone: "warn" }, planned: { label: "计划", tone: "brand" },
  doing: { label: "进行中", tone: "default" }, p0: { label: "P0", tone: "warn" },
};

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/ui/today", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false, error: "网络错误" }));
  if (!r.ok) toast.error(r.error ?? "失败");
  return r.ok as boolean;
}
const md = (sec: number) => { const d = new Date(sec * 1000); return `${d.getMonth() + 1}/${d.getDate()}`; };

export function TodayClient({ data }: { data: Data }) {
  const router = useRouter();
  const [doneFor, setDoneFor] = useState<TItem | null>(null);
  const [waitFor, setWaitFor] = useState<TItem | null>(null);
  const [picker, setPicker] = useState(false);
  const act = async (body: Record<string, unknown>, msg?: string) => { if (await post(body)) { if (msg) toast.success(msg); router.refresh(); } };
  const weekday = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wider text-[var(--color-muted)]">{weekday}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">今日</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {data.counts.today} 件要做 · {data.counts.decisions} 件等你拍板 · 在等 {data.counts.waiting} 件{data.counts.nudge ? `（${data.counts.nudge} 件该催了）` : ""}
          </p>
        </div>
        <Link href="/review" className="rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-3 py-2 text-sm hover:bg-[var(--color-brand-soft)]/50">每周复盘 →</Link>
      </header>

      <Top3 data={data} />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <Section icon={<Sun />} title="今天做什么" extra={<Button size="sm" variant="outline" onClick={() => setPicker(true)}><Plus /> 加入今天</Button>}>
            {data.today.length === 0 ? <Empty text="今天没有到期和计划的事。从右上角「加入今天」挑几件。" /> : (
              <ul className="divide-y divide-[var(--color-line)]">
                {data.today.map((i) => (
                  <li key={i.id} className="flex items-start gap-2 py-2.5">
                    <button title="完成" onClick={() => setDoneFor(i)} className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 border-[var(--color-line)] hover:border-[var(--color-ok)] hover:bg-[var(--color-ok)]/10"><Check className="size-3 opacity-0 hover:opacity-100" /></button>
                    <div className="min-w-0 flex-1">
                      <Link href={`/p/${i.projectId}?tab=checklist`} className="text-sm font-medium hover:underline">{i.title}</Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
                        <Badge tone={WHY[i.why]?.tone}>{WHY[i.why]?.label}</Badge>
                        {i.projectName && <span>{i.projectName}</span>}
                        {i.dueAt && <span>截止 {md(i.dueAt)}</span>}
                        {i.status === "blocked" && <span className="text-[var(--color-danger)]">卡住：{i.blockReason}</span>}
                        {i.rollCount >= 3 && <span className="text-[var(--color-warn)]">已拖 {i.rollCount} 天</span>}
                      </div>
                    </div>
                    <RowMenu onPick={(a) => a === "wait" ? setWaitFor(i) : act({ action: a, id: i.id }, a === "tomorrow" ? "挪到明天" : a === "defer" ? "先放一周" : a === "unplan" ? "已移出今天" : "已放弃")} planned={i.why === "planned"} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={<Hourglass />} title="在等别人" hint="交出去的事。到日子会提醒你去催">
            {data.waiting.length === 0 ? <Empty text="没有在等的事。事情交给别人或在等审核时，在事项菜单里选「在等别人」。" /> : (
              <ul className="divide-y divide-[var(--color-line)]">
                {data.waiting.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link href={`/p/${w.projectId}?tab=checklist`} className="text-sm font-medium hover:underline">{w.title}</Link>
                      <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                        等 <span className="font-medium text-[var(--color-fg)]">{w.waitingFor}</span>{w.waitedDays != null && ` · 已 ${w.waitedDays} 天`}{w.followUpAt && ` · ${md(w.followUpAt)} 催`} · {w.projectName}
                      </p>
                    </div>
                    {w.nudge && <Badge tone="warn"><Bell className="size-3" />该催了</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => act({ action: "nudged", id: w.id }, "已记录催办，3 天后再提醒")}>催过了</Button>
                    <Button size="sm" variant="ghost" onClick={() => act({ action: "unwait", id: w.id, note: `${w.waitingFor} 已回复` }, "已收到回复")}>有回复了</Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {data.stale.length > 0 && (
            <Section icon={<Snail />} title="拖着没动" hint="一拖再拖或两周没动静：做个决定">
              <ul className="divide-y divide-[var(--color-line)]">
                {data.stale.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link href={`/p/${x.projectId}?tab=checklist`} className="text-sm hover:underline">{x.title}</Link>
                      <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{x.reason === "rolled" ? `连续 ${x.rollCount} 天计划了没做` : `${x.idleDays} 天没有动静`} · {x.projectName}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => act({ action: "plan", id: x.id }, "放进今天")}>今天做</Button>
                    <Button size="sm" variant="ghost" onClick={() => act({ action: "defer", id: x.id, days: 14 }, "先放两周")}>先放放</Button>
                    <Button size="sm" variant="ghost" className="text-[var(--color-danger)]" onClick={() => act({ action: "drop", id: x.id }, "已放弃")}>不做了</Button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Section icon={<Gavel />} title="需要你拍板" hint="只有你能定的事">
            {data.decisions.length === 0 ? <Empty text="没有待你决定的事。" /> : (
              <ul className="flex flex-col gap-1.5">
                {data.decisions.map((d) => (
                  <li key={d.kind + d.targetId}>
                    <Link href={d.href} className="group block rounded-lg border border-[var(--color-line)] p-2.5 hover:bg-[var(--color-brand-soft)]/30">
                      <div className="flex items-center gap-1.5"><Badge tone={d.kind === "blocked" ? "danger" : "brand"}>{d.label}</Badge><ArrowRight className="ml-auto size-3.5 text-[var(--color-muted)] group-hover:text-[var(--color-brand)]" /></div>
                      <p className="mt-1 text-[13px] font-medium">{d.title}</p>
                      {d.detail && <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--color-muted)]">{d.detail}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section icon={<CalendarClock />} title="7 天内">
            {data.upcoming.length === 0 ? <Empty text="未来一周没有到期的台账、合作、采购或行程。" /> : (
              <ul className="flex flex-col gap-1">
                {data.upcoming.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-[12px]">
                    <span className={`w-10 shrink-0 tabular-nums ${e.tone === "danger" ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"}`}>{md(e.start)}</span>
                    <Link href={e.href} className="truncate hover:underline">{e.title}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <DoneDialog item={doneFor} onClose={() => setDoneFor(null)} onDone={(ev) => act({ action: "done", id: doneFor!.id, evidence: ev }, "已完成").then(() => setDoneFor(null))} />
      <WaitDialog item={waitFor} onClose={() => setWaitFor(null)} onSave={(w, days) => act({ action: "wait", id: waitFor!.id, waiting_for: w, days }, `${days} 天后提醒你去催`).then(() => setWaitFor(null))} />
      <Picker open={picker} onClose={() => setPicker(false)} candidates={data.candidates} onAdd={(ids) => act({ action: "plan", ids }, `已加入今天 ${ids.length} 件`).then(() => setPicker(false))} />
    </div>
  );
}

function Top3({ data }: { data: Data }) {
  if (!data.top3.length) return (
    <Link href="/review" className="mb-4 flex items-center gap-2 rounded-xl border border-dashed border-[var(--color-line)] p-3 text-sm text-[var(--color-muted)] hover:bg-[var(--color-brand-soft)]/20"><Target className="size-4" />本周还没定三件最重要的事 → 去复盘定一下</Link>
  );
  return (
    <div className="mb-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-muted)]"><Target className="size-3.5" />本周三件事{data.reviewStatus === "draft" && <Badge tone="warn">agent 草稿，待你确认</Badge>}</p>
      <ol className="keep-cols grid gap-2 sm:grid-cols-3">
        {data.top3.map((x, i) => (
          <li key={i} className={`flex items-start gap-2 rounded-lg bg-[var(--color-line)]/25 p-2 text-[13px] ${x.status === "done" ? "text-[var(--color-muted)] line-through" : ""}`}>
            <span className="font-semibold text-[var(--color-brand)]">{i + 1}</span>{x.title}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Section({ icon, title, hint, extra, children }: { icon: React.ReactNode; title: string; hint?: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card><CardContent className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[var(--color-brand)] [&_svg]:size-4">{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="hidden text-[11px] text-[var(--color-muted)] sm:inline">{hint}</span>}
        <span className="ml-auto">{extra}</span>
      </div>
      {children}
    </CardContent></Card>
  );
}
const Empty = ({ text }: { text: string }) => <p className="py-3 text-[12px] text-[var(--color-muted)]">{text}</p>;

function RowMenu({ onPick, planned }: { onPick: (a: string) => void; planned: boolean }) {
  const [open, setOpen] = useState(false);
  const opts = [["wait", "在等别人…"], ["tomorrow", "挪到明天"], ["defer", "先放一周"], ...(planned ? [["unplan", "移出今天"]] : []), ["drop", "不做了"]];
  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen(!open)} className="rounded-md p-1 text-[var(--color-muted)] hover:bg-[var(--color-line)]/40" aria-label="更多"><MoreHorizontal className="size-4" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] py-1 shadow-lg">
            {opts.map(([k, l]) => <button key={k} onClick={() => { setOpen(false); onPick(k); }} className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[var(--color-brand-soft)]/50 ${k === "drop" ? "text-[var(--color-danger)]" : ""}`}>{l}</button>)}
          </div>
        </>
      )}
    </div>
  );
}

function DoneDialog({ item, onClose, onDone }: { item: TItem | null; onClose: () => void; onDone: (ev: string) => void }) {
  const [ev, setEv] = useState("");
  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) { onClose(); setEv(""); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>完成：{item?.title}</DialogTitle><DialogDescription>一句话写清做到了什么程度（结果、编号、链接都行），以后翻得到。</DialogDescription></DialogHeader>
        <Input autoFocus value={ev} onChange={(e) => setEv(e.target.value)} placeholder="如：已提交并审核通过，备案号 京ICP备…" onKeyDown={(e) => e.key === "Enter" && ev.trim() && onDone(ev)} />
        <DialogFooter><Button variant="ghost" onClick={onClose}>取消</Button><Button disabled={!ev.trim()} onClick={() => { onDone(ev); setEv(""); }}>完成</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WaitDialog({ item, onClose, onSave }: { item: TItem | null; onClose: () => void; onSave: (w: string, days: number) => void }) {
  const [w, setW] = useState("");
  const [days, setDays] = useState(3);
  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) { onClose(); setW(""); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>在等别人：{item?.title}</DialogTitle><DialogDescription>记下在等谁，到日子提醒你去催。等审核、等客户回复、等发货都算。</DialogDescription></DialogHeader>
        <Input autoFocus value={w} onChange={(e) => setW(e.target.value)} placeholder="在等谁：如 管局审核 / 王经理 / 京东发货" />
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-[var(--color-muted)]">几天后催：</span>
          {[1, 3, 7, 14].map((d) => <button key={d} onClick={() => setDays(d)} className={`rounded-md px-2.5 py-1 ${days === d ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]" : "border border-[var(--color-line)]"}`}>{d} 天</button>)}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>取消</Button><Button disabled={!w.trim()} onClick={() => { onSave(w, days); setW(""); }}>记下</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Picker({ open, onClose, candidates, onAdd }: { open: boolean; onClose: () => void; candidates: Data["candidates"]; onAdd: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const rows = candidates.filter((c) => !q || c.title.includes(q) || c.projectName.includes(q));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setSel([]); } }}>
      <DialogContent className="max-h-[85vh] overflow-hidden">
        <DialogHeader><DialogTitle>加入今天</DialogTitle><DialogDescription>只挑今天真会做的。没做完明天会自动顺延，连拖 3 天会问你要不要放弃。</DialogDescription></DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索事项或项目" />
        <ul className="-mx-1 max-h-[50vh] overflow-y-auto">
          {rows.length === 0 && <li className="p-4 text-center text-[12px] text-[var(--color-muted)]">没有可加入的事项</li>}
          {rows.map((c) => {
            const on = sel.includes(c.id);
            return (
              <li key={c.id}>
                <button onClick={() => setSel(on ? sel.filter((x) => x !== c.id) : [...sel, c.id])} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${on ? "bg-[var(--color-brand-soft)]" : "hover:bg-[var(--color-line)]/30"}`}>
                  <span className={`grid size-4 shrink-0 place-items-center rounded border ${on ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white" : "border-[var(--color-line)]"}`}>{on && <Check className="size-3" />}</span>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-[11px] text-[var(--color-muted)]">{c.priority} · {c.projectName}{c.dueAt ? ` · ${md(c.dueAt)}` : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <DialogFooter><Button variant="ghost" onClick={onClose}><X /> 取消</Button><Button disabled={!sel.length} onClick={() => { onAdd(sel); setSel([]); }}>加入 {sel.length || ""}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
