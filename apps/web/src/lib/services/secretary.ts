import { db, s } from "@/lib/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { agenda } from "./calendar";

/**
 * 秘书层：今日 / 在等别人 / 需要你拍板 / 快到期 / 拖着没动 / 每周复盘。
 * 全部从现有数据推导，网页、agent、简报用同一份结果。
 */

const DAY = 86400;
export const ROLL_WARN = 3; // 连续滚动 3 次 = 拖延
export const STALE_DAYS = 14;
const OPEN = ["todo", "doing", "blocked", "changed"];

type ItemRow = typeof s.items.$inferSelect;

/** 本地日期（容器 TZ=Asia/Shanghai），YYYY-MM-DD */
export function localYmd(sec = nowSec()) {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function endOfToday(sec = nowSec()) {
  const d = new Date(sec * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime() / 1000);
}
export function weekStartYmd(sec = nowSec()) {
  const d = new Date(sec * 1000);
  const back = (d.getDay() + 6) % 7;
  return localYmd(Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 12).getTime() / 1000));
}
function ymdToSec(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000);
}

function liveProjects() {
  return new Map(db.select().from(s.projects).all().filter((p) => p.status !== "archived").map((p) => [p.id, p]));
}
function openItems() {
  const projects = liveProjects();
  return db.select().from(s.items).where(sql`${s.items.status} in ('todo','doing','blocked','changed')`).all()
    .filter((i) => projects.has(i.projectId) && !i.supersededBy);
}

/** 计划日已过还没做完的，滚到今天，滚动次数 +1。幂等：同一天只滚一次。 */
export function rollOver(today = localYmd()) {
  const stale = db.select().from(s.items).where(and(sql`${s.items.plannedFor} != ''`, sql`${s.items.plannedFor} < ${today}`)).all();
  let rolled = 0;
  for (const i of stale) {
    if (!OPEN.includes(i.status)) {
      db.update(s.items).set({ plannedFor: "" }).where(eq(s.items.id, i.id)).run();
      continue;
    }
    db.update(s.items).set({ plannedFor: today, rollCount: i.rollCount + 1 }).where(eq(s.items.id, i.id)).run();
    rolled++;
  }
  return rolled;
}

export type TodayItem = {
  id: string; title: string; projectId: string; projectName: string; status: string; priority: string;
  dueAt: number | null; plannedFor: string; rollCount: number; why: "overdue" | "due_today" | "planned" | "doing";
  waitingFor: string; blockReason: string;
};

function brief(i: ItemRow, why: TodayItem["why"], names: Map<string, { name: string }>): TodayItem {
  return {
    id: i.id, title: i.title, projectId: i.projectId, projectName: names.get(i.projectId)?.name ?? "", status: i.status, priority: i.priority,
    dueAt: i.dueAt, plannedFor: i.plannedFor, rollCount: i.rollCount, why, waitingFor: i.waitingFor, blockReason: i.blockReason,
  };
}

const deferred = (i: ItemRow, t: number) => !!i.deferUntil && i.deferUntil > t;

/** 今天做什么：逾期 → 今天到期 → 今天计划 → 你自己在做的（未搁置、不在等别人） */
export function todayPlan() {
  const t = nowSec();
  const today = localYmd(t);
  rollOver(today);
  const eod = endOfToday(t);
  const names = liveProjects();
  const rows = openItems().filter((i) => i.parkingLot == null);
  const order = { overdue: 0, due_today: 1, planned: 2, doing: 3 } as const;
  const out: TodayItem[] = [];
  for (const i of rows) {
    const overdue = !!i.dueAt && i.dueAt < t;
    if (deferred(i, t) && !overdue) continue;
    let why: TodayItem["why"] | null = null;
    if (overdue) why = "overdue";
    else if (i.dueAt && i.dueAt <= eod) why = "due_today";
    else if (i.plannedFor === today) why = "planned";
    else if (i.waitingFor) why = null;
    else if (i.status === "doing" && (i.claimedBy === "user" || !i.claimedBy) && !i.ownerType) why = "doing";
    // P0 不自动进今天：今天做什么由你挑（P0 在「加入今天」里排最前）
    if (why) out.push(brief(i, why, names));
  }
  out.sort((a, b) => order[a.why] - order[b.why] || (a.dueAt ?? 9e12) - (b.dueAt ?? 9e12));
  return { date: today, items: out };
}

