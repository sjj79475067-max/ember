import { db, s } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { listMilestones } from "./milestones";
import { listRequirements } from "./requirements";
import { depsFor } from "./deps";

const DAY = 86400;
const CLOSED = ["done", "dropped"];

import { KIND_LABEL, ITEM_KINDS } from "@/lib/labels";
export { KIND_LABEL, ITEM_KINDS };
export type Health = "on_track" | "at_risk" | "off_track";

type Item = typeof s.items.$inferSelect;

function isDone(i: Item) { return i.status === "done" && i.needsReview !== 1; }

/**
 * 一个项目的全局视图（看板与 agent 共用，保证人和 agent 看到的是同一套推导）：
 * 阶段进度与必过缺口、发版就绪、等待链/依赖违约、需求漏斗、按类型进度、健康度、近 30 天完成趋势。
 */
export function projectBoard(projectId: string) {
  const t = nowSec();
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) throw Object.assign(new Error("项目不存在"), { status: 404 });
  const items = db.select().from(s.items).where(eq(s.items.projectId, projectId)).all().filter((i) => i.parkingLot == null);
  const live = items.filter((i) => i.status !== "dropped");
  const milestones = listMilestones(projectId);
  const deps = depsFor(items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i]));

  const waitingMap = new Map<string, string[]>();
  for (const d of deps) {
    if (!CLOSED.includes(d.blockerStatus) && byId.has(d.blockedId)) waitingMap.set(d.blockedId, [...(waitingMap.get(d.blockedId) ?? []), d.blockerTitle]);
  }

  const brief = (i: Item) => ({
    id: i.id, title: i.title, status: i.status, kind: i.kind, priority: i.priority, dueAt: i.dueAt,
    claimedBy: i.claimedBy || null, waitingOn: waitingMap.get(i.id) ?? [], leadTimeDays: i.leadTimeDays,
    overdue: !!(i.dueAt && i.dueAt < t && !CLOSED.includes(i.status)), needsReview: i.needsReview === 1,
  });

  const phases = milestones.map((m) => {
    const its = live.filter((i) => i.milestoneId === m.id);
    const must = its.filter((i) => i.mustMeet === 1);
    const mustOpen = must.filter((i) => !isDone(i));
    // 资质类有办理周期：剩余时间不够就提前标风险
    const leadRisk = mustOpen.filter((i) => i.leadTimeDays && m.dueAt && t + i.leadTimeDays * DAY > m.dueAt);
    return {
      id: m.id, name: m.name, kind: m.kind, goal: m.goal, status: m.status, position: m.position,
      startAt: m.startAt, dueAt: m.dueAt, daysLeft: m.dueAt ? Math.ceil((m.dueAt - t) / DAY) : null,
      gate: { decision: m.gateDecision, note: m.gateNote, decidedAt: m.gateDecidedAt, decidedBy: m.gateDecidedBy, proposal: m.gateProposal },
      total: its.length, done: its.filter(isDone).length,
      mustTotal: must.length, mustDone: must.length - mustOpen.length,
      ready: must.length > 0 ? mustOpen.length === 0 : its.length > 0 && its.every((i) => isDone(i) || i.status === "dropped"),
      gaps: mustOpen.map(brief),
      leadRisk: leadRisk.map((i) => ({ id: i.id, title: i.title, leadTimeDays: i.leadTimeDays })),
    };
  });

  // 当前阶段：第一个 active；没有则第一个未完成的
  const current = phases.find((p) => p.status === "active") ?? phases.find((p) => !["done", "cancelled"].includes(p.status)) ?? null;
  // 发版就绪：优先最近的 release 里程碑，否则用最后一个阶段（通常是「上线」）
  const releaseTarget = phases.find((p) => p.kind === "release" && !["done", "cancelled"].includes(p.status))
    ?? [...phases].reverse().find((p) => !["done", "cancelled"].includes(p.status)) ?? null;

  const byKind = ITEM_KINDS.map((k) => {
    const its = live.filter((i) => i.kind === k);
    return { kind: k, label: KIND_LABEL[k], total: its.length, done: its.filter(isDone).length, blocked: its.filter((i) => i.status === "blocked").length, overdue: its.filter((i) => i.dueAt && i.dueAt < t && !CLOSED.includes(i.status)).length };
  }).filter((k) => k.total > 0);

  const reqs = listRequirements(projectId);
  const funnel = {
    proposed: reqs.filter((r) => r.status === "proposed").length,
    accepted: reqs.filter((r) => r.status === "accepted").length,
    in_progress: reqs.filter((r) => r.status === "in_progress").length,
    done: reqs.filter((r) => r.status === "done").length,
    dropped: reqs.filter((r) => r.status === "dropped").length,
    untriaged: reqs.filter((r) => r.untriaged && r.status !== "proposed").map((r) => ({ id: r.id, code: r.code, title: r.title })),
    dropUnconfirmed: reqs.filter((r) => r.status === "dropped" && r.closeConfirmed === 0).map((r) => ({ id: r.id, code: r.code, title: r.title, reason: r.closeReason })),
    staleProposed: reqs.filter((r) => r.status === "proposed" && t - r.createdAt > 14 * DAY).map((r) => ({ id: r.id, code: r.code, title: r.title })),
  };

  const open = live.filter((i) => !CLOSED.includes(i.status));
  const attention = {
    overdue: open.filter((i) => i.dueAt && i.dueAt < t).map(brief),
    blocked: open.filter((i) => i.status === "blocked").map((i) => ({ ...brief(i), reason: i.blockReason })),
    waiting: open.filter((i) => waitingMap.has(i.id)).map(brief),
    violations: deps.filter((d) => d.violated),
    needsReview: items.filter((i) => i.needsReview === 1).map(brief),
    unclaimedDoing: open.filter((i) => i.status === "doing" && !i.claimedBy).map(brief),
  };

  // 近 30 天完成趋势（按天）
  const trend: Array<{ day: string; done: number; created: number }> = [];
  for (let k = 29; k >= 0; k--) {
    const start = startOfDay(t - k * DAY);
    const end = start + DAY;
    trend.push({
      day: new Date(start * 1000).toISOString().slice(5, 10),
      done: items.filter((i) => i.completedAt && i.completedAt >= start && i.completedAt < end).length,
      created: items.filter((i) => i.createdAt >= start && i.createdAt < end).length,
    });
  }

  const health = deriveHealth(project, attention, phases);

  return {
    project: { id: project.id, key: project.key, name: project.name, kind: project.kind, dueAt: project.dueAt, template: project.template },
    totals: { total: live.length, done: live.filter(isDone).length, open: open.length },
    current: current ? { id: current.id, name: current.name } : null,
    release: releaseTarget ? {
      id: releaseTarget.id, name: releaseTarget.name, mustTotal: releaseTarget.mustTotal, mustDone: releaseTarget.mustDone,
      ready: releaseTarget.ready, gaps: releaseTarget.gaps, daysLeft: releaseTarget.daysLeft, leadRisk: releaseTarget.leadRisk,
    } : null,
    phases, byKind, funnel, attention, trend, health,
    unphased: live.filter((i) => !i.milestoneId).length,
  };
}

