import { db, s } from "@/lib/db";
import { desc, eq, gte, sql } from "drizzle-orm";

const DAY = 86400;

export function agentOverview() {
  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - 7 * DAY;
  const sessions = db.select().from(s.agentSessions).orderBy(desc(s.agentSessions.lastSeenAt)).limit(100).all();
  const items = db.select().from(s.items).all();
  const projects = db.select().from(s.projects).all();
  const pname = new Map(projects.map((p) => [p.id, p.name]));
  const events = db.select().from(s.itemEvents).where(gte(s.itemEvents.createdAt, weekAgo)).all();

  const byAgent = new Map<string, { name: string; sessions: number; lastSeen: number; done: number; claimed: number; active: number; types: Set<string> }>();
  for (const sess of sessions) {
    const key = sess.agentName || sess.agentType || "未命名 agent";
    const rec = byAgent.get(key) ?? { name: key, sessions: 0, lastSeen: 0, done: 0, claimed: 0, active: 0, types: new Set<string>() };
    rec.sessions++;
    rec.lastSeen = Math.max(rec.lastSeen, sess.lastSeenAt);
    if (sess.status === "open" && now - sess.lastSeenAt < 3600) rec.active++;
    rec.types.add(sess.agentType);
    byAgent.set(key, rec);
  }
  for (const e of events.filter((x) => x.actorType === "agent")) {
    const rec = byAgent.get(e.actorName);
    if (!rec) continue;
    if (e.action === "complete") rec.done++;
    if (e.action === "claim") rec.claimed++;
  }
  const claimedItems = items.filter((i) => i.claimedBy);
  const staleClaims = claimedItems.filter((i) => i.claimedAt && now - i.claimedAt > 2 * 3600);

  return {
    agents: [...byAgent.values()].map((a) => ({ ...a, types: [...a.types] })).sort((a, b) => b.lastSeen - a.lastSeen),
    active_claims: claimedItems.map((i) => ({
      id: i.id, title: i.title, project: pname.get(i.projectId) ?? "—", projectId: i.projectId,
      status: i.status, claimedBy: i.claimedBy, claimedAt: i.claimedAt,
      stale: !!i.claimedAt && now - i.claimedAt > 2 * 3600,
    })),
    staleCount: staleClaims.length,
    totals: {
      agents: byAgent.size,
      sessionsActive24h: sessions.filter((x) => now - x.lastSeenAt < DAY).length,
      done7d: events.filter((x) => x.action === "complete").length,
      failedVerifications: db.select({ n: sql<number>`count(*)` }).from(s.items).where(sql`${s.items.status}='done' and ${s.items.evidence}=''`).get()?.n ?? 0,
    },
    recentEvents: events.slice(-40).reverse().map((e) => ({
      at: e.createdAt, actor: e.actorName, actorType: e.actorType, action: e.action,
      title: items.find((i) => i.id === e.itemId)?.title ?? e.itemId.slice(0, 8),
      from: e.fromStatus, to: e.toStatus, evidence: e.evidence,
    })),
  };
}

export function releaseStale(itemId: string) {
  db.update(s.items).set({ claimedBy: "", claimedAt: null, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(s.items.id, itemId)).run();
  return true;
}