/** 在等别人：该催的排前面 */
export function waitingList() {
  const t = nowSec();
  const names = liveProjects();
  return openItems().filter((i) => i.waitingFor).map((i) => ({
    id: i.id, title: i.title, projectId: i.projectId, projectName: names.get(i.projectId)?.name ?? "", waitingFor: i.waitingFor,
    delegatedAt: i.delegatedAt, followUpAt: i.followUpAt,
    waitedDays: i.delegatedAt ? Math.floor((t - i.delegatedAt) / DAY) : null,
    nudge: !!i.followUpAt && i.followUpAt <= t,
  })).sort((a, b) => Number(b.nudge) - Number(a.nudge) || (a.followUpAt ?? 9e12) - (b.followUpAt ?? 9e12));
}

/** 拖着没动：滚动 ≥3 次，或 14 天没有任何动静（不含在等别人、已搁置、收件箱） */
export function staleWork() {
  const t = nowSec();
  const names = liveProjects();
  const inbox = [...names.values()].find((p) => p.isInbox === 1)?.id;
  const lastEvt = new Map(db.select({ itemId: s.itemEvents.itemId, at: sql<number>`max(${s.itemEvents.createdAt})` }).from(s.itemEvents).groupBy(s.itemEvents.itemId).all().map((r) => [r.itemId, r.at]));
  const out: Array<{ id: string; title: string; projectId: string; projectName: string; status: string; rollCount: number; idleDays: number; reason: "rolled" | "idle" }> = [];
  for (const i of openItems()) {
    if (i.parkingLot != null || i.projectId === inbox || i.waitingFor || deferred(i, t) || i.ownerType) continue;
    const last = Math.max(i.updatedAt, lastEvt.get(i.id) ?? 0);
    const idleDays = Math.floor((t - last) / DAY);
    const reason = i.rollCount >= ROLL_WARN ? "rolled" : idleDays >= STALE_DAYS && (i.status === "doing" || i.priority === "P0" || i.priority === "P1") ? "idle" : null;
    if (reason) out.push({ id: i.id, title: i.title, projectId: i.projectId, projectName: names.get(i.projectId)?.name ?? "", status: i.status, rollCount: i.rollCount, idleDays, reason });
  }
  return out.sort((a, b) => b.rollCount - a.rollCount || b.idleDays - a.idleDays).slice(0, 30);
}

export type Decision = { kind: string; label: string; title: string; detail: string; href: string; targetType: string; targetId: string };

