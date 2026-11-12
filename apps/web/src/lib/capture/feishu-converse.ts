import { db, s } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { nowSec } from "@/lib/id";
import { chat, getDefaultProvider } from "@/lib/ai/provider";
import { toolsByName } from "@/lib/mcp/registry";
import type { Ctx } from "@/lib/http/api";
import { audit } from "@/lib/audit";

/**
 * 飞书机器人的对话能力：听懂你的一句话，去调管你屁事的同一套工具，把结果说回给你。
 *
 * 关键设计：机器人不走网络，直接在进程内调用 MCP 工具注册表（toolsByName），
 * 所以它能做的事和所有 agent 完全一致，不会出现两套逻辑。
 *
 * 三类问题：
 * 1. 查询（"管你屁事进展怎么样"、"采购到哪了"）→ 挑工具读
 * 2. 变更（"XX 做完了"、"这个延期到下周五"）→ 挑工具写
 * 3. 记录（"要买一台 XX 显示器"）→ 走随手记草稿，确认后落库
 *
 * 写操作一律经过工具的 WRITE_TOOLS 门禁和条例检查，跟网页和 MCP 一样。
 */

/** 机器人自己的 Ctx：当成一个 agent，但保留你本人的身份来记账 */
export function feishuCtx(ownerName = "我（飞书）"): Ctx {
  return {
    actor: { type: "user", name: ownerName },
    ip: "feishu",
    requestId: `feishu-${nowSec()}`,
    isAgent: false,
    scopes: ["read", "write"],
  };
}

/** 机器人能用的工具（只暴露读和常用写，敏感的审批类不给） */
const ALLOWED = new Set([
  // 读
  "onboard", "sync", "project_list", "project_get", "project_board", "checklist_list", "requirement_list",
  "today", "calendar_agenda", "search", "reminders_pull", "policy_read", "file_list", "asset_list",
  "meetings_list", "meeting_get", "agents_list", "weekly_review", "affairs_list",
  // 写
  "checklist_update", "checklist_progress", "checklist_add", "note_save", "decision_record",
  "asset_save", "purchase_save", "deal_save", "trip_save", "item_move", "reminder_ack",
]);

type ToolSpec = { name: string; title: string; description: string; params: string[] };

/** 给 AI 看的工具清单（精简描述，省 token） */
function toolSpecs(): ToolSpec[] {
  return [...toolsByName.values()].filter((t) => ALLOWED.has(t.name)).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description.split("\n")[0].slice(0, 120),
    params: Object.keys((t.input as { shape?: Record<string, unknown> }).shape ?? {}),
  }));
}

const SYSTEM = `你是「管你屁事」——用户自己的事务秘书，通过飞书私聊和你说话。用户是单人公司的老板，什么事都归他管。

你的任务：听懂他的一句话，调工具去查或去改，然后用中文说清楚结果。

## 三种说话方式
1. **查询**：问进展、问清单、问还有哪些事没做、问资料在哪、问某个东西的状态。
2. **变更**：说某件事做完了、延期了、改成什么状态、该催谁了。
3. **记录**：说一件新的事、要说买什么、要记一条想法。

## 规则
- 查不到就说不确定，不要编。
- 变更类操作直接调写工具，调完用一句话说清「做了什么」。
- 记录新事情时用 checklist_add（要做什么）或对应的专用工具（要买东西用 purchase_save，要合作用 deal_save，要出行用 trip_save，证书域名用 asset_save）。
- 说完给出 1-3 个你判断他可能接着问的选项，用一行给出，例如：「要不要我现在把它排进今天？」
- 不要用 emoji 堆砌，话少但要有用。
- 项目 key 从可用项目列表里选，选不到就把项目留空，工具会落到收件箱。
- 回答用简体中文，简洁。

## 可用工具
{{TOOLS}}`;

export type Intent = { action: "tool" | "record" | "unknown"; tool?: string; args?: Record<string, unknown>; text?: string; reason?: string };

/**
 * 判断这句话要干什么。
 * 有 AI：让 AI 挑工具。有 AI 之前：按关键词走固定命令。
 */
