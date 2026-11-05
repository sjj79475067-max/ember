import { secretaryOverview } from "@/lib/services/secretary";
import { db, s } from "@/lib/db";
import { sql } from "drizzle-orm";
import { TodayClient } from "./today-client";

export const dynamic = "force-dynamic";

export default function TodayPage() {
  const o = secretaryOverview();
  const onToday = new Set(o.today.map((x) => x.id));
  const projects = new Map(db.select().from(s.projects).all().map((p) => [p.id, p]));
  // 可加入今天的候选：未完成、未搁置、不在等别人、不在收件箱，按优先级与截止排序
  const t = Math.floor(Date.now() / 1000);
  const candidates = db.select().from(s.items).where(sql`${s.items.status} in ('todo','doing','changed') and ${s.items.parkingLot} is null and ${s.items.waitingFor} = '' and ${s.items.supersededBy} = ''`).all()
    .filter((i) => !onToday.has(i.id) && projects.get(i.projectId)?.status === "active" && projects.get(i.projectId)?.isInbox !== 1 && !(i.deferUntil && i.deferUntil > t))
    .sort((a, b) => a.priority.localeCompare(b.priority) || (a.dueAt ?? 9e12) - (b.dueAt ?? 9e12))
    .slice(0, 400) // 前端搜索，给足候选
    .map((i) => ({ id: i.id, title: i.title, projectName: projects.get(i.projectId)?.name ?? "", priority: i.priority, dueAt: i.dueAt }));
  return <TodayClient data={JSON.parse(JSON.stringify({ ...o, candidates }))} />;
}
