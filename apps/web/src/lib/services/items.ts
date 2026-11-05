import { db, s } from "@/lib/db";
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";

export type ItemStatus = "todo" | "doing" | "blocked" | "done" | "dropped" | "changed";
const CLAIM_TTL = 60 * 60 * 2; // 2h 心跳过期

export type ItemInput = {
  title: string; detailMd?: string; doneDefinition?: string; priority?: "P0" | "P1" | "P2" | "P3";
  dueAt?: number | null; workstreamId?: string | null; parentId?: string | null;
  sourceType?: "meeting" | "decision" | "import" | "manual" | "agent"; sourceRef?: string;
};

export function progressFor(projectId: string) {
  const r = db.select({
    total: sql<number>`count(*)`,
    done: sql<number>`sum(case when ${s.items.status}='done' then 1 else 0 end)`,
    doing: sql<number>`sum(case when ${s.items.status}='doing' then 1 else 0 end)`,
    blocked: sql<number>`sum(case when ${s.items.status}='blocked' then 1 else 0 end)`,
    overdue: sql<number>`sum(case when ${s.items.dueAt} is not null and ${s.items.dueAt} < ${nowSec()} and ${s.items.status} not in ('done','dropped') then 1 else 0 end)`,
    changed: sql<number>`sum(case when ${s.items.status}='changed' then 1 else 0 end)`,
  }).from(s.items).where(eq(s.items.projectId, projectId)).get();
  return {
    project: projectId,
    total: r?.total ?? 0, done: r?.done ?? 0, doing: r?.doing ?? 0,
    blocked: r?.blocked ?? 0, overdue: r?.overdue ?? 0, changed: r?.changed ?? 0,
  };
}

export function addItems(projectId: string, list: ItemInput[], actor: Actor, ip = "") {
  const p = db.select().from(s.projects).where(sql`${s.projects.id}=${projectId} or ${s.projects.key}=${projectId}`).get();
  if (!p) throw Object.assign(new Error("项目不存在"), { status: 404 });
  const maxPos = db.select({ m: sql<number>`coalesce(max(${s.items.position}),0)` }).from(s.items).where(eq(s.items.projectId, p.id)).get()?.m ?? 0;
  const created: string[] = [];
  db.transaction(() => {
    list.forEach((it, i) => {
      const id = newId("itm");
      db.insert(s.items).values({
        id, projectId: p.id, workstreamId: it.workstreamId ?? null, parentId: it.parentId ?? null,
        title: it.title.slice(0, 500), detailMd: it.detailMd ?? "", doneDefinition: it.doneDefinition ?? "",
        priority: it.priority ?? "P1", dueAt: it.dueAt ?? null, sourceType: it.sourceType ?? "manual",
        sourceRef: it.sourceRef ?? "", position: maxPos + i + 1, createdAt: nowSec(), updatedAt: nowSec(),
      }).run();
      db.insert(s.itemEvents).values({ id: newId("evt"), itemId: id, actorType: actor.type, actorName: actor.name, action: "create", toStatus: "todo", createdAt: nowSec() }).run();
      created.push(id);
    });
  });
  audit(actor, "items.add", "project", p.id, { count: created.length, ids: created }, { ip });
  return { ids: created, progress: progressFor(p.id) };
}

export type UpdatePatch = {
  status?: ItemStatus; note?: string; evidence?: string; dueAt?: number | null;
  blockReason?: string; expectedVersion?: number; priority?: "P0" | "P1" | "P2" | "P3";
  title?: string; detailMd?: string; doneDefinition?: string;
};

export function updateItem(itemId: string, patch: UpdatePatch, actor: Actor, agentSessionId?: string, ip = "") {
  const cur = db.select().from(s.items).where(eq(s.items.id, itemId)).get();
  if (!cur) throw Object.assign(new Error("任务不存在"), { status: 404 });
  if (patch.expectedVersion != null && patch.expectedVersion !== cur.version) {
    throw Object.assign(new Error(`版本冲突：当前版本 ${cur.version}，你提交的是 ${patch.expectedVersion}。请重新读取后再提交。`), { status: 409, current: cur });
  }
  const set: Record<string, unknown> = { version: cur.version + 1, updatedAt: nowSec() };
  if (patch.status && patch.status !== cur.status) {
    set.status = patch.status;
    if (patch.status === "done") set.completedAt = nowSec();
    if (patch.status !== "blocked") set.blockReason = "";
    if (patch.evidence) set.evidence = patch.evidence;
  }
  // 备注只写备注，不覆盖证据（证据是验收依据，必须单独保留）
  if (patch.note) set.evidence = cur.evidence ? cur.evidence : patch.note;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt;
  if (patch.blockReason !== undefined) set.blockReason = patch.blockReason;
  if (patch.priority) set.priority = patch.priority;
  if (patch.title) set.title = patch.title;
  if (patch.detailMd !== undefined) set.detailMd = patch.detailMd;
  if (patch.doneDefinition !== undefined) set.doneDefinition = patch.doneDefinition;
  db.transaction(() => {
    db.update(s.items).set(set).where(eq(s.items.id, itemId)).run();
    if (patch.status && patch.status !== cur.status) {
      db.insert(s.itemEvents).values({
        id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name,
        action: patch.status === "done" ? "complete" : patch.status === "changed" ? "change" : "update",
        fromStatus: cur.status, toStatus: patch.status, note: patch.note ?? "", evidence: patch.evidence ?? "", createdAt: nowSec(),
      }).run();
    }
  });
  audit(actor, "item.update", "item", itemId, { patch, session: agentSessionId }, { ip });
  const updated = db.select().from(s.items).where(eq(s.items.id, itemId)).get()!;
  return { item: updated, progress: progressFor(cur.projectId) };
}

