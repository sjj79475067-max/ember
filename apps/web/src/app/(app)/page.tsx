import Link from "next/link";
import { db, s } from "@/lib/db";
import { desc } from "drizzle-orm";
import { listProjects } from "@/lib/services/projects";
import { portfolioCards } from "@/lib/services/board";
import { agenda } from "@/lib/services/calendar";
import { HEALTH_LABEL, MS_STATUS_LABEL } from "@/lib/labels";
import { pullReminders } from "@/lib/services/reminders";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDate, KIND_LABEL, REM_KIND_LABEL } from "@/lib/utils";
import { ArrowRight, AlertTriangle, CalendarClock, CheckCircle2, CircleDot, Inbox } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const projects = listProjects({});
  const active = projects.filter((p) => p.status === "active");
  const reminders = pullReminders({ limit: 8 });
  const now = Math.floor(Date.now() / 1000);
  const soon = agenda(now - 86400, now + 7 * 86400).filter((e) => e.tone !== "ok").slice(0, 10);
  const recentMeetings = db.select().from(s.meetings).orderBy(desc(s.meetings.heldAt)).limit(4).all();
  type Card = { id: string; health: string; healthSource: string; updateMissing: boolean; current: string | null; release: { name: string; mustDone: number; mustTotal: number; ready: boolean; daysLeft: number | null } | null; waiting: number; phases: Array<{ name: string; status: string; startAt: number | null; dueAt: number | null; done: number; total: number }> };
  const cards = new Map((portfolioCards() as Card[]).map((c) => [c.id, c]));
  const totals = active.reduce((a, p) => ({ total: a.total + p.progress.total, done: a.done + p.progress.done, blocked: a.blocked + p.progress.blocked, overdue: a.overdue + p.progress.overdue }), { total: 0, done: 0, blocked: 0, overdue: 0 });

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">{new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">总览</h1>
        </div>
        <Link href="/import" className="rounded-lg bg-[var(--color-brand)] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:brightness-110">导入会议 / 资料</Link>
      </header>

      <div className="keep-cols mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<CircleDot />} label="进行中项目" value={active.length} />
        <Stat icon={<CheckCircle2 />} label="已完成任务" value={`${totals.done}/${totals.total}`} tone="ok" />
        <Stat icon={<AlertTriangle />} label="阻塞" value={totals.blocked} tone={totals.blocked ? "danger" : "default"} />
        <Stat icon={<CalendarClock />} label="逾期" value={totals.overdue} tone={totals.overdue ? "danger" : "default"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-2.5 text-sm font-semibold text-[var(--color-muted)]">项目进度</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {active.length === 0 && <Empty text="还没有项目。从右上角导入会议记录开始，或在「项目」页新建。" />}
            {active.map((p) => {
              const c = cards.get(p.id);
              const h = c ? HEALTH_LABEL[c.health] : null;
              return (
              <Link key={p.id} href={`/p/${p.id}`}>
                <Card className="group h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          {h && <span title={`健康：${h.label}${c?.healthSource === "system" ? "（系统判断）" : ""}`} className={`size-2 shrink-0 rounded-full ${h.tone === "ok" ? "bg-[var(--color-ok)]" : h.tone === "warn" ? "bg-[var(--color-warn)]" : "bg-[var(--color-danger)]"}`} />}
                          {p.name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{p.key} · {KIND_LABEL[p.kind]}{c?.current ? ` · 当前：${c.current}` : ""}</p>
                      </div>
                      <ArrowRight className="size-4 shrink-0 -translate-x-1 text-[var(--color-muted)] opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                    </div>
                    {c && c.phases.length > 0 ? (
                      <div className="mt-3 flex gap-0.5" title="阶段进度">
                        {c.phases.map((ph) => (
                          <div key={ph.name} className="min-w-0 flex-1" title={`${ph.name} · ${MS_STATUS_LABEL[ph.status]} · ${ph.done}/${ph.total}`}>
                            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]"><div className={`h-full ${ph.status === "done" ? "bg-[var(--color-ok)]" : "bg-[var(--color-brand)]"}`} style={{ width: `${ph.status === "done" ? 100 : ph.total ? Math.round((ph.done / ph.total) * 100) : 0}%` }} /></div>
                            <p className={`mt-1 truncate text-[10px] ${ph.status === "active" ? "font-medium text-[var(--color-fg)]" : "text-[var(--color-muted)]"}`}>{ph.name}</p>
                          </div>
                        ))}
                      </div>
                    ) : <Progress done={p.progress.done} total={p.progress.total} />}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c?.release && (c.release.ready ? <Badge tone="ok">「{c.release.name}」可评审放行</Badge> : c.release.mustTotal > 0 ? <Badge tone="brand">发「{c.release.name}」还差 {c.release.mustTotal - c.release.mustDone} 项</Badge> : null)}
                      {p.progress.blocked > 0 && <Badge tone="danger">{p.progress.blocked} 阻塞</Badge>}
                      {p.progress.overdue > 0 && <Badge tone="warn">{p.progress.overdue} 逾期</Badge>}
                      {c && c.waiting > 0 && <Badge tone="warn">{c.waiting} 等前置</Badge>}
                      {c?.updateMissing && c.phases.length > 0 && <Badge>该发进展了</Badge>}
                      {p.progress.total === 0 && <Badge>暂无任务</Badge>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-5">
          <div>
            <h2 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-[var(--color-muted)]"><Inbox className="size-4" /> 提醒收件箱</h2>
            <Card>
              <CardContent className="divide-y divide-[var(--color-line)] p-0">
                {reminders.length === 0 && <p className="p-4 text-sm text-[var(--color-muted)]">暂无提醒，很好。</p>}
                {reminders.map((r) => (
                  <div key={r.id} className="flex items-start gap-2.5 p-3">
                    <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${r.severity === "P0" ? "bg-[var(--color-danger)]" : r.severity === "P1" ? "bg-[var(--color-warn)]" : "bg-[var(--color-muted)]"}`} />
                    <div className="min-w-0">
                      <p className="truncate text-[13px]">{r.title}</p>
                      <p className="text-[11px] text-[var(--color-muted)]">{REM_KIND_LABEL[r.kind]} · {r.severity}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
          <div>
            <h2 className="mb-2.5 flex items-center justify-between text-sm font-semibold text-[var(--color-muted)]">未来 7 天<Link href="/affairs?tab=calendar" className="text-[11px] font-normal text-[var(--color-brand)] hover:underline">日历</Link></h2>
            <Card><CardContent className="divide-y divide-[var(--color-line)] p-0">
              {soon.length === 0 && <p className="p-4 text-sm text-[var(--color-muted)]">暂无</p>}
              {soon.map((e) => {
                const d = Math.ceil((e.start - now) / 86400);
                return (
                  <Link key={e.id} href={e.href} className="flex items-center justify-between gap-2 p-3 hover:bg-[var(--color-brand-soft)]/40">
                    <span className="min-w-0 truncate text-[13px]">{e.title}</span>
                    <Badge tone={d < 0 ? "danger" : d <= 1 ? "warn" : "default"}>{d < 0 ? `逾期 ${-d} 天` : d === 0 ? "今天" : `${d} 天`}</Badge>
                  </Link>
                );
              })}
            </CardContent></Card>
          </div>
        </section>
      </div>

      <PortfolioTimeline rows={active.map((p) => ({ id: p.id, name: p.name, phases: cards.get(p.id)?.phases ?? [] })).filter((r) => r.phases.some((x) => x.startAt || x.dueAt))} />

      <section className="mt-8">
        <h2 className="mb-2.5 text-sm font-semibold text-[var(--color-muted)]">最近会议</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {recentMeetings.length === 0 && <Empty text="还没有会议档案。" />}
          {recentMeetings.map((m) => (
            <Link key={m.id} href={`/meetings/${m.id}`}>
              <Card className="h-full hover:shadow-md">
                <CardContent className="p-4">
                  <p className="line-clamp-1 text-sm font-medium">{m.title}</p>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--color-muted)]">{m.summaryMd || m.minutesMd.slice(0, 80)}</p>
                  <p className="mt-2 text-[11px] text-[var(--color-muted)]">{fmtDate(m.heldAt)} · {m.source}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/** 全部项目的阶段时间线（纯 CSS，不加载图表库）：今天为竖线，前 2 周到后 12 周 */
function PortfolioTimeline({ rows }: { rows: Array<{ id: string; name: string; phases: Array<{ name: string; status: string; startAt: number | null; dueAt: number | null }> }> }) {
  if (!rows.length) return null;
  const DAY = 86400;
  const now = Math.floor(Date.now() / 1000);
  const from = now - 14 * DAY, to = now + 84 * DAY;
  const pos = (t: number) => Math.max(0, Math.min(100, ((t - from) / (to - from)) * 100));
  const weeks = Array.from({ length: 15 }, (_, i) => from + i * 7 * DAY);
  return (
    <section className="mt-8">
      <h2 className="mb-2.5 text-sm font-semibold text-[var(--color-muted)]">项目时间线（未来 12 周）</h2>
      <Card><CardContent className="overflow-x-auto p-4">
        <div className="min-w-[640px]">
          <div className="relative ml-36 h-5 text-[10px] text-[var(--color-muted)]">
            {weeks.map((w) => <span key={w} className="absolute -translate-x-1/2" style={{ left: `${pos(w)}%` }}>{new Date(w * 1000).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</span>)}
          </div>
          {rows.map((r) => (
            <div key={r.id} className="flex items-center border-t border-[var(--color-line)] py-1.5">
              <Link href={`/p/${r.id}?tab=plan`} className="w-36 shrink-0 truncate pr-2 text-[12px] hover:underline">{r.name}</Link>
              <div className="relative h-6 flex-1 rounded bg-[var(--color-line)]/20">
                <span className="absolute inset-y-0 w-px bg-[var(--color-danger)]" style={{ left: `${pos(now)}%` }} />
                {r.phases.filter((ph) => ph.startAt || ph.dueAt).map((ph) => {
                  const st = ph.startAt ?? (ph.dueAt! - 7 * DAY), en = ph.dueAt ?? (ph.startAt! + 7 * DAY);
                  if (en < from || st > to) return null;
                  const left = pos(st), width = Math.max(1.5, pos(en) - left);
                  const late = ph.dueAt && ph.dueAt < now && !["done", "cancelled"].includes(ph.status);
                  return <span key={ph.name} title={`${ph.name}：${fmtDate(st)} – ${fmtDate(en)}`} className={`absolute top-1 h-4 truncate rounded px-1 text-[10px] leading-4 text-white ${ph.status === "done" ? "bg-[var(--color-ok)]" : late ? "bg-[var(--color-danger)]" : ph.status === "active" ? "bg-[var(--color-brand)]" : "bg-[var(--color-muted)]/60"}`} style={{ left: `${left}%`, width: `${width}%` }}>{ph.name}</span>;
                })}
              </div>
            </div>
          ))}
        </div>
      </CardContent></Card>
    </section>
  );
}

function Stat({ icon, label, value, tone = "default" }: { icon: React.ReactNode; label: string; value: number | string; tone?: "default" | "ok" | "danger" }) {
  const color = tone === "ok" ? "text-[var(--color-ok)]" : tone === "danger" ? "text-[var(--color-danger)]" : "text-[var(--color-fg)]";
  return (
    <Card><CardContent className="flex items-center gap-3 p-4">
      <span className={`[&_svg]:size-5 ${color} opacity-90`}>{icon}</span>
      <div>
        <p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p>
        <p className="text-[11px] text-[var(--color-muted)]">{label}</p>
      </div>
    </CardContent></Card>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-[11px] text-[var(--color-muted)]"><span>{done}/{total} 项</span><span>{pct}%</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]"><div className="h-full rounded-full bg-[var(--color-brand)] transition-all" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-[var(--color-line)] p-6 text-center text-sm text-[var(--color-muted)]">{text}</div>;
}
