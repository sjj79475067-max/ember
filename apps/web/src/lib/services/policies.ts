import { db, s } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";

/** 写操作工具名（用于条例门禁：工具形式的门禁只拦截写操作） */
export const WRITE_TOOLS = [
  "checklist_add", "checklist_update", "checklist_progress", "checklist_supersede", "claim_item", "release_item", "meeting_import",
  "ingest_history", "note_save", "decision_record", "file_register", "file_verify", "file_move",
  "item_move", "item_merge", "project_create", "project_groups", "milestone_save", "requirement_save", "item_link", "template_apply", "project_update_post", "reminder_ack", "policy_write", "policy_ack", "session_end",
];

export const BODY_MAX = 2000;
export const MAX_ACTIVE_REQUIRED = 5;
const DAY = 86400;

export type PolicyStatus = "draft" | "pending" | "active" | "retired";
export type PolicyRow = typeof s.policies.$inferSelect;

function toolsOf(p: PolicyRow): string[] {
  return (p.appliesToTools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

/** 生效条件：active 且（未设到期时间 或 未过期） */
export function isLive(p: PolicyRow, at = nowSec()) {
  return p.status === "active" && p.active === 1 && (!p.expiresAt || p.expiresAt > at);
}

export function listPolicies(projectId?: string) {
  const acks = db.select().from(s.policyAcks).all();
  const rows = projectId
    ? db.select().from(s.policies).where(eq(s.policies.projectId, projectId)).all()
    : db.select().from(s.policies).where(eq(s.policies.active, 1)).all();
  return rows
    .filter((p) => p.active === 1)
    .map((p) => {
      const live = isLive(p);
      const needReview = live && p.reviewEveryDays ? (p.lastReviewedAt ?? p.approvedAt ?? p.updatedAt) + p.reviewEveryDays * DAY < nowSec() : false;
      return {
        ...p,
        live,
        expired: !!(p.expiresAt && p.expiresAt <= nowSec()),
        needReview,
        tools: toolsOf(p),
        acked: acks.some((a) => a.policyId === p.id && a.policyVersion === p.version),
      };
    });
}

export type PolicyInput = {
  id?: string; projectId?: string | null; title: string; bodyMd: string; required?: boolean; appliesToTools?: string;
  purpose?: string; scopeMode?: "tools" | "all"; expiresAt?: number | null; reviewEveryDays?: number | null;
  status?: PolicyStatus;
  approved?: boolean; // 仅网页用户可用：保存即批准
};

/** 校验 + 规范化。硬限制在服务层，不依赖 UI。 */
export function normalizePolicyInput(input: PolicyInput) {
  const title = (input.title ?? "").trim();
  const bodyMd = (input.bodyMd ?? "").trim();
  if (!title) throw Object.assign(new Error("条例标题不能为空"), { status: 422 });
  if (title.length > 80) throw Object.assign(new Error("条例标题最多 80 字，太长说明你想写的是正文"), { status: 422 });
  if (!bodyMd) throw Object.assign(new Error("条例正文不能为空"), { status: 422 });
  if (bodyMd.length > BODY_MAX) throw Object.assign(new Error(`条例正文最多 ${BODY_MAX} 字（现在 ${bodyMd.length} 字）。条例要短、能执行；操作细节请写成笔记或项目说明。`), { status: 422 });
  const scopeMode: "tools" | "all" = input.scopeMode === "all" ? "all" : "tools";
  const tools = (input.appliesToTools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const unknown = tools.filter((t) => !WRITE_TOOLS.includes(t));
  if (unknown.length) throw Object.assign(new Error(`applies_to_tools 只能填写操作工具名，未知：${unknown.join(",")}。可选：${WRITE_TOOLS.join(",")}`), { status: 422 });
  if (scopeMode === "all" && tools.length) throw Object.assign(new Error("scope_mode=all 时不要再填 applies_to_tools"), { status: 422 });
  if (input.required && scopeMode === "tools" && !tools.length)
    throw Object.assign(new Error("必读条例必须限定到具体写操作工具（applies_to_tools），不允许一条规矩拦住所有写入。若要全站生效，请明确传 scope_mode='all'（需用户在网页批准）。"), { status: 422 });
  const rv = input.reviewEveryDays ?? null;
  if (rv != null && (rv < 7 || rv > 3650)) throw Object.assign(new Error("复核周期应在 7–3650 天之间"), { status: 422 });
  return { title, bodyMd, purpose: (input.purpose ?? "").trim().slice(0, 500), scopeMode, tools: tools.join(","), reviewEveryDays: rv };
}

function activeRequiredCount(projectId: string | null, exceptId?: string) {
  return db.select().from(s.policies).where(and(eq(s.policies.required, 1), eq(s.policies.status, "active"))).all()
    .filter((p) => p.id !== exceptId && (p.projectId ?? null) === projectId && (!p.expiresAt || p.expiresAt > nowSec())).length;
}

/**
 * 写入条例。
 * - 用户（actor.type=user）在网页上写：直接生效（active）。
 * - agent：默认进 pending（待批准），完全不起门禁作用；由用户在网页批准后生效。
 * - 更新：内容变了自动升版本；生效中的条例被 agent 修改 → 回到 pending，防止「照旧生效」被偷偷改宽。
 */
export function upsertPolicy(input: PolicyInput, actor: Actor) {
  const at = nowSec();
  const norm = normalizePolicyInput(input);
  const byAgent = actor.type === "agent";
  if (input.id) {
    const cur = db.select().from(s.policies).where(eq(s.policies.id, input.id)).get();
    if (!cur) throw Object.assign(new Error("条例不存在"), { status: 404 });
    const bumped = cur.bodyMd !== norm.bodyMd ? cur.version + 1 : cur.version;
    const contentChanged = bumped !== cur.version;
    let status: PolicyStatus = (cur.status as PolicyStatus) ?? "active";
    if (byAgent && status !== "draft") status = "pending";
    if (input.status && !byAgent) status = input.status;
    if (input.approved === true && !byAgent) status = "active";
    // 用户修订已生效条例后需重新确认（版本变了，原有确认自动失效）
    if (status === "active" && !input.expiresAt && input.required && activeRequiredCount(cur.projectId ?? null, cur.id) >= MAX_ACTIVE_REQUIRED)
      throw Object.assign(new Error(`同一范围内最多 ${MAX_ACTIVE_REQUIRED} 条生效的必读条例，请先废止或合并旧的`), { status: 422 });
    db.update(s.policies).set({
      title: norm.title, bodyMd: norm.bodyMd, required: input.required ? 1 : 0,
      appliesToTools: norm.tools, version: bumped, updatedAt: at, status,
      purpose: norm.purpose || cur.purpose, scopeMode: norm.scopeMode,
      expiresAt: input.expiresAt !== undefined ? input.expiresAt : cur.expiresAt,
      reviewEveryDays: norm.reviewEveryDays ?? cur.reviewEveryDays,
      projectId: input.projectId !== undefined ? input.projectId : cur.projectId,
      lastReviewedAt: contentChanged ? null : cur.lastReviewedAt,
      proposedBy: byAgent ? actor.name : cur.proposedBy,
      approvedBy: status === "active" && !byAgent ? actor.name : cur.approvedBy,
      approvedAt: status === "active" && !byAgent ? at : cur.approvedAt,
    }).where(eq(s.policies.id, input.id)).run();
    audit(actor, "policy.update", "policy", input.id, { version: bumped, status });
    return { ...db.select().from(s.policies).where(eq(s.policies.id, input.id)).get()!, byAgent };
  }
  let status: PolicyStatus = byAgent ? "pending" : (input.status ?? "active");
  if (status === "active" && !input.expiresAt && input.required && activeRequiredCount(input.projectId ?? null) >= MAX_ACTIVE_REQUIRED)
    throw Object.assign(new Error(`同一范围内最多 ${MAX_ACTIVE_REQUIRED} 条生效的必读条例，请先废止或合并旧的`), { status: 422 });
  const id = newId("pol");
  db.insert(s.policies).values({
    id, projectId: input.projectId ?? null, title: norm.title, bodyMd: norm.bodyMd, required: input.required ? 1 : 0,
    appliesToTools: norm.tools, status, purpose: norm.purpose, scopeMode: norm.scopeMode,
    expiresAt: input.expiresAt ?? null, reviewEveryDays: norm.reviewEveryDays ?? null,
    proposedBy: actor.name, approvedBy: status === "active" ? actor.name : "", approvedAt: status === "active" ? at : null,
    createdAt: at, updatedAt: at,
  }).run();
  audit(actor, byAgent ? "policy.propose" : "policy.create", "policy", id, { title: norm.title, status });
  return { ...db.select().from(s.policies).where(eq(s.policies.id, id)).get()!, byAgent };
}

/** 用户批准 agent 起草的条例（agent 不能调用） */
export function approvePolicy(id: string, actor: Actor) {
  if (actor.type === "agent") throw Object.assign(new Error("条例只能由用户在网页批准，agent 无权批准"), { status: 403 });
  const cur = db.select().from(s.policies).where(eq(s.policies.id, id)).get();
  if (!cur) throw Object.assign(new Error("条例不存在"), { status: 404 });
  if (cur.required && activeRequiredCount(cur.projectId ?? null, id) >= MAX_ACTIVE_REQUIRED)
    throw Object.assign(new Error(`同一范围内最多 ${MAX_ACTIVE_REQUIRED} 条生效的必读条例，请先废止或合并旧的`), { status: 422 });
  const at = nowSec();
  db.update(s.policies).set({ status: "active", approvedBy: actor.name, approvedAt: at, updatedAt: at }).where(eq(s.policies.id, id)).run();
  audit(actor, "policy.approve", "policy", id, {});
  return db.select().from(s.policies).where(eq(s.policies.id, id)).get()!;
}

/** 废止（保留历史，不再门禁） */
export function retirePolicy(id: string, actor: Actor, reason = "") {
  const cur = db.select().from(s.policies).where(eq(s.policies.id, id)).get();
  if (!cur) throw Object.assign(new Error("条例不存在"), { status: 404 });
  if (actor.type === "agent") throw Object.assign(new Error("废止条例需要用户在网页操作"), { status: 403 });
  db.update(s.policies).set({ status: "retired", required: 0, updatedAt: nowSec() }).where(eq(s.policies.id, id)).run();
  audit(actor, "policy.retire", "policy", id, { reason: reason.slice(0, 300) });
  return { ok: true };
}

/** 复核通过：刷新 lastReviewedAt；顺带把已过期的必读条例提醒出来 */
export function reviewPolicy(id: string, actor: Actor) {
  const cur = db.select().from(s.policies).where(eq(s.policies.id, id)).get();
  if (!cur) throw Object.assign(new Error("条例不存在"), { status: 404 });
  db.update(s.policies).set({ lastReviewedAt: nowSec(), updatedAt: nowSec() }).where(eq(s.policies.id, id)).run();
  audit(actor, "policy.review", "policy", id, {});
  return { ok: true };
}

export function ackPolicy(id: string, actorName: string) {
  const p = db.select().from(s.policies).where(eq(s.policies.id, id)).get();
  if (!p) throw Object.assign(new Error("条例不存在"), { status: 404 });
  if (!isLive(p)) throw Object.assign(new Error(`该条例当前未生效（状态：${p.status}${p.expiresAt && p.expiresAt <= nowSec() ? "/已过期" : ""}），无需确认`), { status: 409 });
  const exists = db.select().from(s.policyAcks).where(and(eq(s.policyAcks.policyId, id), eq(s.policyAcks.policyVersion, p.version), eq(s.policyAcks.actorName, actorName))).get();
  if (!exists) db.insert(s.policyAcks).values({ id: newId("pak"), policyId: id, policyVersion: p.version, actorName, createdAt: nowSec() }).run();
  if (actorName !== "*") db.delete(s.policyAcks).where(and(eq(s.policyAcks.policyId, id), eq(s.policyAcks.policyVersion, p.version), eq(s.policyAcks.actorName, "*"))).run();
  return { ok: true, policyId: id, version: p.version };
}

/**
 * 门禁检查：返回阻止原因（如有）。
 * 只有「生效中（active 且未过期）的必读条例」参与门禁：
 *  - 项目条例：仅当操作明确落在该项目时才生效；
 *  - 工具型（scopeMode=tools）：只拦 appliesToTools 里列出的写操作；
 *  - 全局型（scopeMode=all）：由用户批准后才会存在，拦所有写操作。
 */
export function policyGate(projectId: string | null, tool: string, actorName: string) {
  const isWrite = WRITE_TOOLS.includes(tool);
  const rows = db.select().from(s.policies).where(eq(s.policies.required, 1)).all()
    .filter((p) => isLive(p))
    .filter((p) => (p.projectId ? p.projectId === projectId : true))
    .filter((p) => (p.scopeMode === "all" ? isWrite : toolsOf(p).includes(tool) && isWrite));
  const acks = db.select().from(s.policyAcks).all();
  const acked = (p: { id: string; version: number }) =>
    acks.some((a) => a.policyId === p.id && a.policyVersion === p.version && (a.actorName === actorName || a.actorName === "*"));
  const blocking = rows.filter((p) => !acked(p));
  if (!blocking.length) return null;
  return {
    reason: "存在未确认的必读条例，请先调用 policy_read + policy_ack",
    policies: blocking.map((p) => ({ id: p.id, title: p.title, version: p.version })),
  };
}