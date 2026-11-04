import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { upsertPolicy, ackPolicy } from "@/lib/services/policies";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const b = await req.json();
  if (b.action === "ack") {
    const a = ackPolicy(b.id, user.name);
    return Response.json({ ...a, ok: true });
  }
  const p = upsertPolicy({ id: b.id, projectId: b.project_id ?? null, title: b.title, bodyMd: b.body_md, required: !!b.required, appliesToTools: b.applies_to_tools }, { type: "user", name: user.name });
  return Response.json({ ok: true, policy: p });
}
