import { db, s } from "@/lib/db";
import { asc, eq, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";

/** 项目内的分组（工作流）：交付 / 内部 / 外部依赖 等。用于把长清单折叠成几段。 */
export function listGroups(projectId: string) {
  const groups = db.select().from(s.workstreams).where(eq(s.workstreams.projectId, projectId)).orderBy(asc(s.workstreams.position)).all();
  const rows = db.select({ workstreamId: s.items.workstreamId, status: s.items.status, parkingLot: s.items.parkingLot }).from(s.items).where(eq(s.items.projectId, projectId)).all();
  const stat = new Map<string, { total: number; done: number }>();
  for (const r of rows) {
    if (r.parkingLot != null) continue;
    const k = r.workstreamId ?? "";
    const cur = stat.get(k) ?? { total: 0, done: 0 };
    cur.total++;
    if (r.status === "done") cur.done++;
    stat.set(k, cur);
  }
  const out = groups.map((g) => ({ ...g, stat: stat.get(g.id) ?? { total: 0, done: 0 } }));
  const ungrouped = stat.get("") ?? { total: 0, done: 0 };
  return { groups: out, ungrouped };
}

/**
 * 设置项目分组：传入名称数组（按顺序），已存在的保留 id（任务挂靠不丢），多余的分组删除并把其任务移回「未分组」。
 * 任务挂到哪个分组由 checklist_update / checklist_add 的 group 参数决定。
 */
export function setProjectGroups(projectId: string, names: string[], actor: Actor) {
  const clean = names.map((n) => n.trim()).filter(Boolean).slice(0, 20);
  const existing = db.select().from(s.workstreams).where(eq(s.workstreams.projectId, projectId)).all();
  db.transaction(() => {
    existing.forEach((ws, idx) => {
      if (!clean.includes(ws.name)) {
        db.update(s.items).set({ workstreamId: null }).where(eq(s.items.workstreamId, ws.id)).run();
        db.delete(s.workstreams).where(eq(s.workstreams.id, ws.id)).run();
      } else {
        db.update(s.workstreams).set({ position: clean.indexOf(ws.name) }).where(eq(s.workstreams.id, ws.id)).run();
      }
      void idx;
    });
    clean.forEach((name, idx) => {
      const found = existing.find((w) => w.name === name);
      if (found) return;
      db.insert(s.workstreams).values({ id: newId("ws"), projectId, name, position: idx, createdAt: nowSec() }).run();
    });
  });
  audit(actor, "project.groups", "project", projectId, { names: clean });
  return listGroups(projectId);
}

export function groupByName(projectId: string, nameOrId: string | undefined | null) {
  if (!nameOrId) return null;
  const all = db.select().from(s.workstreams).where(eq(s.workstreams.projectId, projectId)).all();
  return all.find((w) => w.id === nameOrId || w.name === nameOrId) ?? null;
}

export function ensureGroup(projectId: string, nameOrId: string) {
  const g = groupByName(projectId, nameOrId);
  if (g) return g;
  const max = db.select({ m: sql<number>`coalesce(max(${s.workstreams.position}),-1)` }).from(s.workstreams).where(eq(s.workstreams.projectId, projectId)).get()?.m ?? -1;
  const id = newId("ws");
  db.insert(s.workstreams).values({ id, projectId, name: nameOrId.trim().slice(0, 40), position: max + 1, createdAt: nowSec() }).run();
  return db.select().from(s.workstreams).where(eq(s.workstreams.id, id)).get()!;
}

export function setItemGroup(itemId: string, groupName: string | null) {
  const it = db.select().from(s.items).where(eq(s.items.id, itemId)).get();
  if (!it) throw Object.assign(new Error("任务不存在"), { status: 404 });
  const g = groupName ? ensureGroup(it.projectId, groupName) : null;
  db.update(s.items).set({ workstreamId: g?.id ?? null, updatedAt: nowSec() }).where(eq(s.items.id, itemId)).run();
  return { ok: true, group: g?.name ?? null };
}