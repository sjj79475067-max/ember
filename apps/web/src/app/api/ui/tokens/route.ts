import { NextRequest } from "next/server";
import { db, s } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSessionUser, mintApiToken } from "@/lib/auth";
import { nowSec } from "@/lib/id";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const rows = db.select().from(s.apiTokens).all().map((t) => ({ id: t.id, name: t.name, agentType: t.agentType, prefix: t.prefix, scopes: t.scopes, lastUsedAt: t.lastUsedAt, revokedAt: t.revokedAt, createdAt: t.createdAt }));
  return Response.json({ ok: true, tokens: rows });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const { name, agent_type, scopes } = await req.json();
  if (!name?.trim()) return Response.json({ ok: false, error: "请填写名称" }, { status: 400 });
  const t = mintApiToken(name.trim(), agent_type ?? "generic", scopes ?? "read,write");
  return Response.json({ ok: true, token: t.raw, id: t.id });
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "缺少 id" }, { status: 400 });
  db.update(s.apiTokens).set({ revokedAt: nowSec() }).where(eq(s.apiTokens.id, id)).run();
  return Response.json({ ok: true });
}
