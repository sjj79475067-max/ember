import { db, s } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const dump = {
    exported_at: new Date().toISOString(),
    version: "1.0.0",
    projects: db.select().from(s.projects).all(),
    workstreams: db.select().from(s.workstreams).all(),
    items: db.select().from(s.items).all(),
    item_events: db.select().from(s.itemEvents).all(),
    meetings: db.select().from(s.meetings).all(),
    decisions: db.select().from(s.decisions).all(),
    notes: db.select().from(s.notes).all(),
    file_refs: db.select().from(s.fileRefs).all(),
    reminders: db.select().from(s.reminders).all(),
    policies: db.select().from(s.policies).all(),
    policy_acks: db.select().from(s.policyAcks).all(),
    agent_sessions: db.select().from(s.agentSessions).all(),
    import_batches: db.select().from(s.importBatches).all().map((b) => ({ ...b, rawText: b.rawText.slice(0, 2000) })),
  };
  return new Response(JSON.stringify(dump, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="ember-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