export function claimItem(itemId: string, sessionId: string, actor: Actor) {
  const cur = db.select().from(s.items).where(eq(s.items.id, itemId)).get();
  if (!cur) throw Object.assign(new Error("任务不存在"), { status: 404 });
  const fresh = cur.claimedBy && cur.claimedAt && nowSec() - cur.claimedAt < CLAIM_TTL;
  if (fresh && cur.claimedBy !== sessionId) {
    return { conflict: true, claimedBy: cur.claimedBy, claimedAt: cur.claimedAt, item: cur };
  }
  db.update(s.items).set({ claimedBy: sessionId, claimedAt: nowSec(), status: cur.status === "todo" ? "doing" : cur.status, updatedAt: nowSec() }).where(eq(s.items.id, itemId)).run();
  db.insert(s.itemEvents).values({ id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name, action: "claim", fromStatus: cur.status, toStatus: cur.status === "todo" ? "doing" : cur.status, note: sessionId, createdAt: nowSec() }).run();
  return { conflict: false, item: db.select().from(s.items).where(eq(s.items.id, itemId)).get()! };
}

export function releaseItem(itemId: string, actor: Actor) {
  db.update(s.items).set({ claimedBy: "", claimedAt: null, updatedAt: nowSec() }).where(eq(s.items.id, itemId)).run();
  db.insert(s.itemEvents).values({ id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name, action: "release", createdAt: nowSec() }).run();
  return true;
}

export function listItems(opts: { projectId?: string; status?: ItemStatus | "open"; dueBefore?: number; limit?: number; cursor?: number; q?: string }) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const conds = [];
  if (opts.projectId) conds.push(eq(s.items.projectId, opts.projectId));
  if (opts.status === "open") conds.push(notInClosed());
  else if (opts.status) conds.push(eq(s.items.status, opts.status));
  if (opts.dueBefore) conds.push(lte(s.items.dueAt, opts.dueBefore));
  if (opts.cursor) conds.push(sql`${s.items.position} > ${opts.cursor}`);
  if (opts.q) conds.push(sql`(${s.items.title} like ${"%" + opts.q + "%"} or ${s.items.detailMd} like ${"%" + opts.q + "%"})`);
  const rows = db.select().from(s.items)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(s.items.position), asc(s.items.createdAt))
    .limit(limit + 1).all();
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit), nextCursor: hasMore ? rows[limit - 1].position : null };
}

function notInClosed() {
  return sql`${s.items.status} in ('todo','doing','blocked','changed')`;
}

export function verifyChecklist(projectId: string) {
  const rows = db.select().from(s.items).where(eq(s.items.projectId, projectId)).all();
  const gaps: Array<{ id: string; title: string; issue: string }> = [];
  for (const it of rows) {
    if (it.status === "done" && !it.evidence.trim()) gaps.push({ id: it.id, title: it.title, issue: "done 但缺少完成证据" });
    if (it.status === "blocked" && !it.blockReason.trim()) gaps.push({ id: it.id, title: it.title, issue: "blocked 但未说明原因" });
    if (it.status === "doing" && it.claimedBy && it.claimedAt && nowSec() - it.claimedAt > CLAIM_TTL) gaps.push({ id: it.id, title: it.title, issue: `认领超时（${it.claimedBy}）` });
    if (it.dueAt && it.dueAt < nowSec() && !["done", "dropped"].includes(it.status)) gaps.push({ id: it.id, title: it.title, issue: `已逾期：${new Date(it.dueAt * 1000).toISOString().slice(0, 16)}` });
  }
  return { progress: progressFor(projectId), gaps, total: rows.length };
}
