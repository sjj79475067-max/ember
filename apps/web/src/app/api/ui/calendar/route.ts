import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { mintFeed, revokeFeed } from "@/lib/services/calendar";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role === "client") return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const actor = { type: "user" as const, name: user.name };
  if (b.action === "revoke") return Response.json(revokeFeed(b.id, actor));
  const f = mintFeed(b.name ?? "手机日历", actor);
  return Response.json({ ok: true, id: f.id, token: f.raw });
}
