import { db, s } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";

export type AgentCtx = { tokenId: string; agentName: string; agentType: string; userId: string };

export function openSession(ctx: AgentCtx, opts: { sessionRef?: string; machine?: string; agentName?: string; agentType?: string }) {
  const ref = opts.sessionRef ?? "";
  if (ref) {
    const existing = db.select().from(s.agentSessions).where(and(eq(s.agentSessions.sessionRef, ref), eq(s.agentSessions.status, "open"))).get();
    if (existing) {
      db.update(s.agentSessions).set({ lastSeenAt: nowSec() }).where(eq(s.agentSessions.id, existing.id)).run();
      return existing;
    }
  } else {
    const existing = db.select().from(s.agentSessions).where(and(eq(s.agentSessions.tokenId, ctx.tokenId), eq(s.agentSessions.status, "open"))).get();
    if (existing) {
      db.update(s.agentSessions).set({ lastSeenAt: nowSec() }).where(eq(s.agentSessions.id, existing.id)).run();
      return existing;
    }
  }
  const id = newId("ags");
  db.insert(s.agentSessions).values({
    id, tokenId: ctx.tokenId, agentName: opts.agentName ?? ctx.agentName, agentType: opts.agentType ?? ctx.agentType,
    machine: opts.machine ?? "", sessionRef: ref, startedAt: nowSec(), lastSeenAt: nowSec(),
  }).run();
  return db.select().from(s.agentSessions).where(eq(s.agentSessions.id, id)).get()!;
}

export function heartbeat(sessionId: string) {
  db.update(s.agentSessions).set({ lastSeenAt: nowSec() }).where(eq(s.agentSessions.id, sessionId)).run();
}

export function closeSession(sessionId: string, summary: string) {
  db.update(s.agentSessions).set({ status: "closed", summary, closedAt: nowSec(), lastSeenAt: nowSec() }).where(eq(s.agentSessions.id, sessionId)).run();
}

export function listSessions(limit = 50) {
  return db.select().from(s.agentSessions).orderBy(sql`${s.agentSessions.lastSeenAt} desc`).limit(limit).all();
}
