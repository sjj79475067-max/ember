import { db, s } from "@/lib/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";

export type ProjectInput = {
  key: string; name: string; kind?: "it" | "admin" | "client" | "knowledge";
  status?: "active" | "paused" | "done" | "archived"; summaryMd?: string;
  dueAt?: number | null; localRoot?: string; githubRepo?: string; archiveNote?: string;
};

export function listProjects(opts: { status?: string; q?: string; includeArchived?: boolean } = {}) {
  const rows = db.select().from(s.projects).orderBy(asc(s.projects.position), desc(s.projects.updatedAt)).all();
  const counts = db.select({
    projectId: s.items.projectId,
    total: sql<number>`count(*)`,
    done: sql<number>`sum(case when ${s.items.status}='done' then 1 else 0 end)`,
    blocked: sql<number>`sum(case when ${s.items.status}='blocked' then 1 else 0 end)`,
    overdue: sql<number>`sum(case when ${s.items.dueAt} is not null and ${s.items.dueAt} < ${nowSecSi()} and ${s.items.status} not in ('done','dropped') then 1 else 0 end)`,
  }).from(s.items).groupBy(s.items.projectId).all();
  const cmap = new Map(counts.map((c) => [c.projectId, c]));
  let out = rows.map((p) => {
    const c = cmap.get(p.id);
    return { ...p, progress: { total: c?.total ?? 0, done: c?.done ?? 0, blocked: c?.blocked ?? 0, overdue: c?.overdue ?? 0 } };
  });
  if (!opts.includeArchived) out = out.filter((p) => p.status !== "archived");
  if (opts.status) out = out.filter((p) => p.status === opts.status);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    out = out.filter((p) => p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q));
  }
  return out;
}

const nowSecSi = () => Math.floor(Date.now() / 1000);

export function getProject(idOrKey: string) {
  const p = db.select().from(s.projects).where(sql`${s.projects.id} = ${idOrKey} or ${s.projects.key} = ${idOrKey}`).get();
  if (!p) return null;
  const ws = db.select().from(s.workstreams).where(eq(s.workstreams.projectId, p.id)).orderBy(asc(s.workstreams.position)).all();
  const items = db.select().from(s.items).where(eq(s.items.projectId, p.id)).orderBy(asc(s.items.position), asc(s.items.createdAt)).all();
  const files = db.select().from(s.fileRefs).where(eq(s.fileRefs.projectId, p.id)).all();
  const recentMeetings = db.select().from(s.meetings).where(eq(s.meetings.projectId, p.id)).orderBy(desc(s.meetings.heldAt)).limit(5).all();
  const recentDecisions = db.select().from(s.decisions).where(eq(s.decisions.projectId, p.id)).orderBy(desc(s.decisions.createdAt)).limit(5).all();
  const rules = db.select().from(s.policies).where(eq(s.policies.projectId, p.id)).all();
  return { ...p, workstreams: ws, items, files, meetings: recentMeetings, decisions: recentDecisions, policies: rules };
}

export function createProject(input: ProjectInput, actor: Actor, ip = "") {
  const dup = db.select().from(s.projects).where(eq(s.projects.key, input.key)).get();
  if (dup) throw Object.assign(new Error(`项目代号 ${input.key} 已存在`), { status: 409 });
  const id = newId("prj");
  db.insert(s.projects).values({
    id, key: input.key, name: input.name, kind: input.kind ?? "admin", status: input.status ?? "active",
    summaryMd: input.summaryMd ?? "", dueAt: input.dueAt ?? null, localRoot: input.localRoot ?? "",
    githubRepo: input.githubRepo ?? "", archiveNote: input.archiveNote ?? "", createdAt: nowSec(), updatedAt: nowSec(),
  }).run();
  audit(actor, "project.create", "project", id, { key: input.key }, { ip });
  return getProject(id)!;
}

export function updateProject(idOrKey: string, patch: Partial<ProjectInput>, actor: Actor, ip = "") {
  const p = getProject(idOrKey);
  if (!p) throw Object.assign(new Error("项目不存在"), { status: 404 });
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  db.update(s.projects).set({ ...clean, updatedAt: nowSec() }).where(eq(s.projects.id, p.id)).run();
  audit(actor, "project.update", "project", p.id, clean, { ip });
  return getProject(p.id)!;
}
