import { db, s } from "@/lib/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { nowSec } from "@/lib/id";
import { refreshReminders } from "@/lib/services/reminders";

/**
 * 提醒推送
 *
 * 两种场景：
 * 1. 「晨报/午报/晚报」：每天三次，把项目全量待办视图发给用户，完成的打钩，未完成的列出。
 * 2. 「紧急插队」：P0 提醒（到期/逾期/严重阻塞）随时插队，不等整点。
 */

const DAY = 86400;
type Row = typeof s.reminders.$inferSelect;
type ItemRow = typeof s.items.$inferSelect;
type ProjRow = typeof s.projects.$inferSelect;

// ─────────────────────────────────────────────
// 1. P0 紧急推送（随时）
// ─────────────────────────────────────────────

/** 取未推过的 P0 提醒（6小时内不重复） */
export function pendingUrgent(): Row[] {
  refreshReminders();
  const now = nowSec();
  const rows = db
    .select()
    .from(s.reminders)
    .where(and(eq(s.reminders.status, "open"), eq(s.reminders.severity, "P0")))
    .all();
  return rows.filter((r) => {
    const last = r.pushedAt ?? 0;
    return !last || now - last >= 6 * 3600;
  });
}

/** 组装 P0 紧急消息 */
export function buildUrgentText(rows: Row[]): string {
  if (!rows.length) return "";
  const projName = new Map(db.select().from(s.projects).all().map((p) => [p.id, p.name]));
  const lines = ["🔴 **紧急：现在就得管**\n"];
  for (const r of rows.slice(0, 8)) {
    const proj = r.projectId ? projName.get(r.projectId) : null;
    lines.push(`· ${r.title}${proj ? `（${proj}）` : ""}`);
  }
  if (rows.length > 8) lines.push(`…还有 ${rows.length - 8} 条`);
  lines.push("\n回复「今天」看今日安排，「待办」看全部提醒。");
  return lines.join("\n");
}

// ─────────────────────────────────────────────
// 2. 晨报/午报/晚报（三次整点汇总）
// ─────────────────────────────────────────────

export type DigestType = "morning" | "noon" | "evening";

/**
 * 组装每日汇报：按项目分组，展示全量待办，完成的打钩。
 * 格式：
 *
 *   ☀️ 晨报 · 2026-11-13
 *
 *   📁 管你屁事（3/8 完成）
 *   ✅ 修复 MCP token 问题
 *   ✅ 飞书机器人接入
 *   ☐  上线提醒推送
 *   ☐  测试晨报
 *   … 还有 4 项
 *
 *   📁 读书会（0/2 完成）
 *   ☐  确认下次选书
 *   ☐  整理书单
 *
 *   回复「待办」看详情，「今天」看日程。
 */
export function buildDigestText(type: DigestType): string {
  const now = nowSec();
  const today = new Date(now * 1000);
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const emoji = { morning: "☀️", noon: "🌤", evening: "🌙" }[type];
  const label = { morning: "晨报", noon: "午报", evening: "晚报" }[type];

  // 取活跃项目
  const projects: ProjRow[] = db
    .select()
    .from(s.projects)
    .where(and(ne(s.projects.status, "done"), ne(s.projects.status, "archived")))
    .all();

  if (!projects.length) {
    return `${emoji} **${label} · ${dateStr}**\n\n暂无活跃项目。`;
  }

  const lines: string[] = [`${emoji} **${label} · ${dateStr}**\n`];

  for (const proj of projects.slice(0, 6)) {
    // 取该项目的待办（非 dropped/changed）
    const items: ItemRow[] = db
      .select()
      .from(s.items)
      .where(
        and(
          eq(s.items.projectId, proj.id),
          ne(s.items.status, "dropped"),
          ne(s.items.status, "changed")
        )
      )
      .orderBy(s.items.position)
      .all();

    if (!items.length) continue;

    const done = items.filter((i) => i.status === "done");
    const todo = items.filter((i) => i.status !== "done");

    lines.push(`📁 **${proj.name}**（${done.length}/${items.length} 完成）`);

    // 显示最近完成的（最多3条）
    for (const it of done.slice(-3)) {
      lines.push(`✅ ${it.title}`);
    }
    if (done.length > 3) {
      lines.push(`✅ …还有 ${done.length - 3} 项已完成`);
    }

    // 显示未完成的（最多5条）
    for (const it of todo.slice(0, 5)) {
      const marker = it.status === "blocked" ? "🚫" : it.status === "doing" ? "🔄" : "☐ ";
      const due = it.dueAt ? ` [${new Date(it.dueAt * 1000).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}]` : "";
      lines.push(`${marker} ${it.title}${due}`);
    }
    if (todo.length > 5) {
      lines.push(`☐  …还有 ${todo.length - 5} 项待办`);
    }
    lines.push("");
  }

  if (projects.length > 6) {
    lines.push(`_另有 ${projects.length - 6} 个项目未展示_\n`);
  }

  lines.push("回复「待办」看全部提醒，「今天」看日程。");
  return lines.join("\n").trim();
}

// ─────────────────────────────────────────────
// 共用工具
// ─────────────────────────────────────────────

/** 兼容旧调用（scheduler 还在用） */
export function pendingPush(limit = 20): Row[] {
  return pendingUrgent().slice(0, limit);
}

export function buildPushText(rows: Row[]): string {
  return buildUrgentText(rows);
}

/** 标记已推送 */
export function markPushed(ids: string[]) {
  if (!ids.length) return 0;
  return db.update(s.reminders).set({ pushedAt: nowSec() }).where(inArray(s.reminders.id, ids)).run().changes;
}
