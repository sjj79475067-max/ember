import { pullReminders } from "@/lib/services/reminders";
import { db, s } from "@/lib/db";
import { InboxClient } from "./inbox-client";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const rows = pullReminders({ includeAcked: true, limit: 200 });
  const projects = db.select().from(s.projects).all().map((p) => ({ id: p.id, name: p.name }));
  return <InboxClient initial={JSON.parse(JSON.stringify(rows))} projects={projects} />;
}
