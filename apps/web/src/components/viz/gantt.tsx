"use client";
import { useMemo } from "react";
import { Gantt, Willow, WillowDark } from "@svar-ui/react-gantt";
import "@svar-ui/react-gantt/all.css";

export type GanttPhase = { id: string; name: string; startAt: number | null; dueAt: number | null; done: number; total: number };
export type GanttItem = { id: string; title: string; milestoneId: string | null; startAt: number | null; dueAt: number | null; createdAt: number; completedAt: number | null; status: string; leadTimeDays: number | null };
export type GanttDep = { blockerId: string; blockedId: string };

const DAY = 86400;
const d = (s: number) => new Date(s * 1000);

/**
 * 甘特视图（只读）：阶段为汇总行，事项挂在阶段下，依赖画成连线。
 * 没有日期的事项：开始取创建时间，时长取办理周期或 1 天 —— 标为「未排期」，提醒去补日期。
 */
export default function GanttView({ phases, items, deps, dark }: { phases: GanttPhase[]; items: GanttItem[]; deps: GanttDep[]; dark?: boolean }) {
  const { tasks, links, markers } = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const tasks: Array<Record<string, unknown>> = [];
    const span = (it: GanttItem) => {
      const start = it.startAt ?? (it.dueAt && it.leadTimeDays ? it.dueAt - it.leadTimeDays * DAY : it.createdAt);
      const end = Math.max(start + DAY, it.dueAt ?? it.completedAt ?? start + Math.max(1, it.leadTimeDays ?? 1) * DAY);
      return { start, end, scheduled: !!(it.startAt || it.dueAt) };
    };
    for (const p of phases) {
      const its = items.filter((i) => i.milestoneId === p.id).map((i) => ({ i, s: span(i) }));
      const start = p.startAt ?? (its.length ? Math.min(...its.map((x) => x.s.start)) : now);
      const end = Math.max(start + DAY, p.dueAt ?? (its.length ? Math.max(...its.map((x) => x.s.end)) : start + 7 * DAY));
      tasks.push({ id: `ms:${p.id}`, text: p.name, sched: "", start: d(start), end: d(end), type: "summary", open: true, progress: p.total ? Math.round((p.done / p.total) * 100) : 0, parent: 0 });
      for (const { i, s } of its) {
        tasks.push({ id: i.id, text: i.title, sched: s.scheduled ? "" : "未排期", start: d(s.start), end: d(s.end), type: "task", parent: `ms:${p.id}`, progress: i.status === "done" ? 100 : i.status === "doing" ? 40 : 0 });
      }
    }
    const loose = items.filter((i) => !i.milestoneId || !phases.some((p) => p.id === i.milestoneId));
    if (loose.length) {
      const ss = loose.map((i) => span(i));
      tasks.push({ id: "ms:none", text: "未分阶段", sched: "", start: d(Math.min(...ss.map((x) => x.start))), end: d(Math.max(...ss.map((x) => x.end))), type: "summary", open: false, parent: 0 });
      loose.forEach((i, k) => tasks.push({ id: i.id, text: i.title, sched: ss[k].scheduled ? "" : "未排期", start: d(ss[k].start), end: d(ss[k].end), type: "task", parent: "ms:none", progress: i.status === "done" ? 100 : 0 }));
    }
    const ids = new Set(tasks.map((t) => t.id));
    const links = deps.filter((x) => ids.has(x.blockerId) && ids.has(x.blockedId)).map((x, k) => ({ id: k + 1, source: x.blockerId, target: x.blockedId, type: "e2s" as const }));
    return { tasks, links, markers: [{ start: d(now), text: "今天" }] };
  }, [phases, items, deps]);

  const Theme = dark ? WillowDark : Willow;
  const md = (v: unknown) => (v instanceof Date ? `${v.getMonth() + 1}/${v.getDate()}` : "");
  const columns = [
    { id: "text", header: "阶段 / 事项", width: 230 },
    { id: "end", header: "截止", width: 56, align: "center" as const, template: md },
    { id: "sched", header: "", width: 52, align: "center" as const },
  ];
  const scales = [
    { unit: "month" as const, step: 1, format: (dt: Date) => `${dt.getFullYear()}年${dt.getMonth() + 1}月` },
    { unit: "week" as const, step: 1, format: (dt: Date) => `${dt.getMonth() + 1}/${dt.getDate()}` },
  ];
  if (!tasks.length) return <p className="py-10 text-center text-sm text-[var(--color-muted)]">还没有阶段和事项。</p>;
  return (
    <div className="h-[560px] overflow-hidden rounded-xl border border-[var(--color-line)]">
      <Theme fonts={false}>
        <Gantt tasks={tasks as never} links={links as never} scales={scales as never} columns={columns as never} markers={markers} readonly cellWidth={40} cellHeight={34} scaleHeight={30} />
      </Theme>
    </div>
  );
}