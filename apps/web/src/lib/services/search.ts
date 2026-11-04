import { db, s } from "@/lib/db";
import { sql } from "drizzle-orm";

export type SearchHit = { type: string; id: string; title: string; snippet: string; projectId?: string | null; url: string };

export function search(q: string, opts: { types?: string[]; limit?: number } = {}) {
  const term = `%${q.replace(/[%_]/g, "")}%`;
  const limit = Math.min(opts.limit ?? 20, 100);
  const want = (t: string) => !opts.types?.length || opts.types.includes(t);
  const hits: SearchHit[] = [];
  if (want("item")) {
    for (const r of db.select().from(s.items).where(sql`${s.items.title} like ${term} or ${s.items.detailMd} like ${term}`).limit(limit).all())
      hits.push({ type: "item", id: r.id, title: r.title, snippet: r.detailMd.slice(0, 140), projectId: r.projectId, url: `/p/${r.projectId}#item-${r.id}` });
  }
  if (want("meeting")) {
    for (const r of db.select().from(s.meetings).where(sql`${s.meetings.title} like ${term} or ${s.meetings.minutesMd} like ${term} or ${s.meetings.summaryMd} like ${term}`).limit(limit).all())
      hits.push({ type: "meeting", id: r.id, title: r.title, snippet: r.summaryMd.slice(0, 140), projectId: r.projectId, url: `/p/${r.projectId}/meetings/${r.id}` });
  }
  if (want("note")) {
    for (const r of db.select().from(s.notes).where(sql`${s.notes.title} like ${term} or ${s.notes.bodyMd} like ${term}`).limit(limit).all())
      hits.push({ type: "note", id: r.id, title: r.title, snippet: r.bodyMd.slice(0, 140), projectId: r.projectId, url: `/notes/${r.id}` });
  }
  if (want("decision")) {
    for (const r of db.select().from(s.decisions).where(sql`${s.decisions.title} like ${term} or ${s.decisions.rationaleMd} like ${term}`).limit(limit).all())
      hits.push({ type: "decision", id: r.id, title: r.title, snippet: r.rationaleMd.slice(0, 140), projectId: r.projectId, url: `/p/${r.projectId}#decisions` });
  }
  if (want("file")) {
    for (const r of db.select().from(s.fileRefs).where(sql`${s.fileRefs.label} like ${term} or ${s.fileRefs.path} like ${term}`).limit(limit).all())
      hits.push({ type: "file", id: r.id, title: r.label, snippet: r.path || r.url, projectId: r.projectId, url: `/files?focus=${r.id}` });
  }
  if (want("project")) {
    for (const r of db.select().from(s.projects).where(sql`${s.projects.name} like ${term} or ${s.projects.key} like ${term}`).limit(limit).all())
      hits.push({ type: "project", id: r.id, title: `${r.key} · ${r.name}`, snippet: r.summaryMd.slice(0, 140), projectId: r.id, url: `/p/${r.id}` });
  }
  return hits.slice(0, limit);
}
