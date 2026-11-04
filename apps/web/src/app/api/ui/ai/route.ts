import { NextRequest } from "next/server";
import { db, s } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { encryptKey, testProvider, getDefaultProvider } from "@/lib/ai/provider";
import { newId, nowSec } from "@/lib/id";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const rows = db.select().from(s.aiProviders).all().map((p) => ({ id: p.id, label: p.label, kind: p.kind, baseUrl: p.baseUrl, model: p.model, enabled: p.enabled, isDefault: p.isDefault, hasKey: !!p.apiKeyEnc }));
  const usage = db.select().from(s.aiUsage).all();
  return Response.json({ ok: true, providers: rows, usage: { calls: usage.length, input: usage.reduce((a, u) => a + u.inputTokens, 0), output: usage.reduce((a, u) => a + u.outputTokens, 0) }, ready: !!getDefaultProvider() });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const b = await req.json();
  if (b.action === "test") {
    const p = db.select().from(s.aiProviders).where(eq(s.aiProviders.id, b.id)).get();
    if (!p) return Response.json({ ok: false, error: "Provider 不存在" }, { status: 404 });
    return Response.json({ ok: true, result: await testProvider(p) });
  }
  if (b.action === "delete") {
    db.delete(s.aiProviders).where(eq(s.aiProviders.id, b.id)).run();
    return Response.json({ ok: true });
  }
  if (b.action === "default") {
    db.update(s.aiProviders).set({ isDefault: 0 }).run();
    db.update(s.aiProviders).set({ isDefault: 1 }).where(eq(s.aiProviders.id, b.id)).run();
    return Response.json({ ok: true });
  }
  const key = b.api_key ? encryptKey(b.api_key) : b.id ? db.select().from(s.aiProviders).where(eq(s.aiProviders.id, b.id)).get()?.apiKeyEnc ?? "" : "";
  if (b.id) {
    db.update(s.aiProviders).set({ label: b.label, kind: b.kind, baseUrl: b.base_url ?? "", model: b.model ?? "", apiKeyEnc: key, enabled: b.enabled ? 1 : 0 }).where(eq(s.aiProviders.id, b.id)).run();
  } else {
    const id = newId("aip");
    db.insert(s.aiProviders).values({ id, label: b.label, kind: b.kind, baseUrl: b.base_url ?? "", model: b.model ?? "", apiKeyEnc: key, enabled: 1, isDefault: 0, createdAt: nowSec() }).run();
  }
  return Response.json({ ok: true });
}

