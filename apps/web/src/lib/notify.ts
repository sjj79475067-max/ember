import { db, s } from "@/lib/db";
import { eq } from "drizzle-orm";
import { nowSec } from "@/lib/id";

/** 设置项读写（通知配置等） */
export function getSetting(key: string, fallback = "") {
  return db.select().from(s.settings).where(eq(s.settings.key, key)).get()?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  const exists = db.select().from(s.settings).where(eq(s.settings.key, key)).get();
  if (exists) db.update(s.settings).set({ value, updatedAt: nowSec() }).where(eq(s.settings.key, key)).run();
  else db.insert(s.settings).values({ key, value, updatedAt: nowSec() }).run();
}

export type Channel = "bark" | "ntfy" | "webhook";

export function notifyConfig() {
  return {
    enabled: getSetting("notify.enabled", "0") === "1",
    channel: (getSetting("notify.channel", "bark") as Channel),
    barkUrl: getSetting("notify.bark_url", ""),
    ntfyTopic: getSetting("notify.ntfy_topic", ""),
    ntfyServer: getSetting("notify.ntfy_server", "https://ntfy.sh"),
    webhookUrl: getSetting("notify.webhook_url", ""),
    minSeverity: getSetting("notify.min_severity", "P0"),
    lastSentAt: Number(getSetting("notify.last_sent_at", "0")),
  };
}

export async function sendNotification(title: string, body: string) {
  const c = notifyConfig();
  if (!c.enabled) return { sent: false, reason: "未启用" };
  try {
    if (c.channel === "bark" && c.barkUrl) {
      const base = c.barkUrl.replace(/\/$/, "");
      const url = `${base}/${encodeURIComponent(title)}/${encodeURIComponent(body.slice(0, 400))}?group=ember&level=timeSensitive`;
      const r = await fetch(url, { method: "GET" });
      setSetting("notify.last_sent_at", String(nowSec()));
      return { sent: r.ok, detail: `Bark ${r.status}` };
    }
    if (c.channel === "ntfy" && c.ntfyTopic) {
      const r = await fetch(`${c.ntfyServer.replace(/\/$/, "")}/${c.ntfyTopic}`, {
        method: "POST",
        headers: { "content-type": "text/plain; charset=utf-8", Title: encodeURIComponent(title), Priority: "high", Tags: "ember" },
        body,
      });
      setSetting("notify.last_sent_at", String(nowSec()));
      return { sent: r.ok, detail: `ntfy ${r.status}` };
    }
    if (c.channel === "webhook" && c.webhookUrl) {
      const r = await fetch(c.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, body, at: nowSec(), source: "ember" }) });
      setSetting("notify.last_sent_at", String(nowSec()));
      return { sent: r.ok, detail: `webhook ${r.status}` };
    }
  } catch (e) {
    return { sent: false, detail: (e as Error).message };
  }
  return { sent: false, reason: "未配置渠道" };
}

/** 把 P0 未读提醒合并成一条通知发送 */
export async function pushUrgent(dryRun = false) {
  const cfg = notifyConfig();
  const rank = { P0: 0, P1: 1, P2: 2 } as Record<string, number>;
  const min = rank[cfg.minSeverity] ?? 0;
  const rows = db.select().from(s.reminders).where(eq(s.reminders.status, "open")).all()
    .filter((r) => (rank[r.severity] ?? 9) <= min);
  if (!rows.length) return { sent: false, reason: "没有需要推送的提醒" };
  const title = `Ember：${rows.length} 项待处理`;
  const body = rows.slice(0, 8).map((r) => `· ${r.title}`).join("\n");
  if (dryRun) return { sent: false, preview: { title, body }, channel: cfg.channel };
  const r = await sendNotification(title, body);
  return { ...r, count: rows.length };
}
