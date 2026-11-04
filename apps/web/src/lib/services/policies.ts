import { db, s } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";

export function listPolicies(projectId?: string) {
  const acks = db.select().from(s.policyAcks).all();
  const rows = projectId
    ? db.select().from(s.policies).where(and(eq(s.policies.active, 1), eq(s.policies.projectId, projectId))).all()
    : db.select().from(s.policies).where(eq(s.policies.active, 1)).all();
  return rows.map((p) => ({ ...p, acked: acks.some((a) => a.policyId === p.id && a.policyVersion === p.version) }));
}

export function upsertPolicy(input: { id?: string; projectId?: string | null; title: string; bodyMd: string; required?: boolean; appliesToTools?: string }, actor: Actor) {
  const at = nowSec();
  if (input.id) {
    const cur = db.select().from(s.policies).where(eq(s.policies.id, input.id)).get();
    if (!cur) throw Object.assign(new Error("条例不存在"), { status: 404 });
    const bumped = cur.bodyMd !== input.bodyMd ? cur.version + 1 : cur.version;
    db.update(s.policies).set({
      title: input.title, bodyMd: input.bodyMd, required: input.required ? 1 : 0,
      appliesToTools: input.appliesToTools ?? cur.appliesToTools, version: bumped, updatedAt: at,
      projectId: input.projectId !== undefined ? input.projectId : cur.projectId,
    }).where(eq(s.policies.id, input.id)).run();
    audit(actor, "policy.update", "policy", input.id, { version: bumped });
    return db.select().from(s.policies).where(eq(s.policies.id, input.id)).get()!;
  }
  const id = newId("pol");
  db.insert(s.policies).values({ id, projectId: input.projectId ?? null, title: input.title, bodyMd: input.bodyMd, required: input.required ? 1 : 0, appliesToTools: input.appliesToTools ?? "", createdAt: at, updatedAt: at }).run();
  audit(actor, "policy.create", "policy", id, { title: input.title });
  return db.select().from(s.policies).where(eq(s.policies.id, id)).get()!;
}

export function ackPolicy(id: string, actorName: string) {
  const p = db.select().from(s.policies).where(eq(s.policies.id, id)).get();
  if (!p) throw Object.assign(new Error("条例不存在"), { status: 404 });
  const exists = db.select().from(s.policyAcks).where(and(eq(s.policyAcks.policyId, id), eq(s.policyAcks.policyVersion, p.version), eq(s.policyAcks.actorName, actorName))).get();
  if (!exists) db.insert(s.policyAcks).values({ id: newId("pak"), policyId: id, policyVersion: p.version, actorName, createdAt: nowSec() }).run();
  if (actorName !== "*") db.delete(s.policyAcks).where(and(eq(s.policyAcks.policyId, id), eq(s.policyAcks.policyVersion, p.version), eq(s.policyAcks.actorName, "*"))).run();
  return { ok: true, policyId: id, version: p.version };
}

/** 门禁检查：返回阻止原因（如有） */
export function policyGate(projectId: string | null, tool: string, actorName: string) {
  // 只有同时给出项目时，才纳入该项目专属条例；全局写操作（projectId 为空）不因某项目的条例被拦
  const rows = db.select().from(s.policies).where(and(eq(s.policies.active, 1), eq(s.policies.required, 1))).all()
    .filter((p) => (p.projectId ? p.projectId === projectId : true))
    .filter((p) => !p.appliesToTools || p.appliesToTools.split(",").map((t) => t.trim()).includes(tool));
  const acks = db.select().from(s.policyAcks).all();
  const acked = (p: { id: string; version: number }) =>
    acks.some((a) => a.policyId === p.id && a.policyVersion === p.version && a.actorName === actorName) ||
    acks.some((a) => a.policyId === p.id && a.policyVersion === p.version && a.actorName === "*");
  const blocking = rows.filter((p) => !acked(p));
  if (process.env.DEBUG_GATE) console.log("[policyGate]", { projectId, tool, actorName, rows: rows.map((r) => [r.title, r.projectId, r.version]), acks: acks.map((a) => [a.policyId, a.policyVersion, a.actorName]), blocking: blocking.map((b) => b.title) });
  if (!blocking.length) return null;
  return { reason: "存在未确认的必读条例，请先调用 policy_read + policy_ack", policies: blocking.map((p) => ({ id: p.id, title: p.title, version: p.version })) };
}
