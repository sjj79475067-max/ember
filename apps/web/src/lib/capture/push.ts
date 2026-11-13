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
    lines.push(`· ${proj ? `**${proj}** — ` : ""}${r.title}`);
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
 * 每条事项要能独立看懂 —— 带上项目名、交付标准、优先级、截止日、阻塞原因。
 *
 *   ☀️ 晨报 · 2026-11-13
 *
 *   📁 客户门户 V2 交付（2/6 完成）
 *   _10 月底交付客户门户改版，含登录改造与数据看板。_
 *
 *   ✅ P0 完成登录模块改造
 *      交付标准：手机号+验证码登录上线，e2e 覆盖
 *      截止 11/11 · 已完成 11/11
 *      证据：截图：http://localhost:3000/p/IT ，e2e 通过
 *
 *   🚫 P1 数据看板接入新指标
 *      交付标准：GMV/留存/转化三个指标可在看板切换
 *      🚫 阻塞：等待客户确认表单字段
 *      截止 11/15
 *
 *   ☐ P0 登录模块改为手机号+验证码
 *      交付标准：上线并通过 e2e
 *      截止 11/11（已逾期 2 天）
 *
 *   回复「待办」看全部提醒，「今天」看日程。
 */
export function buildDigestText(type: DigestType): string {
  const now = nowSec();
  const today = new Date(now * 1000);
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const emoji = { morning: "☀️", noon: "🌤", evening: "🌙" }[type];
  const label = { morning: "晨报", noon: "午报", evening: "晚报" }[type];

  // 取活跃项目（排除收件箱）
  const projects: ProjRow[] = db
    .select()
    .from(s.projects)
    .where(and(ne(s.projects.status, "done"), ne(s.projects.status, "archived")))
    .all()
    .filter((p) => p.status === "active" && p.isInbox !== 1);

  if (!projects.length) {
    return `${emoji} **${label} · ${dateStr}**\n\n暂无活跃项目。`;
  }

  const lines: string[] = [`${emoji} **${label} · ${dateStr}**\n`];

  for (const proj of projects) {
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
    if (proj.summaryMd) {
      const summary = proj.summaryMd.trim().split("\n")[0].slice(0, 80);
      if (summary) lines.push(`_${summary}_`);
    }
    lines.push("");

    // 已完成：显示最近 3 条
    for (const it of done.slice(-3)) {
      lines.push(...itemLines(it, "done", now));
    }
    if (done.length > 3) {
      lines.push(`✅ …还有 ${done.length - 3} 项已完成`);
    }

    // 未完成：显示前 8 条（超出的只计数）
    for (const it of todo.slice(0, 8)) {
      lines.push(...itemLines(it, it.status, now));
    }
    if (todo.length > 8) {
      lines.push(`☐ …还有 ${todo.length - 8} 项待办`);
    }
    lines.push("");
  }

  lines.push("回复「待办」看全部提醒，「今天」看日程。");
  return lines.join("\n").trim();
}


/**
 * 交付标准是否真的有信息量。
 * 历史上有一批数据是 "完成：<标题>" 这种把标题复制一遍的占位符，
 * 展示出来等于没写，不如不显示。
 */
function meaningfulDef(def: string, title: string): string {
  const d = def.trim();
  if (!d) return "";
  const stripped = d.replace(/^(完成|做完|交付)\s*[:：]?\s*/, "").trim();
  if (!stripped) return "";
  // 和标题基本一样 → 没有额外信息
  const norm = (x: string) => x.replace(/[\s，。、,.:：;；!！?？]/g, "");
  if (norm(stripped) === norm(title) || norm(title).includes(norm(stripped)) && norm(stripped).length > 6) return "";
  return d.replace(/\n+/g, " ");
}

/** 一条事项的多行描述：标题 + 交付标准 + 状态信息 */
function itemLines(it: ItemRow, status: string, now: number): string[] {
  const marker =
    status === "done" ? "✅" : status === "blocked" ? "🚫" : status === "doing" ? "🔄" : "☐";
  const out: string[] = [];

  out.push(`${marker} **${it.priority} ${it.title}**`);

  // 交付标准：说明"做到什么算完成"
  const def = meaningfulDef(it.doneDefinition, it.title);
  if (def) {
    out.push(`   交付标准：${def}`);
  } else if (it.detailMd) {
    const detail = it.detailMd.trim().split("\n")[0].slice(0, 100);
    if (detail) out.push(`   ${detail}`);
  }

  // 阻塞原因
  if (status === "blocked" && it.blockReason) {
    out.push(`   🚫 阻塞：${it.blockReason}`);
  }

  // 等待对象
  if (it.waitingFor) {
    out.push(`   ⏳ 在等：${it.waitingFor}`);
  }

  // 截止日 / 完成时间 / 逾期
  if (it.dueAt) {
    const due = new Date(it.dueAt * 1000);
    const dueStr = `${due.getMonth() + 1}/${due.getDate()}`;
    if (status === "done") {
      const doneAt = it.completedAt ? new Date(it.completedAt * 1000) : null;
      out.push(
        doneAt
          ? `   截止 ${dueStr} · 已完成 ${doneAt.getMonth() + 1}/${doneAt.getDate()}`
          : `   截止 ${dueStr}`
      );
    } else {
      const overdue = now - it.dueAt;
      if (overdue > 0) {
        const days = Math.floor(overdue / 86400);
        out.push(`   截止 ${dueStr}（已逾期 ${days > 0 ? `${days} 天` : "今天"}）`);
      } else {
        out.push(`   截止 ${dueStr}`);
      }
    }
  }

  // 完成证据
  if (status === "done" && it.evidence) {
    out.push(`   证据：${it.evidence.slice(0, 120)}`);
  }

  return out;
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