/** 需要你拍板：只有你能定的事（agent 不能替你决定的都在这里） */
export function decisionsQueue(): Decision[] {
  const t = nowSec();
  const names = liveProjects();
  const pname = (id: string | null | undefined) => (id ? names.get(id)?.name ?? "" : "");
  const out: Decision[] = [];
  for (const p of db.select().from(s.policies).where(and(eq(s.policies.active, 1), eq(s.policies.status, "pending"))).all()) {
    out.push({ kind: "policy", label: "条例待批", title: p.title, detail: `${p.proposedBy || "agent"} 起草${p.purpose ? `：${p.purpose}` : ""}`, href: "/policies", targetType: "policy", targetId: p.id });
  }
  for (const m of db.select().from(s.milestones).all()) {
    if (m.gateProposal && m.gateDecision === "pending" && !["done", "cancelled"].includes(m.status) && names.has(m.projectId))
      out.push({ kind: "gate", label: "阶段评审", title: `${pname(m.projectId)} · ${m.name}`, detail: m.gateProposal.slice(0, 140), href: `/p/${m.projectId}`, targetType: "milestone", targetId: m.id });
  }
  for (const r of db.select().from(s.requirements).all()) {
    if (r.status === "dropped" && r.closeConfirmed === 0 && names.has(r.projectId))
      out.push({ kind: "req_drop", label: "需求放弃待确认", title: `${r.code} ${r.title}`, detail: r.closeReason, href: `/p/${r.projectId}?tab=requirements`, targetType: "requirement", targetId: r.id });
  }
  for (const i of openItems().concat(db.select().from(s.items).where(eq(s.items.needsReview, 1)).all())) {
    if (i.needsReview === 1 && i.status === "done")
      out.push({ kind: "verify", label: "完成待核实", title: i.title, detail: `证据：${i.evidence.slice(0, 100)}`, href: `/p/${i.projectId}?tab=checklist`, targetType: "item", targetId: i.id });
    else if (i.status === "blocked" && !i.waitingFor)
      out.push({ kind: "blocked", label: "卡住了", title: i.title, detail: i.blockReason || "没写原因", href: `/p/${i.projectId}?tab=checklist`, targetType: "item", targetId: i.id });
    else if (i.status === "changed")
      out.push({ kind: "changed", label: "有变更待确认", title: i.title, detail: pname(i.projectId), href: `/p/${i.projectId}?tab=checklist`, targetType: "item", targetId: i.id });
  }
  for (const d of db.select().from(s.deals).all()) {
    if (!["won", "lost"].includes(d.stage) && !d.nextStep.trim() && t - d.updatedAt > 3 * DAY)
      out.push({ kind: "deal", label: "合作没有下一步", title: d.title, detail: "写清下一步做什么、什么时候", href: "/affairs?tab=deals", targetType: "deal", targetId: d.id });
  }
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(d.targetType + d.targetId) ? false : (seen.add(d.targetType + d.targetId), true)));
}

/** 快到期：未来 7 天的非事项类日期（台账、合作、采购、行程、阶段），事项已在「今天」里 */
export function upcoming(days = 7) {
  const t = nowSec();
  return agenda(t - DAY, t + days * DAY).filter((e) => e.kind !== "item" && e.tone !== "ok" && (e.end ?? e.start) >= t - DAY).slice(0, 20);
}

export function currentReview(week = weekStartYmd()) {
  const r = db.select().from(s.weeklyReviews).where(eq(s.weeklyReviews.weekStart, week)).get();
  return r ? { ...r, top3: JSON.parse(r.top3Json) as Top3[], stats: JSON.parse(r.statsJson) } : null;
}

export function secretaryOverview() {
  const plan = todayPlan();
  const waiting = waitingList();
  const decisions = decisionsQueue();
  const due = upcoming();
  const stale = staleWork();
  // 本周三件事：用户确认过的优先；否则看上周的（周一还没复盘时）
  const review = currentReview() ?? currentReview(weekStartYmd(nowSec() - 7 * DAY));
  const top3 = (review?.top3 ?? []).map((x) => {
    const it = x.itemId ? db.select().from(s.items).where(eq(s.items.id, x.itemId)).get() : undefined;
    return { ...x, status: it?.status ?? null };
  });
  return {
    date: plan.date, today: plan.items, waiting, decisions, upcoming: due, stale, top3, reviewStatus: review?.status ?? null,
    counts: { today: plan.items.length, nudge: waiting.filter((w) => w.nudge).length, waiting: waiting.length, decisions: decisions.length, upcoming: due.length, stale: stale.length },
  };
}

/** 加入/移出今天（批量） */
export function planToday(ids: string[], on: boolean, actor: Actor, day = localYmd()) {
  let n = 0;
  for (const id of ids) {
    const i = db.select().from(s.items).where(eq(s.items.id, id)).get();
    if (!i || !OPEN.includes(i.status)) continue;
    db.update(s.items).set({ plannedFor: on ? day : "", rollCount: on && i.plannedFor === day ? i.rollCount : 0, deferUntil: on ? null : i.deferUntil, updatedAt: nowSec() }).where(eq(s.items.id, id)).run();
    n++;
  }
  audit(actor, on ? "today.plan" : "today.unplan", "item", ids.join(","), { day });
  return n;
}

// ---------- 每周复盘 ----------
export type Top3 = { title: string; itemId?: string };

