import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { agentOverview, releaseStale } from "@/lib/services/oversight";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  return Response.json({ ok: true, data: agentOverview() });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const { action, item_id } = await req.json();
  if (action === "release" && item_id) { releaseStale(item_id); return Response.json({ ok: true }); }
  if (action === "release_stale") {
    const d = agentOverview();
    const stale = d.active_claims.filter((x) => x.stale);
    for (const c of stale) releaseStale(c.id);
    return Response.json({ ok: true, released: stale.length });
  }
  return Response.json({ ok: false, error: "未知操作" }, { status: 400 });
}