export async function interpret(text: string, ctx: Ctx): Promise<Intent> {
  const t = text.trim();
  // 固定命令不走 AI，省钱也更稳
  const fixed = fixedIntent(t);
  if (fixed) return fixed;

  if (!getDefaultProvider()) return { action: "unknown", reason: "没配 AI，只能用固定命令（今天 / 待办 / 项目 xxx / 提醒 xxx）" };

  const projects = db.select().from(s.projects).all().filter((p) => p.status === "active" && p.isInbox !== 1)
    .map((p) => ({ key: p.key, name: p.name, aliases: p.aliases }));
  const openItems = db.select({ id: s.items.id, title: s.items.title, projectId: s.items.projectId, status: s.items.status })
    .from(s.items).where(sql`${s.items.status} in ('todo','doing','blocked','changed')`).all().slice(0, 80);

  const prompt = [
    `项目：\n${projects.map((p) => `- ${p.key}｜${p.name}${p.aliases ? `｜别名 ${p.aliases}` : ""}`).join("\n")}`,
    ``,
    `未完成事项：\n${openItems.map((i) => `- ${i.id}｜${i.title}`).join("\n")}`,
  ].join("\n");

  const r = await chat([
    { role: "system", content: SYSTEM.replace("{{TOOLS}}", JSON.stringify(toolSpecs(), null, 1)) },
    { role: "user", content: `${prompt}\n\n他说：\n"""\n${t.slice(0, 2000)}\n"""\n\n输出 JSON：{"action":"tool|record|unknown","tool":"工具名","args":{...},"text":"要回复他的一句话","reason":"不确定的原因"}` },
  ], { json: true, feature: "feishu_intent", maxTokens: 1200 });

  const m = r.text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const json = JSON.parse((m ? m[1] : r.text).trim());
  const tool = typeof json.tool === "string" ? json.tool : "";
  const action = json.action === "tool" || json.action === "record" ? json.action : "unknown";
  if (action === "tool" && tool && !ALLOWED.has(tool)) {
    return { action: "unknown", reason: `工具 ${tool} 不给机器人用` };
  }
  return {
    action,
    tool: tool || undefined,
    args: json.args && typeof json.args === "object" ? json.args : undefined,
    text: typeof json.text === "string" ? json.text : undefined,
    reason: typeof json.reason === "string" ? json.reason : undefined,
  };
}

/** 固定命令：不花 AI 也能用 */
function fixedIntent(t: string): Intent | null {
  if (/^(今天|今日|today)$/i.test(t)) return { action: "tool", tool: "today", args: {} };
  if (/^(待办|提醒|reminders?)$/i.test(t)) return { action: "tool", tool: "reminders_pull", args: {} };
  if (/^(日程|agenda|未来两周)$/i.test(t)) return { action: "tool", tool: "calendar_agenda", args: {} };
  if (/^(事务|affairs|在办|公司事务)$/i.test(t)) return { action: "tool", tool: "affairs_list", args: {} };
  if (/^(项目|projects?)$/i.test(t)) return { action: "tool", tool: "project_list", args: {} };
  if (/^(台账|assets?)$/i.test(t)) return { action: "tool", tool: "asset_list", args: {} };
  // 「项目 IT」这种
  let m = t.match(/^项目\s+(.+)$/);
  if (m) return { action: "tool", tool: "project_get", args: { project: m[1].trim() } };
  m = t.match(/^搜索\s+(.+)$/);
  if (m) return { action: "tool", tool: "search", args: { q: m[1].trim() } };
  return null;
}

/** 执行意图对应的工具，返回要说给用户的话 */
export async function runIntent(intent: Intent, ctx: Ctx): Promise<string> {
  if (intent.action === "unknown") {
    return intent.reason ?? "我没听懂。你可以说「今天」「待办」，或直接告诉我事情。";
  }
  if (intent.action === "record" && !intent.tool) {
    return intent.text ?? "记下了。";
  }
  const def = intent.tool ? toolsByName.get(intent.tool) : null;
  if (!def) return intent.text ?? "这个我暂时做不了。";
  try {
    const parsed = def.input.parse(intent.args ?? {});
    const out = await def.handler(parsed, ctx);
    audit(ctx.actor, `feishu.${def.name}`, "tool", def.name, { args: intent.args });
    return renderResult(def.name, out) || intent.text || "做好了。";
  } catch (e) {
    return `没成功：${(e as Error).message}`;
  }
}

