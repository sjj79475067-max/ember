import { db, s } from "@/lib/db";
import { desc, eq, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";

export function listNotes(opts: { projectId?: string; q?: string; limit?: number } = {}) {
  const conds = [];
  if (opts.projectId) conds.push(eq(s.notes.projectId, opts.projectId));
  if (opts.q) conds.push(sql`(${s.notes.title} like ${"%" + opts.q + "%"} or ${s.notes.bodyMd} like ${"%" + opts.q + "%"} or ${s.notes.tags} like ${"%" + opts.q + "%"})`);
  const q = db.select().from(s.notes).orderBy(desc(s.notes.updatedAt)).limit(Math.min(opts.limit ?? 50, 200));
  return conds.length ? q.where(sql`${sql.join(conds, sql` and `)}`).all() : q.all();
}

export function upsertNote(input: { id?: string; projectId?: string | null; title: string; bodyMd?: string; tags?: string; source?: string }, actor: Actor) {
  const at = nowSec();
  if (input.id) {
    const cur = db.select().from(s.notes).where(eq(s.notes.id, input.id)).get();
    if (!cur) throw Object.assign(new Error("笔记不存在"), { status: 404 });
    db.update(s.notes).set({
      title: input.title, bodyMd: input.bodyMd ?? cur.bodyMd, tags: input.tags ?? cur.tags,
      projectId: input.projectId !== undefined ? input.projectId : cur.projectId, updatedAt: at,
    }).where(eq(s.notes.id, input.id)).run();
    audit(actor, "note.update", "note", input.id, { title: input.title });
    return db.select().from(s.notes).where(eq(s.notes.id, input.id)).get()!;
  }
  const id = newId("not");
  db.insert(s.notes).values({ id, projectId: input.projectId ?? null, title: input.title, bodyMd: input.bodyMd ?? "", tags: input.tags ?? "", source: input.source ?? "manual", createdAt: at, updatedAt: at }).run();
  audit(actor, "note.create", "note", id, { title: input.title });
  return db.select().from(s.notes).where(eq(s.notes.id, id)).get()!;
}

export function listDecisions(projectId?: string) {
  const q = db.select().from(s.decisions).orderBy(desc(s.decisions.createdAt)).limit(100);
  return projectId ? q.where(eq(s.decisions.projectId, projectId)).all() : q.all();
}

export function createDecision(input: { projectId: string; title: string; rationaleMd?: string; impact?: string; meetingId?: string }, actor: Actor) {
  const id = newId("dec");
  db.insert(s.decisions).values({ id, projectId: input.projectId, title: input.title, rationaleMd: input.rationaleMd ?? "", impact: input.impact ?? "", meetingId: input.meetingId ?? null, createdAt: nowSec() }).run();
  audit(actor, "decision.create", "decision", id, { title: input.title });
  return db.select().from(s.decisions).where(eq(s.decisions.id, id)).get()!;
}
