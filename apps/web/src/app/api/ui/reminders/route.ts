import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ackReminders } from "@/lib/services/reminders";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const { ids, action, snooze_hours } = await req.json();
  const n = ackReminders(ids ?? [], { type: "user", name: user.name }, action ?? "ack", snooze_hours ?? 24);
  return Response.json({ ok: true, updated: n });
}