/** 把工具返回压成一句人话 */
function renderResult(tool: string, out: unknown): string {
  const o = out as { ok?: boolean; data?: Record<string, unknown>; error?: string };
  if (!o || o.ok === false) return o?.error ?? "没成功。";
  const d = o.data ?? {};
  switch (tool) {
    case "today": {
      const items = (d.today ?? []) as Array<{ title: string; why?: string; project?: string }>;
      const counts = (d.counts ?? {}) as Record<string, number>;
      if (!items.length) return "今天没有到期和计划的事。";
      return `今天 ${counts.today ?? items.length} 件：\n` + items.slice(0, 8).map((i, n) => `${n + 1}. ${i.title}${i.project ? `（${i.project}）` : ""}`).join("\n");
    }
    case "reminders_pull": {
      const rs = (d.reminders ?? []) as Array<{ title: string; severity: string }>;
      if (!rs.length) return "没有待处理的提醒。";
      return `待办 ${rs.length} 件：\n` + rs.slice(0, 10).map((r) => `· [${r.severity}] ${r.title}`).join("\n");
    }
    case "project_list": {
      const ps = (d.projects ?? []) as Array<{ key: string; name: string; progress?: { total: number; done: number } }>;
      if (!ps.length) return "还没有项目。";
      return "项目：\n" + ps.map((p) => `· ${p.name}（${p.key}）${p.progress ? ` ${p.progress.done}/${p.progress.total}` : ""}`).join("\n");
    }
    case "project_get": {
      const p = d.project as { name: string; key: string; summaryMd?: string } | undefined;
      if (!p) return "没找到这个项目。";
      const pr = (d.progress ?? {}) as { total?: number; done?: number };
      return `${p.name}（${p.key}）${pr.total ? ` ${pr.done ?? 0}/${pr.total}` : ""}${p.summaryMd ? `\n${p.summaryMd.slice(0, 120)}` : ""}`;
    }
    case "search": {
      const rs = (d.results ?? d.items ?? []) as Array<{ title: string; type?: string }>;
      if (!rs.length) return "没搜到。";
      return "搜到：\n" + rs.slice(0, 8).map((r) => `· ${r.title}`).join("\n");
    }
    case "checklist_list": {
      const items = (d.items ?? []) as Array<{ title: string; status: string }>;
      if (!items.length) return "没有匹配的事项。";
      return `找到 ${items.length} 条：\n` + items.slice(0, 10).map((i) => `· ${i.title}（${i.status}）`).join("\n");
    }
    case "asset_list": {
      const as = (d.assets ?? []) as Array<{ name: string; days_left?: number }>;
      if (!as.length) return "台账是空的。";
      return "台账：\n" + as.slice(0, 10).map((a) => `· ${a.name}${a.days_left != null ? `（${a.days_left < 0 ? `已过期 ${-a.days_left} 天` : `还有 ${a.days_left} 天`}）` : ""}`).join("\n");
    }
    case "calendar_agenda": {
      const evs = (d.events ?? []) as Array<{ title: string; at: number; kind?: string }>;
      if (!evs.length) return "未来两周没有到期的事。";
      const fmt = (ts: number) => new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
      return "接下来：\n" + evs.slice(0, 10).map((e) => `· ${fmt(e.at)} ${e.title}`).join("\n");
    }
    case "affairs_list": {
      const pur = (d.purchases ?? []) as Array<{ title: string; status: string; late?: boolean }>;
      const deals = (d.deals ?? []) as Array<{ title: string; stage: string; next_step?: string }>;
      const contacts = (d.contacts_to_follow ?? []) as Array<{ name: string; days_since: number }>;
      const trips = (d.trips ?? []) as Array<{ title: string; city?: string }>;
      const out: string[] = [];
      if (pur.length) out.push(`采购：\n` + pur.map((p) => `· ${p.title}（${p.status}${p.late ? "，来不及了" : ""}）`).join("\n"));
      if (deals.length) out.push(`合作：\n` + deals.map((x) => `· ${x.title}（${x.stage}${x.next_step ? `，下一步：${x.next_step}` : ""}）`).join("\n"));
      if (contacts.length) out.push(`该联系：\n` + contacts.map((c) => `· ${c.name}（${c.days_since} 天没联系）`).join("\n"));
      if (trips.length) out.push(`行程：\n` + trips.map((t) => `· ${t.title}${t.city ? `（${t.city}）` : ""}`).join("\n"));
      return out.length ? out.join("\n\n") : "公司层面没有在办的事。";
    }
    default: {
      // 写操作：工具大多返回对象，抽几个关键字段出来
      const item = (d.item ?? d.purchase ?? d.asset ?? d.deal ?? d.trip ?? d.note ?? d.decision) as { title?: string; name?: string } | undefined;
      const title = item?.title ?? item?.name;
      if (title) return `已处理：${title}`;
      const keys = Object.keys(d);
      return keys.length ? `已处理（${keys.join("、")}）。` : "已处理。";
    }
  }
}
