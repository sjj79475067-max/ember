import { weeklyMaterial, weekStartYmd } from "@/lib/services/secretary";
import { db, s } from "@/lib/db";
import { sql } from "drizzle-orm";
import { ReviewClient } from "./review-client";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const week = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : weekStartYmd();
  const m = weeklyMaterial(week);
  const projects = new Map(db.select().from(s.projects).all().map((p) => [p.id, p]));
  const options = db.select().from(s.items).where(sql`${s.items.status} in ('todo','doing','blocked','changed') and ${s.items.parkingLot} is null and ${s.items.supersededBy} = ''`).all()
    .filter((i) => projects.get(i.projectId)?.status === "active")
    .sort((a, b) => a.priority.localeCompare(b.priority) || (a.dueAt ?? 9e12) - (b.dueAt ?? 9e12))
    .slice(0, 300).map((i) => ({ id: i.id, title: i.title, projectName: projects.get(i.projectId)?.name ?? "", priority: i.priority }));
  const inbox = [...projects.values()].find((p) => p.isInbox === 1);
  return <ReviewClient data={JSON.parse(JSON.stringify({ ...m, options, inboxId: inbox?.id ?? null, thisWeek: weekStartYmd() }))} />;
}
