import { db, s } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { nowSec } from "@/lib/id";
import { refreshReminders } from "@/lib/services/reminders";

/**
 * 提醒推送：把提醒引擎算出来的事主动推给用户。
 *
 * 之前提醒只写进数据库，没有任何出口——用户得自己开网页才知道。这里把
 * 「该知道的事」主动送到飞书私聊。
 *
 * 规则：
 * - P0 立刻推，P1/P2 按间隔推（同一件事别天天刷屏）
 * - 同一批里同类型的合并成一条，别一次弹十条
 * - 推过的记 pushedAt，不重复推
 * - 用户在提醒中心「已处理」后不再推
 */

const DAY = 86400;

/** 提醒类型 → 飞书上的说法 */
const KIND_LABEL: Record<string, string> = {
  due: "快到期",
  overdue: "已逾期",
  blocked: "卡住了",
  policy: "条例待确认",
  stale_file: "资料要核验",
  review: "要你看一眼",
  digest: "摘要",
};

/** 同一提醒的最短重复间隔：P0 当天不重推，P1 三天，P2 一天 */
const MIN_GAP: Record<string, number> = { P0: 6 * 3600, P1: 3 * DAY, P2: DAY };

type Row = typeof s.reminders.$inferSelect;

/** 取待推的提醒：按严重度排，跳过推过的 */
export function pendingPush(limit = 20): Row[] {
  refreshReminders();
  const now = nowSec();
  const rows = db.select().from(s.reminders).where(eq(s.reminders.status, "open")).all();
  const out: Row[] = [];
  for (const r of rows) {
    const gap = MIN_GAP[r.severity] ?? DAY;
    const last = r.pushedAt ?? 0;
    if (last && now - last < gap) continue;
    out.push(r);
  }
  const order = { P0: 0, P1: 1, P2: 2 } as Record<string, number>;
  return out.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || b.createdAt - a.createdAt).slice(0, limit);
}

/** 组装成一条推送消息 */
export function buildPushText(rows: Row[]) {
  if (!rows.length) return "";
  const projName = new Map(db.select().from(s.projects).all().map((p) => [p.id, p.name]));
  const lines: string[] = [];
  const p0 = rows.filter((r) => r.severity === "P0");
  const rest = rows.filter((r) => r.severity !== "P0");

  const block = (title: string, list: Row[]) => {
    if (!list.length) return;
    lines.push(`**${title}**`);
    for (const r of list.slice(0, 8)) {
      const proj = r.projectId ? projName.get(r.projectId) : null;
      lines.push(`· ${r.title}${proj ? `（${proj}）` : ""}`);
    }
    if (list.length > 8) lines.push(`…还有 ${list.length - 8} 条`);
    lines.push("");
  };

  if (p0.length) block("🔴 现在就得管", p0);
  if (rest.length) {
    const byKind = new Map<string, Row[]>();
    for (const r of rest) {
      const k = r.kind in KIND_LABEL ? r.kind : "review";
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k)!.push(r);
    }
    const groups = [...byKind.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [kind, list] of groups) block(KIND_LABEL[kind] ?? "要你看一眼", list);
  }

  return `管你屁事 · ${rows.length} 件事等你\n\n${lines.join("\n").trim()}\n\n回复「今天」看今日安排，「待办」看全部提醒。`;
}

/** 标记已推送 */
export function markPushed(ids: string[]) {
  if (!ids.length) return 0;
  return db.update(s.reminders).set({ pushedAt: nowSec() }).where(inArray(s.reminders.id, ids)).run().changes;
}
