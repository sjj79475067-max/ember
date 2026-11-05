import { NextRequest } from "next/server";
import { buildBrief } from "@/lib/ai/brief";
import { sendNotification, notifyConfig } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * 定时推送入口：系统 crontab 或外部定时器每天调用一次。
 *   curl -X POST "http://localhost:3000/api/scheduled/brief?key=$CRON_KEY&kind=daily"
 */
export async function POST(req: NextRequest) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const expected = process.env.CRON_KEY ?? "";
  if (!expected || key !== expected) return Response.json({ ok: false, error: "缺少或错误的 CRON_KEY" }, { status: 401 });
  const kind = new URL(req.url).searchParams.get("kind") === "weekly" ? "weekly" : "daily";
  const brief = await buildBrief(kind, true);
  const cfg = notifyConfig();
  if (!cfg.enabled) return Response.json({ ok: true, skipped: "通知未启用", md: brief.md });
  const r = await sendNotification(kind === "daily" ? "Ember 今日简报" : "Ember 本周周报", brief.md.slice(0, 900));
  return Response.json({ ok: true, sent: r });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
