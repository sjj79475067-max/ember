import { db, s } from "@/lib/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";

export type MilestoneInput = {
  id?: string; projectId: string; name: string; kind?: "phase" | "release"; goal?: string;
  startAt?: number | null; dueAt?: number | null; status?: "planned" | "active" | "done" | "cancelled";
  position?: number; gateProposal?: string; templateKey?: string;
};

export function listMilestones(projectId: string) {
  return db.select().from(s.milestones).where(eq(s.milestones.projectId, projectId)).orderBy(asc(s.milestones.position), asc(s.milestones.createdAt)).all();
}

export function getMilestone(idOrName: string, projectId?: string) {
  const byId = db.select().from(s.milestones).where(eq(s.milestones.id, idOrName)).get();
  if (byId) return byId;
  if (!projectId) return null;
  return db.select().from(s.milestones).where(and(eq(s.milestones.projectId, projectId), eq(s.milestones.name, idOrName))).get() ?? null;
}

/** 建或改阶段。agent 只能写 gateProposal（建议），不能定 gate 结论。 */
export function saveMilestone(input: MilestoneInput, actor: Actor) {
  const at = nowSec();
  const name = input.name.trim().slice(0, 60);
  if (!name) throw Object.assign(new Error("阶段名称不能为空"), { status: 422 });
  if (input.startAt && input.dueAt && input.startAt > input.dueAt) throw Object.assign(new Error("开始时间晚于截止时间"), { status: 422 });
  if (input.id) {
    const cur = db.select().from(s.milestones).where(eq(s.milestones.id, input.id)).get();
    if (!cur) throw Object.assign(new Error("阶段不存在"), { status: 404 });
    db.update(s.milestones).set({
      name, kind: input.kind ?? cur.kind, goal: input.goal ?? cur.goal,
      startAt: input.startAt !== undefined ? input.startAt : cur.startAt,
      dueAt: input.dueAt !== undefined ? input.dueAt : cur.dueAt,
      status: input.status ?? cur.status, position: input.position ?? cur.position,
      gateProposal: input.gateProposal !== undefined ? input.gateProposal.slice(0, 1000) : cur.gateProposal,
      updatedAt: at,
    }).where(eq(s.milestones.id, input.id)).run();
    audit(actor, "milestone.update", "milestone", input.id, input);
    return db.select().from(s.milestones).where(eq(s.milestones.id, input.id)).get()!;
  }
  const dup = db.select().from(s.milestones).where(and(eq(s.milestones.projectId, input.projectId), eq(s.milestones.name, name))).get();
  if (dup) throw Object.assign(new Error(`阶段「${name}」已存在，请传 id 修改`), { status: 409 });
  const maxPos = db.select({ m: sql<number>`coalesce(max(${s.milestones.position}),-1)` }).from(s.milestones).where(eq(s.milestones.projectId, input.projectId)).get()?.m ?? -1;
  const id = newId("ms");
  db.insert(s.milestones).values({
    id, projectId: input.projectId, name, kind: input.kind ?? "phase", goal: input.goal ?? "",
    startAt: input.startAt ?? null, dueAt: input.dueAt ?? null, status: input.status ?? "planned",
    position: input.position ?? maxPos + 1, gateProposal: input.gateProposal ?? "", templateKey: input.templateKey ?? "",
    createdAt: at, updatedAt: at,
  }).run();
  audit(actor, "milestone.create", "milestone", id, { name });
  return db.select().from(s.milestones).where(eq(s.milestones.id, id)).get()!;
}

/** 阶段门决定：只有用户能做。go 会把阶段置为 done 并激活下一段。 */
export function decideGate(id: string, decision: "go" | "hold" | "kill" | "pending", note: string, actor: Actor) {
  if (actor.type === "agent") throw Object.assign(new Error("阶段放行/否决只能由用户在网页决定；agent 请用 gate_proposal 提建议"), { status: 403 });
  const cur = db.select().from(s.milestones).where(eq(s.milestones.id, id)).get();
  if (!cur) throw Object.assign(new Error("阶段不存在"), { status: 404 });
  const at = nowSec();
  const status = decision === "go" ? "done" : decision === "kill" ? "cancelled" : cur.status === "planned" ? "active" : cur.status;
  db.update(s.milestones).set({ gateDecision: decision, gateNote: note.slice(0, 2000), gateDecidedAt: at, gateDecidedBy: actor.name, status, updatedAt: at }).where(eq(s.milestones.id, id)).run();
  if (decision === "go") {
    const next = listMilestones(cur.projectId).find((m) => m.position > cur.position && m.status === "planned");
    if (next) db.update(s.milestones).set({ status: "active", updatedAt: at }).where(eq(s.milestones.id, next.id)).run();
  }
  // 阶段决定同时记入「决定」档案，形成可追溯的评审记录
  const label = { go: "放行", hold: "暂缓/返工", kill: "终止", pending: "撤回决定" }[decision];
  db.insert(s.decisions).values({
    id: newId("dec"), projectId: cur.projectId, title: `阶段评审「${cur.name}」：${label}`,
    rationaleMd: note || "（未填写说明）", impact: `milestone:${cur.id}`, status: "accepted", createdAt: at,
  }).run();
  audit(actor, "milestone.gate", "milestone", id, { decision, note });
  return db.select().from(s.milestones).where(eq(s.milestones.id, id)).get()!;
}

export function deleteMilestone(id: string, actor: Actor) {
  const cur = db.select().from(s.milestones).where(eq(s.milestones.id, id)).get();
  if (!cur) throw Object.assign(new Error("阶段不存在"), { status: 404 });
  db.transaction(() => {
    db.update(s.items).set({ milestoneId: null }).where(eq(s.items.milestoneId, id)).run();
    db.update(s.requirements).set({ milestoneId: null }).where(eq(s.requirements.milestoneId, id)).run();
    db.delete(s.milestones).where(eq(s.milestones.id, id)).run();
  });
  audit(actor, "milestone.delete", "milestone", id, { name: cur.name });
  return { ok: true };
}