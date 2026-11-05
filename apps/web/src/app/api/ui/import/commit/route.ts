import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createMeeting } from "@/lib/services/meetings";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const body = await req.json();
  if (!body.project_id) return Response.json({ ok: false, error: "缺少项目" }, { status: 400 });
  const r = await createMeeting({
    projectId: body.project_id, title: body.title, source: body.source, minutesMd: body.text,
    summaryMd: body.summary, items: body.items, extractItems: false,
  }, { type: "user", name: user.name });
  return Response.json({ ok: true, meetingId: r.meeting?.id, createdCount: r.createdItemIds.length, deduped: r.deduped });
}