export function weeklyMaterial(week = weekStartYmd()) {
  const from = ymdToSec(week);
  const to = from + 7 * DAY;
  const names = liveProjects();
  const all = db.select().from(s.items).all().filter((i) => names.has(i.projectId));
  const doneWeek = all.filter((i) => i.status === "done" && (i.completedAt ?? 0) >= from && (i.completedAt ?? 0) < to && !i.supersededBy);
  const byProject = new Map<string, string[]>();
  for (const i of doneWeek) byProject.set(i.projectId, [...(byProject.get(i.projectId) ?? []), i.title]);
  const created = all.filter((i) => i.createdAt >= from && i.createdAt < to).length;
  const evts = db.select().from(s.itemEvents).where(and(gte(s.itemEvents.createdAt, from), sql`${s.itemEvents.createdAt} < ${to}`)).all();
  const droppedIds = new Set(evts.filter((e) => e.toStatus === "dropped").map((e) => e.itemId));
  const dropped = all.filter((i) => droppedIds.has(i.id)).map((i) => ({ id: i.id, title: i.title }));
  const slipped = all.filter((i) => i.dueAt && i.dueAt >= from && i.dueAt < Math.min(to, nowSec()) && OPEN.includes(i.status)).map((i) => ({ id: i.id, title: i.title, dueAt: i.dueAt }));
  const projects = [...names.values()].filter((p) => p.status === "active" && p.isInbox !== 1);
  const noNext = projects.filter((p) => !all.some((i) => i.projectId === p.id && OPEN.includes(i.status) && i.parkingLot == null)).map((p) => ({ id: p.id, name: p.name }));
  const inbox = [...names.values()].find((p) => p.isInbox === 1);
  const inboxCount = inbox ? all.filter((i) => i.projectId === inbox.id && OPEN.includes(i.status)).length : 0;
  const prev = currentReview(weekStartYmd(from - DAY));
  const prevTop3 = (prev?.top3 ?? []).map((x) => ({ ...x, status: x.itemId ? all.find((i) => i.id === x.itemId)?.status ?? null : null }));
  return {
    week, done: [...byProject.entries()].map(([pid, titles]) => ({ projectId: pid, projectName: names.get(pid)?.name ?? "", titles })),
    stats: { done: doneWeek.length, created, dropped: dropped.length, slipped: slipped.length },
    dropped, slipped, noNextProjects: noNext, inboxCount, waiting: waitingList(), stale: staleWork(), prevTop3,
    review: currentReview(week),
  };
}

/** 保存复盘。agent 写的是草稿，用户保存即确认 */
export function saveWeeklyReview(input: { week?: string; top3: Top3[]; notesMd?: string }, actor: Actor) {
  const week = input.week ?? weekStartYmd();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw Object.assign(new Error("week 要写成 YYYY-MM-DD（周一）"), { status: 400 });
  const top3 = (input.top3 ?? []).filter((x) => x && x.title?.trim()).slice(0, 3).map((x) => ({ title: x.title.trim().slice(0, 120), itemId: x.itemId || undefined }));
  for (const x of top3) if (x.itemId && !db.select().from(s.items).where(eq(s.items.id, x.itemId)).get()) throw Object.assign(new Error(`事项不存在：${x.itemId}`), { status: 404 });
  const cur = db.select().from(s.weeklyReviews).where(eq(s.weeklyReviews.weekStart, week)).get();
  if (cur && cur.status === "done" && actor.type === "agent") throw Object.assign(new Error("本周复盘已由用户确认，agent 不能改；有建议请写进 notes 让用户看"), { status: 403 });
  const m = weeklyMaterial(week);
  const status = actor.type === "user" ? "done" : "draft";
  const row = { top3Json: JSON.stringify(top3), notesMd: (input.notesMd ?? cur?.notesMd ?? "").slice(0, 4000), statsJson: JSON.stringify(m.stats), status, author: actor.name, updatedAt: nowSec() } as const;
  if (cur) db.update(s.weeklyReviews).set(row).where(eq(s.weeklyReviews.id, cur.id)).run();
  else db.insert(s.weeklyReviews).values({ id: newId("wr"), weekStart: week, ...row, createdAt: nowSec() }).run();
  audit(actor, "review.save", "weekly_review", week, { top3: top3.length, status });
  return currentReview(week)!;
}
