import Link from "next/link";
import { db, s } from "@/lib/db";
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { listProjects } from "@/lib/services/projects";
import { pullReminders } from "@/lib/services/reminders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDate, daysLeft, KIND_LABEL, STATUS_LABEL, REM_KIND_LABEL } from "@/lib/utils";
import { ArrowRight, AlertTriangle, CalendarClock, CheckCircle2, CircleDot, Inbox } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const projects = listProjects({});
  const active = projects.filter((p) => p.status === "active");
  const reminders = pullReminders({ limit: 8 });
  const now = Math.floor(Date.now() / 1000);
  const week = now + 7 * 86400;
  const upcoming = db.select().from(s.items)
    .where(and(isNotNull(s.items.dueAt), lte(s.items.dueAt, week), gte(s.items.dueAt, 0), sql`${s.items.status} not in ('done','dropped')`))
    .orderBy(s.items.dueAt).limit(8).all();
  const recentMeetings = db.select().from(s.meetings).orderBy(desc(s.meetings.heldAt)).limit(4).all();
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

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
            {active.map((p) => (
              <Link key={p.id} href={`/p/${p.id}`}>
                <Card className="group h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{p.key} · {KIND_LABEL[p.kind]}</p>
                      </div>
                      <ArrowRight className="size-4 shrink-0 -translate-x-1 text-[var(--color-muted)] opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                    </div>
                    <Progress done={p.progress.done} total={p.progress.total} />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.progress.blocked > 0 && <Badge tone="danger">{p.progress.blocked} 阻塞</Badge>}
                      {p.progress.overdue > 0 && <Badge tone="warn">{p.progress.overdue} 逾期</Badge>}
                      {p.dueAt && <Badge>{fmtDate(p.dueAt)} 截止</Badge>}
                      {!p.progress.blocked && !p.progress.overdue && p.progress.total > 0 && <Badge tone="ok">进展正常</Badge>}
                      {p.progress.total === 0 && <Badge>暂无任务</Badge>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
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
            <h2 className="mb-2.5 text-sm font-semibold text-[var(--color-muted)]">7 天内到期</h2>
            <Card><CardContent className="divide-y divide-[var(--color-line)] p-0">
              {upcoming.length === 0 && <p className="p-4 text-sm text-[var(--color-muted)]">暂无</p>}
              {upcoming.map((it) => {
                const d = daysLeft(it.dueAt);
                return (
                  <Link key={it.id} href={`/p/${it.projectId}`} className="flex items-center justify-between gap-2 p-3 hover:bg-[var(--color-brand-soft)]/40">
                    <span className="truncate text-[13px]">{it.title}</span>
                    <Badge tone={(d ?? 0) < 0 ? "danger" : (d ?? 0) <= 1 ? "warn" : "default"}>{d! < 0 ? `逾期 ${-d!} 天` : `${d} 天`}</Badge>
                  </Link>
                );
              })}
            </CardContent></Card>
          </div>
        </section>
      </div>

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
