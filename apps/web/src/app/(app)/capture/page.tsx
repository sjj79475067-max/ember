import { listCaptures, TYPE_LABEL, resultHref } from "@/lib/capture/service";
import { db, s } from "@/lib/db";
import { sql } from "drizzle-orm";
import { CaptureClient } from "./capture-client";

export const dynamic = "force-dynamic";

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ id?: string; all?: string }> }) {
  const sp = await searchParams;
  const caps = listCaptures({ status: sp.all ? "all" : "open", limit: 60 });
  if (sp.id && !caps.some((c) => c.id === sp.id)) caps.unshift(...listCaptures({ status: "all", limit: 200 }).filter((c) => c.id === sp.id));
  const projects = db.select().from(s.projects).all().filter((p) => p.status === "active" && p.isInbox !== 1).map((p) => ({ id: p.id, name: p.name }));
  const names = new Map(db.select().from(s.projects).all().map((p) => [p.id, p.name]));
  const targets = new Map(db.select({ id: s.items.id, title: s.items.title }).from(s.items).where(sql`${s.items.id} in (select targetItemId from capture_drafts where targetItemId is not null)`).all().map((i) => [i.id, i.title]));
  const data = caps.map((c) => ({
    id: c.id, channel: c.channel, kind: c.kind, text: c.transcript || c.rawText, status: c.status, error: c.error, parser: c.parser, createdAt: c.createdAt,
    drafts: c.drafts.map((d) => ({
      id: d.id, type: d.type, projectId: d.projectId, projectName: d.projectId ? names.get(d.projectId) ?? "" : "", confidence: d.projectConfidence,
      title: d.title, detail: d.detail, dueAt: d.dueAt, remindAt: d.remindAt, priority: d.priority, waitingFor: d.waitingFor, evidence: d.evidence, done: d.done === 1,
      targetTitle: d.targetItemId ? targets.get(d.targetItemId) ?? "" : "", status: d.status, href: resultHref(d) ?? null,
    })),
  }));
  return <CaptureClient data={JSON.parse(JSON.stringify({ captures: data, projects, typeLabel: TYPE_LABEL, focus: sp.id ?? null, showAll: !!sp.all }))} />;
}
