import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { buildBrief } from "@/lib/ai/brief";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const kind = p.get("kind") === "weekly" ? "weekly" : "daily";
  const r = await buildBrief(kind, p.get("ai") !== "0");
  return Response.json({ ok: true, ...r });
}