function startOfDay(ts: number) {
  const d = new Date(ts * 1000); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000);
}

/** Linear 式：健康度取最近一次更新；过期或没有更新时给出「系统建议」，并标记更新缺失 */
function deriveHealth(project: typeof s.projects.$inferSelect, attention: { overdue: unknown[]; blocked: unknown[]; violations: unknown[]; needsReview: unknown[] }, phases: Array<{ gaps: Array<{ overdue: boolean }>; leadRisk: unknown[]; daysLeft: number | null; ready: boolean; status: string }>) {
  const t = nowSec();
  const last = db.select().from(s.projectUpdates).where(eq(s.projectUpdates.projectId, project.id)).orderBy(desc(s.projectUpdates.createdAt)).limit(1).get();
  const p0Overdue = (attention.overdue as Array<{ priority: string }>).some((i) => i.priority === "P0");
  const gapOverdue = phases.some((p) => p.gaps.some((g) => g.overdue));
  const phaseLate = phases.some((p) => p.daysLeft != null && p.daysLeft < 0 && !p.ready && !["done", "cancelled"].includes(p.status));
  let suggested: Health = "on_track";
  const reasons: string[] = [];
  if (p0Overdue) reasons.push("有 P0 事项逾期");
  if (attention.violations.length) reasons.push(`${attention.violations.length} 条依赖排不开`);
  if (phaseLate) reasons.push("有阶段过了截止日仍未达标");
  if (reasons.length) suggested = "off_track";
  else {
    if (attention.blocked.length) reasons.push(`${attention.blocked.length} 项阻塞`);
    if (gapOverdue) reasons.push("必过项逾期");
    if (phases.some((p) => p.leadRisk.length)) reasons.push("资质办理周期不够");
    if (attention.needsReview.length) reasons.push(`${attention.needsReview.length} 项完成待核实`);
    if (reasons.length) suggested = "at_risk";
  }
  const every = project.updateEveryDays || 7;
  const missing = !last || t - last.createdAt > every * DAY;
  return {
    value: (last && !missing ? last.health : suggested) as Health,
    source: last && !missing ? "update" : "system",
    suggested, reasons,
    lastUpdate: last ? { id: last.id, health: last.health, at: last.createdAt, author: last.author, progress: last.progressMd, blockers: last.blockersMd, next: last.nextMd } : null,
    updateMissing: missing,
    updateEveryDays: every,
  };
}

