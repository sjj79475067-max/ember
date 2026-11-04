import { db, s } from "@/lib/db";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";

const STALE_DAYS = 30;

export function listFiles(opts: { projectId?: string; status?: string; staleOnly?: boolean } = {}) {
  const conds = [];
  if (opts.projectId) conds.push(eq(s.fileRefs.projectId, opts.projectId));
  if (opts.status) conds.push(eq(s.fileRefs.status, opts.status as "active"));
  if (opts.staleOnly) conds.push(sql`(${s.fileRefs.lastVerifiedAt} is null or ${s.fileRefs.lastVerifiedAt} < ${nowSec() - STALE_DAYS * 86400})`);
  const q = db.select().from(s.fileRefs).orderBy(desc(s.fileRefs.updatedAt)).limit(300);
  const rows = conds.length ? q.where(sql`${sql.join(conds, sql` and `)}`).all() : q.all();
  return rows.map((r) => ({ ...r, stale: !r.lastVerifiedAt || nowSec() - r.lastVerifiedAt > STALE_DAYS * 86400 }));
}

export function registerFile(input: {
  projectId: string; itemId?: string; label: string; machine?: string; path?: string; url?: string;
  kind?: string; archiveTo?: "local" | "github" | "r2" | "other"; sizeBytes?: number; note?: string;
}, actor: Actor, verify = false) {
  const existing = input.path
    ? db.select().from(s.fileRefs).where(and(eq(s.fileRefs.projectId, input.projectId), eq(s.fileRefs.path, input.path))).get()
    : undefined;
  const at = nowSec();
  if (existing) {
    db.update(s.fileRefs).set({
      label: input.label, machine: input.machine ?? existing.machine, url: input.url ?? existing.url,
      kind: input.kind ?? existing.kind, archiveTo: input.archiveTo ?? existing.archiveTo,
      sizeBytes: input.sizeBytes ?? existing.sizeBytes, note: input.note ?? existing.note,
      status: existing.status === "missing" || existing.status === "moved" ? "active" : existing.status,
      updatedAt: at, ...(verify ? { lastVerifiedAt: at, verifiedBy: actor.name } : {}),
    }).where(eq(s.fileRefs.id, existing.id)).run();
    audit(actor, "file.update", "file", existing.id, input);
    return db.select().from(s.fileRefs).where(eq(s.fileRefs.id, existing.id)).get()!;
  }
  const id = newId("fil");
  db.insert(s.fileRefs).values({
    id, projectId: input.projectId, itemId: input.itemId ?? null, label: input.label,
    machine: input.machine ?? "", path: input.path ?? "", url: input.url ?? "", kind: input.kind ?? "file",
    archiveTo: input.archiveTo ?? "local", sizeBytes: input.sizeBytes ?? null, note: input.note ?? "",
    lastVerifiedAt: verify ? at : null, verifiedBy: verify ? actor.name : "", createdAt: at, updatedAt: at,
  }).run();
  audit(actor, "file.register", "file", id, input);
  return db.select().from(s.fileRefs).where(eq(s.fileRefs.id, id)).get()!;
}

export function verifyFile(id: string, input: { result: "ok" | "missing" | "moved"; newPath?: string; note?: string }, actor: Actor) {
  const cur = db.select().from(s.fileRefs).where(eq(s.fileRefs.id, id)).get();
  if (!cur) throw Object.assign(new Error("资料记录不存在"), { status: 404 });
  const at = nowSec();
  const status = input.result === "ok" ? "active" : input.result === "moved" ? "moved" : "missing";
  db.update(s.fileRefs).set({
    status, lastVerifiedAt: at, verifiedBy: actor.name,
    path: input.newPath ?? cur.path, note: input.note ?? cur.note, updatedAt: at,
  }).where(eq(s.fileRefs.id, id)).run();
  audit(actor, "file.verify", "file", id, input);
  return db.select().from(s.fileRefs).where(eq(s.fileRefs.id, id)).get()!;
}

export function staleFiles() {
  return db.select().from(s.fileRefs).where(lt(s.fileRefs.lastVerifiedAt, nowSec() - STALE_DAYS * 86400)).all();
}
