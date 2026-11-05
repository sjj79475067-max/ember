import { db, s } from "@/lib/db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { chat, getDefaultProvider } from "./provider";
import { nowSec } from "@/lib/id";

const DAY = 86400;

export type BriefSection = { title: string; lines: string[] };

export async function buildBrief(kind: "daily" | "weekly", useAi = true): Promise<{ md: string; sections: BriefSection[]; aiUsed: boolean }> {
  const now = nowSec();
  const windowStart = kind === "daily" ? now - DAY : now - 7 * DAY;
  const horizon = kind === "daily" ? now + 2 * DAY : now + 7 * DAY;

  const projects = db.select().from(s.projects).where(eq(s.projects.status, "active")).all();
  const items = db.select().from(s.items).all();
  const projName = new Map(projects.map((p) => [p.id, p.name]));

  const overdue = items.filter((i) => i.dueAt && i.dueAt < now && !["done", "dropped"].includes(i.status));
  const dueSoon = items.filter((i) => i.dueAt && i.dueAt >= now && i.dueAt <= horizon && !["done", "dropped"].includes(i.status));
  const blocked = items.filter((i) => i.status === "blocked");
  const changed = items.filter((i) => i.status === "changed");
  const doneRecent = items.filter((i) => i.status === "done" && (i.completedAt ?? 0) >= windowStart);
  const claimed = items.filter((i) => i.status === "doing" && i.claimedBy);

  const events = db.select().from(s.itemEvents).where(gte(s.itemEvents.createdAt, windowStart)).orderBy(desc(s.itemEvents.createdAt)).limit(200).all();
  const agentNames = [...new Set(events.filter((e) => e.actorType === "agent").map((e) => e.actorName))].filter(Boolean);

  const staleFiles = db.select().from(s.fileRefs)
    .where(sql`${s.fileRefs.lastVerifiedAt} is null or ${s.fileRefs.lastVerifiedAt} < ${now - 30 * DAY}`).all();

  const sections: BriefSection[] = [
    { title: "需要你决定", lines: [
      ...blocked.map((i) => `⛔ ${i.title}（${projName.get(i.projectId) ?? "—"}）：${i.blockReason || "未说明原因"}`),
      ...changed.map((i) => `🔁 ${i.title}（${projName.get(i.projectId) ?? "—"}）已变更，请确认是否符合预期`),
    ] },
    { title: "已逾期", lines: overdue.map((i) => `${i.title}（${projName.get(i.projectId) ?? "—"}）—— 截止 ${fmt(i.dueAt!)}`) },
    { title: kind === "daily" ? "48 小时内到期" : "本周内到期", lines: dueSoon.map((i) => `${i.title}（${projName.get(i.projectId) ?? "—"}）—— ${fmt(i.dueAt!)}`) },
    { title: `${kind === "daily" ? "昨日" : "本周"}完成`, lines: doneRecent.map((i) => `${i.title}${i.evidence ? `｜${i.evidence.slice(0, 60)}` : ""}`) },
    { title: "进行中", lines: claimed.map((i) => `${i.title}（${projName.get(i.projectId) ?? "—"}）← 由 ${i.claimedBy} 处理中`) },
    { title: "资料待核验", lines: staleFiles.map((f) => `${f.label}：${f.machine ? f.machine + ":" : ""}${f.path || f.url}`) },
    { title: "Agent 动向", lines: agentNames.length ? [`近${kind === "daily" ? "24 小时" : "7 天"}活跃：${agentNames.join("、")}，共 ${events.length} 次操作`] : ["无记录"] },
  ].filter((sec) => sec.lines.length) as BriefSection[];

  const fallbackMd = toMarkdown(kind, sections);
  if (!useAi || !getDefaultProvider() || !sections.length) return { md: fallbackMd, sections, aiUsed: false };

  try {
    const r = await chat([
      { role: "system", content: "你是我的私人助理。把下面结构化的事务数据写成一份中文简报：先给 3 句以内的结论（最需要我关注什么），再按重要程度列要点。不要编造数据里没有的内容，不要用表格。控制在 350 字内。" },
      { role: "user", content: fallbackMd },
    ], { feature: kind === "daily" ? "daily_brief" : "weekly_digest", maxTokens: 700 });
    if (r.text.trim()) return { md: `${r.text.trim()}\n\n---\n\n${fallbackMd}`, sections, aiUsed: true };
  } catch {
    /* 用结构化版本兜底 */
  }
  return { md: fallbackMd, sections, aiUsed: false };
}

function toMarkdown(kind: "daily" | "weekly", sections: BriefSection[]) {
  const head = `## ${kind === "daily" ? "今日简报" : "本周周报"} · ${new Date().toLocaleDateString("zh-CN")}`;
  const body = sections.map((sec) => `### ${sec.title}\n${sec.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n");
  return `${head}\n\n${body || "暂无需要关注的事项。"}`;
}

const fmt = (sec: number) => new Date(sec * 1000).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
