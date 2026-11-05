import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { decideGate, deleteMilestone } from "@/lib/services/milestones";
import { confirmDrop } from "@/lib/services/requirements";
import { db, s } from "@/lib/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** 只给网页用户的决策动作：阶段门、确认放弃需求、项目更新节奏。agent 走 MCP，拿不到这些权限。 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role === "client") return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const actor = { type: "user" as const, name: user.name };
  try {
    if (b.action === "gate") return Response.json({ ok: true, milestone: decideGate(b.id, b.decision, b.note ?? "", actor) });
    if (b.action === "milestone_delete") return Response.json(deleteMilestone(b.id, actor));
    if (b.action === "confirm_drop") return Response.json({ ok: true, requirement: confirmDrop(b.id, !!b.accept, actor) });
    if (b.action === "update_cadence") {
      const n = Math.max(1, Math.min(60, Number(b.days) || 7));
      db.update(s.projects).set({ updateEveryDays: n }).where(eq(s.projects.id, b.project_id)).run();
      return Response.json({ ok: true, days: n });
    }
    return Response.json({ ok: false, error: "未知操作" }, { status: 400 });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return Response.json({ ok: false, error: err.message ?? "失败" }, { status: err.status ?? 500 });
  }
}