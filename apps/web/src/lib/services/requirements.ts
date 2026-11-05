import { db, s } from "@/lib/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";

export type ReqStatus = "proposed" | "accepted" | "in_progress" | "done" | "dropped";
const CLOSED: ReqStatus[] = ["done", "dropped"];

function nextCode(projectId: string) {
  const n = db.select({ n: sql<number>`count(*)` }).from(s.requirements).where(eq(s.requirements.projectId, projectId)).get()?.n ?? 0;
  let i = n + 1;
  // 防止删除后编号撞车
  while (db.select().from(s.requirements).where(and(eq(s.requirements.projectId, projectId), eq(s.requirements.code, `R-${String(i).padStart(3, "0")}`))).get()) i++;
  return `R-${String(i).padStart(3, "0")}`;
}

export function listRequirements(projectId: string) {
  const reqs = db.select().from(s.requirements).where(eq(s.requirements.projectId, projectId)).orderBy(asc(s.requirements.code)).all();
  const items = db.select({ id: s.items.id, requirementId: s.items.requirementId, status: s.items.status, needsReview: s.items.needsReview, title: s.items.title })
    .from(s.items).where(eq(s.items.projectId, projectId)).all().filter((i) => i.requirementId);
  return reqs.map((r) => {
    const its = items.filter((i) => i.requirementId === r.id);
    const open = its.filter((i) => !["done", "dropped"].includes(i.status));
    return {
      ...r,
      items: its.map((i) => ({ id: i.id, title: i.title, status: i.status })),
      stat: { total: its.length, open: open.length, done: its.filter((i) => i.status === "done").length },
      untriaged: !CLOSED.includes(r.status as ReqStatus) && its.length === 0,
    };
  });
}

export function getRequirement(idOrCode: string, projectId?: string) {
  const byId = db.select().from(s.requirements).where(eq(s.requirements.id, idOrCode)).get();
  if (byId) return byId;
  if (!projectId) return null;
  return db.select().from(s.requirements).where(and(eq(s.requirements.projectId, projectId), eq(s.requirements.code, idOrCode.toUpperCase()))).get() ?? null;
}

export type RequirementInput = {
  id?: string; projectId: string; title?: string; detailMd?: string; source?: string;
  priority?: "P0" | "P1" | "P2" | "P3"; milestoneId?: string | null; status?: ReqStatus; closeReason?: string;
};

/**
 * 需求的写入规则（服务端强制）：
 * - done：必须没有未关闭的关联事项；无事项时必须写 closeReason 说明怎么完成的。
 * - dropped：必须写 closeReason；agent 放弃的需求标记为待用户确认。
 * - 已关闭的需求重新打开 → 清空关闭信息。
 */
export function saveRequirement(input: RequirementInput, actor: Actor) {
  const at = nowSec();
  const byAgent = actor.type === "agent";
  if (input.id) {
    const cur = db.select().from(s.requirements).where(eq(s.requirements.id, input.id)).get();
    if (!cur) throw Object.assign(new Error("需求不存在"), { status: 404 });
    const set: Record<string, unknown> = { updatedAt: at };
    if (input.title !== undefined) set.title = input.title.trim().slice(0, 200);
    if (input.detailMd !== undefined) set.detailMd = input.detailMd;
    if (input.source !== undefined) set.source = input.source;
    if (input.priority) set.priority = input.priority;
    if (input.milestoneId !== undefined) set.milestoneId = input.milestoneId;
    if (input.status && input.status !== cur.status) {
      applyStatus(set, cur, input.status, input.closeReason, actor, byAgent);
    } else if (input.closeReason && CLOSED.includes(cur.status as ReqStatus)) {
      set.closeReason = input.closeReason.slice(0, 1000);
    }
    db.update(s.requirements).set(set).where(eq(s.requirements.id, input.id)).run();
    audit(actor, "requirement.update", "requirement", input.id, input);
    return db.select().from(s.requirements).where(eq(s.requirements.id, input.id)).get()!;
  }
  const title = (input.title ?? "").trim();
  if (!title) throw Object.assign(new Error("需求标题不能为空"), { status: 422 });
  const dup = db.select().from(s.requirements).where(eq(s.requirements.projectId, input.projectId)).all()
    .find((r) => r.title === title && !CLOSED.includes(r.status as ReqStatus));
  if (dup) throw Object.assign(new Error(`已有同名未关闭需求 ${dup.code}「${dup.title}」，请在原需求上更新`), { status: 409, existing: dup });
  const id = newId("req");
  const code = nextCode(input.projectId);
  const status = input.status && !CLOSED.includes(input.status) ? input.status : "proposed";
  db.insert(s.requirements).values({
    id, projectId: input.projectId, code, title: title.slice(0, 200), detailMd: input.detailMd ?? "", source: input.source ?? "",
    priority: input.priority ?? "P1", milestoneId: input.milestoneId ?? null, status, createdBy: actor.name, createdAt: at, updatedAt: at,
  }).run();
  audit(actor, "requirement.create", "requirement", id, { code, title });
  return db.select().from(s.requirements).where(eq(s.requirements.id, id)).get()!;
}

