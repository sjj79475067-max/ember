import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { linkItemToMeeting } from "@/lib/services/meetings";

export const dynamic = "force-dynamic";

/** 把某个已有任务关联到这条会议（不需要重新建条目） */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role === "client") return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const itemId = String(body.item_id ?? "").trim();
  if (!itemId) return Response.json({ ok: false, error: "缺少 item_id" }, { status: 400 });
  try {
    linkItemToMeeting(itemId, id, { type: "user", name: user.name });
    return Response.json({ ok: true });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return Response.json({ ok: false, error: err.message ?? "失败" }, { status: err.status ?? 500 });
  }
}