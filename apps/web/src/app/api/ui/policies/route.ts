import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { upsertPolicy, ackPolicy, approvePolicy, retirePolicy, reviewPolicy } from "@/lib/services/policies";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role === "client") return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const b = await req.json();
  const actor = { type: "user" as const, name: user.name };
  try {
    if (b.action === "ack") return Response.json({ ...ackPolicy(b.id, user.name), ok: true });
    if (b.action === "approve") return Response.json({ policy: approvePolicy(b.id, actor), ok: true });
    if (b.action === "retire") return Response.json({ ...retirePolicy(b.id, actor, b.reason) });
    if (b.action === "review") return Response.json({ ...reviewPolicy(b.id, actor) });
    const { byAgent: _ignored, ...p } = upsertPolicy({
      id: b.id, projectId: b.project_id ?? null, title: b.title, bodyMd: b.body_md, required: !!b.required,
      appliesToTools: b.applies_to_tools, purpose: b.purpose, scopeMode: b.scope_mode, expiresAt: b.expires_at ?? null,
      reviewEveryDays: b.review_every_days ?? null, approved: !!b.approved, status: b.status,
    }, actor);
    return Response.json({ ok: true, policy: p });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return Response.json({ ok: false, error: err.message ?? "失败" }, { status: err.status ?? 500 });
  }
}