function applyStatus(set: Record<string, unknown>, cur: typeof s.requirements.$inferSelect, next: ReqStatus, reason: string | undefined, actor: Actor, byAgent: boolean) {
  const at = nowSec();
  if (next === "done") {
    const its = db.select().from(s.items).where(eq(s.items.requirementId, cur.id)).all();
    const open = its.filter((i) => !["done", "dropped"].includes(i.status));
    if (open.length) throw Object.assign(new Error(`还有 ${open.length} 个关联事项没完成（${open.slice(0, 3).map((i) => i.title).join("、")}），不能把需求标为完成`), { status: 422 });
    const review = its.filter((i) => i.needsReview === 1);
    if (review.length) throw Object.assign(new Error(`有 ${review.length} 个关联事项的完成证据待核实，核实后再关闭需求`), { status: 422 });
    if (!its.length && !reason?.trim()) throw Object.assign(new Error("这个需求没有拆出事项，标为完成时请在 close_reason 写明是怎么完成的"), { status: 422 });
    set.status = "done"; set.closedAt = at; set.closedBy = actor.name; set.closeConfirmed = 1;
    set.closeReason = reason?.trim() || `关联的 ${its.length} 个事项已全部完成`;
    return;
  }
  if (next === "dropped") {
    if (!reason?.trim() || reason.trim().length < 4) throw Object.assign(new Error("放弃需求必须写明原因（close_reason），否则就是有始无终"), { status: 422 });
    set.status = "dropped"; set.closedAt = at; set.closedBy = actor.name; set.closeReason = reason.trim().slice(0, 1000);
    set.closeConfirmed = byAgent ? 0 : 1;
    return;
  }
  // 重新打开或推进
  set.status = next;
  if (CLOSED.includes(cur.status as ReqStatus)) { set.closedAt = null; set.closedBy = ""; set.closeReason = ""; set.closeConfirmed = 1; }
}

/** 用户确认 agent 提出的放弃，或驳回（恢复为 accepted） */
export function confirmDrop(id: string, accept: boolean, actor: Actor) {
  if (actor.type === "agent") throw Object.assign(new Error("只能由用户确认"), { status: 403 });
  const cur = db.select().from(s.requirements).where(eq(s.requirements.id, id)).get();
  if (!cur) throw Object.assign(new Error("需求不存在"), { status: 404 });
  if (accept) db.update(s.requirements).set({ closeConfirmed: 1, updatedAt: nowSec() }).where(eq(s.requirements.id, id)).run();
  else db.update(s.requirements).set({ status: "accepted", closeConfirmed: 1, closeReason: "", closedAt: null, closedBy: "", updatedAt: nowSec() }).where(eq(s.requirements.id, id)).run();
  audit(actor, accept ? "requirement.drop_confirm" : "requirement.drop_reject", "requirement", id, {});
  return db.select().from(s.requirements).where(eq(s.requirements.id, id)).get()!;
}

/** 事项状态变化后调用：关联事项全部完成 → 需求自动完成；有事项进行中 → 需求推进到 in_progress */
export function syncRequirement(requirementId: string | null | undefined) {
  if (!requirementId) return;
  const r = db.select().from(s.requirements).where(eq(s.requirements.id, requirementId)).get();
  if (!r || r.status === "dropped") return;
  const its = db.select().from(s.items).where(eq(s.items.requirementId, requirementId)).all();
  if (!its.length) return;
  const allClosed = its.every((i) => ["done", "dropped"].includes(i.status));
  const anyDone = its.some((i) => i.status === "done");
  const anyReview = its.some((i) => i.needsReview === 1);
  const at = nowSec();
  if (allClosed && anyDone && !anyReview) {
    if (r.status !== "done") {
      db.update(s.requirements).set({ status: "done", closedAt: at, closedBy: "system", closeReason: `关联的 ${its.length} 个事项已全部完成`, closeConfirmed: 1, updatedAt: at }).where(eq(s.requirements.id, r.id)).run();
    }
  } else if (r.status === "done") {
    db.update(s.requirements).set({ status: "in_progress", closedAt: null, closedBy: "", closeReason: "", updatedAt: at }).where(eq(s.requirements.id, r.id)).run();
  } else if (["proposed", "accepted"].includes(r.status) && its.some((i) => ["doing", "done", "blocked", "changed"].includes(i.status))) {
    db.update(s.requirements).set({ status: "in_progress", updatedAt: at }).where(eq(s.requirements.id, r.id)).run();
  }
}