/** 发项目更新：三段式 + 健康度；自动附上本周期变化摘要，让健康度可验证 */
export function postProjectUpdate(input: { projectId: string; health: Health; progressMd?: string; blockersMd?: string; nextMd?: string }, actor: Actor) {
  const t = nowSec();
  const last = db.select().from(s.projectUpdates).where(eq(s.projectUpdates.projectId, input.projectId)).orderBy(desc(s.projectUpdates.createdAt)).limit(1).get();
  const since = last?.createdAt ?? t - 7 * DAY;
  const items = db.select().from(s.items).where(eq(s.items.projectId, input.projectId)).all();
  const doneN = items.filter((i) => i.completedAt && i.completedAt >= since && i.status === "done").length;
  const newN = items.filter((i) => i.createdAt >= since).length;
  const ms = listMilestones(input.projectId).filter((m) => m.gateDecidedAt && m.gateDecidedAt >= since);
  const auto = [`自上次更新完成 ${doneN} 项、新增 ${newN} 项`, ...ms.map((m) => `阶段「${m.name}」评审：${m.gateDecision}`)].join("；");
  const id = newId("pu");
  db.insert(s.projectUpdates).values({
    id, projectId: input.projectId, health: input.health, progressMd: input.progressMd ?? "", blockersMd: input.blockersMd ?? "",
    nextMd: input.nextMd ?? "", autoSummary: auto, author: actor.name, createdAt: t,
  }).run();
  audit(actor, "project.update_post", "project", input.projectId, { health: input.health });
  return db.select().from(s.projectUpdates).where(eq(s.projectUpdates.id, id)).get()!;
}

export function listProjectUpdates(projectId: string, limit = 20) {
  return db.select().from(s.projectUpdates).where(eq(s.projectUpdates.projectId, projectId)).orderBy(desc(s.projectUpdates.createdAt)).limit(limit).all();
}

/** 首页/组合视图用的轻量卡片 */
export function portfolioCards() {
  const projects = db.select().from(s.projects).all().filter((p) => p.status === "active" && p.isInbox !== 1);
  return projects.map((p) => {
    try {
      const b = projectBoard(p.id);
      return {
        id: p.id, key: p.key, name: p.name, kind: p.kind, health: b.health.value, healthSource: b.health.source, updateMissing: b.health.updateMissing,
        current: b.current?.name ?? null, release: b.release ? { name: b.release.name, mustDone: b.release.mustDone, mustTotal: b.release.mustTotal, ready: b.release.ready, daysLeft: b.release.daysLeft } : null,
        totals: b.totals, overdue: b.attention.overdue.length, blocked: b.attention.blocked.length, waiting: b.attention.waiting.length,
        phases: b.phases.map((x) => ({ name: x.name, status: x.status, startAt: x.startAt, dueAt: x.dueAt, done: x.done, total: x.total })),
      };
    } catch { return null; }
  }).filter(Boolean);
}