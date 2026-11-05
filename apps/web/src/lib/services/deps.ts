import { db, s } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";

const CLOSED = ["done", "dropped"];

/** 依赖只有一种：blocker 完成后 blocked 才能开始。写入前做环检测。 */
export function addDep(blockerId: string, blockedId: string, actor: Actor, lagDays = 0) {
  if (blockerId === blockedId) throw Object.assign(new Error("事项不能依赖自己"), { status: 422 });
  const a = db.select().from(s.items).where(eq(s.items.id, blockerId)).get();
  const b = db.select().from(s.items).where(eq(s.items.id, blockedId)).get();
  if (!a || !b) throw Object.assign(new Error("事项不存在"), { status: 404 });
  if (reaches(blockedId, blockerId)) throw Object.assign(new Error(`会形成循环依赖：「${b.title}」已经（间接）卡着「${a.title}」`), { status: 422 });
  const exist = db.select().from(s.itemDeps).where(and(eq(s.itemDeps.blockerId, blockerId), eq(s.itemDeps.blockedId, blockedId))).get();
  if (exist) return exist;
  const id = newId("dep");
  db.insert(s.itemDeps).values({ id, blockerId, blockedId, lagDays, createdBy: actor.name, createdAt: nowSec() }).run();
  audit(actor, "dep.add", "item", blockedId, { blockerId, lagDays });
  return db.select().from(s.itemDeps).where(eq(s.itemDeps.id, id)).get()!;
}

export function removeDep(blockerId: string, blockedId: string, actor: Actor) {
  db.delete(s.itemDeps).where(and(eq(s.itemDeps.blockerId, blockerId), eq(s.itemDeps.blockedId, blockedId))).run();
  audit(actor, "dep.remove", "item", blockedId, { blockerId });
  return { ok: true };
}

/** from 是否能沿着「卡着谁」到达 to（用于环检测） */
function reaches(from: string, to: string) {
  const all = db.select().from(s.itemDeps).all();
  const next = new Map<string, string[]>();
  for (const d of all) next.set(d.blockerId, [...(next.get(d.blockerId) ?? []), d.blockedId]);
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(next.get(cur) ?? []));
  }
  return false;
}

export type DepView = {
  blockerId: string; blockedId: string; lagDays: number;
  blockerTitle: string; blockedTitle: string; blockerStatus: string; blockedStatus: string;
  blockerProjectId: string; blockedProjectId: string;
  /** blocker 未完成且其截止日晚于 blocked 的开始/截止：计划本身排不开 */
  violated: boolean;
};

/** 涉及给定事项集合的所有依赖（含跨项目的另一端） */
export function depsFor(itemIds: string[]): DepView[] {
  if (!itemIds.length) return [];
  const rows = [
    ...db.select().from(s.itemDeps).where(inArray(s.itemDeps.blockedId, itemIds)).all(),
    ...db.select().from(s.itemDeps).where(inArray(s.itemDeps.blockerId, itemIds)).all(),
  ];
  const uniq = [...new Map(rows.map((r) => [r.id, r])).values()];
  const ids = [...new Set(uniq.flatMap((r) => [r.blockerId, r.blockedId]))];
  const items = ids.length ? db.select().from(s.items).where(inArray(s.items.id, ids)).all() : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  return uniq.map((d) => {
    const a = byId.get(d.blockerId), b = byId.get(d.blockedId);
    const bStart = b?.startAt ?? b?.dueAt ?? null;
    const violated = !!(a && b && !CLOSED.includes(a.status) && !CLOSED.includes(b.status) && a.dueAt && bStart && a.dueAt + d.lagDays * 86400 > bStart);
    return {
      blockerId: d.blockerId, blockedId: d.blockedId, lagDays: d.lagDays,
      blockerTitle: a?.title ?? "(已删除)", blockedTitle: b?.title ?? "(已删除)",
      blockerStatus: a?.status ?? "dropped", blockedStatus: b?.status ?? "dropped",
      blockerProjectId: a?.projectId ?? "", blockedProjectId: b?.projectId ?? "", violated,
    };
  });
}

/** 某事项还在等的前置（未完成的 blocker） */
export function waitingOn(itemId: string) {
  return depsFor([itemId]).filter((d) => d.blockedId === itemId && !CLOSED.includes(d.blockerStatus));
}

export function cleanupDepsForItem(itemId: string) {
  db.delete(s.itemDeps).where(eq(s.itemDeps.blockerId, itemId)).run();
  db.delete(s.itemDeps).where(eq(s.itemDeps.blockedId, itemId)).run();
}