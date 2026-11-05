import { db, s } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { listGroups } from "./boards";

export function projectDetail(idOrKey: string) {
  const p = db.select().from(s.projects).all().find((x) => x.id === idOrKey || x.key === idOrKey);
  if (!p) return null;
  const allItems = db.select().from(s.items).where(eq(s.items.projectId, p.id)).all();
  const parked = allItems.filter((i) => i.parkingLot != null);
  const items = allItems.filter((i) => i.parkingLot == null);
  const meetings = db.select().from(s.meetings).where(eq(s.meetings.projectId, p.id)).orderBy(desc(s.meetings.heldAt)).all();
  const decisions = db.select().from(s.decisions).where(eq(s.decisions.projectId, p.id)).orderBy(desc(s.decisions.createdAt)).all();
  const files = db.select().from(s.fileRefs).where(eq(s.fileRefs.projectId, p.id)).all();
  const policies = db.select().from(s.policies).where(eq(s.policies.projectId, p.id)).all();
  const notes = db.select().from(s.notes).where(eq(s.notes.projectId, p.id)).all();
  const idSet = new Set(allItems.map((i) => i.id));
  const events = db.select().from(s.itemEvents).orderBy(desc(s.itemEvents.createdAt)).limit(120).all()
    .filter((e) => idSet.has(e.itemId)).slice(0, 80);
  const progress = {
    total: items.length,
    done: items.filter((i) => i.status === "done").length,
    doing: items.filter((i) => i.status === "doing").length,
    blocked: items.filter((i) => i.status === "blocked").length,
    changed: items.filter((i) => i.status === "changed").length,
    overdue: items.filter((i) => i.dueAt && i.dueAt < Date.now() / 1000 && !["done", "dropped"].includes(i.status)).length,
    needsReview: items.filter((i) => i.needsReview === 1).length,
  };
  return { project: p, items, parked, groups: listGroups(p.id), meetings, decisions, files, policies, notes, events, progress };
}
