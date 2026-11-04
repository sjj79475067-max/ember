import { db, s } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbState = "down";
  const counts: Record<string, number> = {};
  try {
    counts.projects = db.select({ n: sql<number>`count(*)` }).from(s.projects).get()?.n ?? 0;
    counts.items = db.select({ n: sql<number>`count(*)` }).from(s.items).get()?.n ?? 0;
    dbState = "up";
  } catch {
    counts.error = 1;
  }
  return Response.json({ ok: dbState === "up", db: dbState, version: "1.0.0", counts, time: new Date().toISOString() });
}
