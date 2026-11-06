import { db, s } from "@/lib/db";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { nowSec } from "@/lib/id";
import { sendNotification } from "@/lib/notify";
import { feishuConfig, feishuAdapter } from "./feishu";

/**
 * 到点提醒：每 30 秒看一次有没有到时间的事项，主动发给你。
 * 先发飞书私聊；飞书没连上就走「设置 → 通知」里的 Bark/ntfy/Webhook。
 * 先标记再发送，进程重启或多次触发都不会重复发。
 */

const GREETING = /(问安|问好|早安|早上好|叫我起床|叫醒我|喊我起床)/;
const LATE_GRACE = 6 * 3600; // 电脑睡着错过的，6 小时内补发并说明晚了；更久的不补（免得半夜收到早上的问候）

export async function notifyOwner(title: string, body: string) {
  const c = feishuConfig();
  if (c.ownerOpenId && feishuAdapter.status().connected && feishuAdapter.sendText) {
    try {
      await feishuAdapter.sendText(c.ownerOpenId, `**${title}**${body ? `\n\n${body}` : ""}`);
      return { sent: true, via: "feishu" };
    } catch (e) {
      console.warn("[remind] 飞书发送失败，改走通知渠道", (e as Error).message);
    }
  }
  const r = await sendNotification(title, body);
  return { sent: !!r.sent, via: "notify" };
}

export async function runDueReminders(now = nowSec()) {
  const due = db.select().from(s.items).where(and(lte(s.items.remindAt, now), isNull(s.items.remindedAt), sql`${s.items.status} in ('todo','doing','blocked','changed')`)).all();
  const out: Array<{ id: string; sent: boolean; via: string; skipped?: string }> = [];
  for (const it of due) {
    // 先占位：标记已提醒，防止并发/重启重复发送
    const claimed = db.update(s.items).set({ remindedAt: now }).where(and(eq(s.items.id, it.id), isNull(s.items.remindedAt))).run();
    if (!claimed.changes) continue;
    const lateBy = now - (it.remindAt ?? now);
    if (lateBy > LATE_GRACE) { out.push({ id: it.id, sent: false, via: "", skipped: "过期太久" }); continue; }
    const hhmm = new Date((it.remindAt ?? now) * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const late = lateBy > 10 * 60 ? `（原定 ${hhmm}，电脑刚醒，晚了 ${Math.round(lateBy / 60)} 分钟）` : "";
    let title: string, body: string;
    if (GREETING.test(it.title)) {
      const { todayText } = await import("./feishu-handlers");
      const h = new Date(now * 1000).getHours();
      title = `${h < 11 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好"} ☀️${late}`;
      body = todayText();
    } else {
      title = `⏰ 提醒：${it.title}${late}`;
      body = it.detailMd ? it.detailMd.split("\n")[0].slice(0, 200) : "";
    }
    const r = await notifyOwner(title, body);
    out.push({ id: it.id, ...r });
    // 问候类是一次性的：发完即完成，不留在清单里
    if (r.sent && GREETING.test(it.title)) {
      db.update(s.items).set({ status: "done", completedAt: now, evidence: `已于 ${hhmm} 发送问候`, version: it.version + 1, updatedAt: now }).where(eq(s.items.id, it.id)).run();
    }
  }
  return out;
}

const g = globalThis as unknown as { __emberRemindTimer?: ReturnType<typeof setInterval> };
export function startReminderLoop() {
  if (g.__emberRemindTimer) return;
  const tick = () => { runDueReminders().catch((e) => console.warn("[remind] tick", (e as Error).message)); };
  g.__emberRemindTimer = setInterval(tick, 30_000);
  setTimeout(tick, 5_000);
}
