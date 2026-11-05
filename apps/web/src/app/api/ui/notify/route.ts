import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { notifyConfig, setSetting, pushUrgent, sendNotification } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const c = notifyConfig();
  return Response.json({ ok: true, config: { ...c, barkUrl: mask(c.barkUrl), webhookUrl: mask(c.webhookUrl) }, configured: !!(c.barkUrl || c.ntfyTopic || c.webhookUrl) });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const b = await req.json();
  if (b.action === "test") {
    const r = await sendNotification("Ember 测试通知", "如果你看到这条，说明推送已接通。");
    return Response.json({ ok: true, result: r });
  }
  if (b.action === "push") {
    const r = await pushUrgent(!!b.dry_run);
    return Response.json({ ok: true, result: r });
  }
  setSetting("notify.enabled", b.enabled ? "1" : "0");
  setSetting("notify.channel", b.channel ?? "bark");
  if (b.bark_url) setSetting("notify.bark_url", b.bark_url);
  setSetting("notify.ntfy_topic", b.ntfy_topic ?? "");
  setSetting("notify.ntfy_server", b.ntfy_server ?? "https://ntfy.sh");
  if (b.webhook_url) setSetting("notify.webhook_url", b.webhook_url);
  setSetting("notify.min_severity", b.min_severity ?? "P0");
  return Response.json({ ok: true });
}

function mask(u: string) {
  if (!u) return "";
  return u.length <= 12 ? "***" : `${u.slice(0, 8)}…${u.slice(-4)}`;
}
