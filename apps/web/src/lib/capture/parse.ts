import { db, s } from "@/lib/db";
import { sql } from "drizzle-orm";
import { chat, getDefaultProvider } from "@/lib/ai/provider";
import { similar } from "@/lib/services/items";

/**
 * 把一段随手说的话整理成若干条草稿。
 * - 有 AI：结构化抽取，给出项目、类型、置信度和原话依据；
 * - 没 AI：按句拆分 + 关键词判断，项目靠名称/别名匹配，拿不准就留空。
 * 无论哪种，结果都只是草稿，你确认后才落库。
 */

export const DRAFT_TYPES = ["item", "progress", "meeting", "purchase", "deal", "trip", "note"] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];

export type Draft = {
  type: DraftType; projectId: string | null; projectConfidence: number; title: string; detail: string;
  dueAt: number | null; priority: "P0" | "P1" | "P2" | "P3"; targetItemId: string | null; done: boolean;
  waitingFor: string; evidence: string; fields: Record<string, unknown>;
};

type ProjectRef = { id: string; key: string; name: string; aliases: string[] };
type OpenItem = { id: string; projectId: string; title: string };

function context() {
  const projects: ProjectRef[] = db.select().from(s.projects).all()
    .filter((p) => p.status === "active" && p.isInbox !== 1)
    .map((p) => ({ id: p.id, key: p.key, name: p.name, aliases: (p.aliases || "").split(/[,，\s]+/).filter(Boolean) }));
  const ids = new Set(projects.map((p) => p.id));
  const open: OpenItem[] = db.select({ id: s.items.id, projectId: s.items.projectId, title: s.items.title, updatedAt: s.items.updatedAt }).from(s.items)
    .where(sql`${s.items.status} in ('todo','doing','blocked','changed') and ${s.items.supersededBy} = ''`).all()
    .filter((i) => ids.has(i.projectId)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 150);
  return { projects, open };
}

// ---------- 日期 ----------
const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 日: 7, 天: 7 };
const at18 = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18).getTime() / 1000);

/** 从中文口语里取截止时间：今天/明天/后天/大后天/周X/下周X/X月X日/X号/N天后/月底 */
export function parseCnDate(text: string, now = new Date()): number | null {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const add = (n: number) => at18(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n));
  let m: RegExpMatchArray | null;
  if ((m = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/))) return at18(new Date(+m[1], +m[2] - 1, +m[3]));
  if ((m = text.match(/(\d{1,2})月(\d{1,2})[日号]?/))) {
    let d = new Date(base.getFullYear(), +m[1] - 1, +m[2]);
    if (d.getTime() < base.getTime() - 30 * 86400_000) d = new Date(base.getFullYear() + 1, +m[1] - 1, +m[2]);
    return at18(d);
  }
  if (/大后天/.test(text)) return add(3);
  if (/后天/.test(text)) return add(2);
  if (/明天|明早|明晚/.test(text)) return add(1);
  if (/今天|今晚|今日|马上|尽快/.test(text)) return add(0);
  if ((m = text.match(/(\d+|[一二两三四五六七八九十])\s*天(后|内|之内)/))) return add(Number(m[1]) || CN_NUM[m[1]] || 10);
  if ((m = text.match(/(下下|下)?(周|星期|礼拜)([一二三四五六日天])/))) {
    const want = CN_NUM[m[3]];
    const cur = ((base.getDay() + 6) % 7) + 1;
    let diff = want - cur;
    if (m[1] === "下") diff += 7;
    else if (m[1] === "下下") diff += 14;
    else if (diff < 0) diff += 7;
    return add(diff);
  }
  if (/下周/.test(text)) return add(7 - ((base.getDay() + 6) % 7));
  if (/月底/.test(text)) return at18(new Date(base.getFullYear(), base.getMonth() + 1, 0));
  if ((m = text.match(/(\d{1,2})[号日]/))) {
    let d = new Date(base.getFullYear(), base.getMonth(), +m[1]);
    if (d.getTime() < base.getTime() - 86400_000) d = new Date(base.getFullYear(), base.getMonth() + 1, +m[1]);
    return at18(d);
  }
  return null;
}

// ---------- 无 AI 的规则整理 ----------
const PURCHASE_RE = /(买|采购|下单|订购|置办|换一?[台个块])/;
const DEAL_RE = /(合作|客户|报价|签约|商务|谈|方案给)/;
const TRIP_RE = /(出差|去(北京|上海|广州|深圳|杭州|成都|武汉|南京|西安|[一-龥]{2}市)|机票|高铁|酒店)/;
const MEETING_RE = /^(会议|开会|会上|纪要|今天和.+(聊|谈|开会))/;
const DONE_RE = /(办完了|搞定|做完了|已经?(完成|通过|下来|拿到|付款|上线|签了)|过了|批下来|审核通过)/;
const PROGRESS_RE = /(进展|推进|在走|提交了|审核中|已提交|在等|等.{1,8}(回复|审核|确认|发货))/;
const WAIT_RE = /等(?:待)?([一-龥A-Za-z0-9]{1,10}?)(?:的)?(回复|审核|确认|发货|答复|反馈|消息|报价)/;

const squash = (x: string) => x.toLowerCase().replace(/[\s·_\-]+/g, "");
function matchProject(text: string, projects: ProjectRef[]) {
  const t = squash(text);
  let best: { p: ProjectRef; score: number } | null = null;
  for (const p of projects) {
    const names = [p.name, p.key, ...p.aliases].filter((x) => x && x.length >= 2);
    for (const n of names) {
      if (t.includes(squash(n))) {
        const score = n === p.name ? 90 : 80;
        if (!best || score > best.score) best = { p, score };
      }
    }
  }
  return best;
}

export function splitSentences(text: string) {
  return text.split(/\r?\n|[。；;！!]|(?:^|\s)\d+[.、)）]\s*|(?:然后|另外|还有|再就是)[，,]?/)
    .map((x) => x.replace(/^[-*•·\s，,]+/, "").trim()).filter((x) => x.length >= 4);
}

export function parseByRules(text: string, now = new Date()): Draft[] {
  const { projects, open } = context();
  // 整段只提到一个项目时，没点名的句子才默认归它；提到多个就各句自己认，认不出留空
  const mentioned = projects.filter((p) => matchProject(text, [p]));
  const whole = mentioned.length === 1 ? matchProject(text, mentioned) : null;
  const lines = text.length > 400 || MEETING_RE.test(text.trim()) ? [] : splitSentences(text);
  if (!lines.length) {
    // 长文或明显是会议：整段归档为会议记录
    return [{ type: "meeting", projectId: whole?.p.id ?? null, projectConfidence: whole?.score ?? 0, title: text.trim().split(/\n/)[0].slice(0, 40), detail: text.trim(), dueAt: null, priority: "P2", targetItemId: null, done: false, waitingFor: "", evidence: "整段较长，按会议/记录归档", fields: {} }];
  }
  const out: Draft[] = [];
  for (const line of lines.slice(0, 12)) {
    const pm = matchProject(line, projects) ?? whole;
    const projectId = pm?.p.id ?? null;
    const due = parseCnDate(line, now);
    const wait = line.match(WAIT_RE);
    // 是不是在说某件已有事项的进展
    const cand = open.filter((i) => !projectId || i.projectId === projectId).find((i) => similar(i.title, line) || line.includes(i.title));
    let type: DraftType = "item";
    if (cand && (DONE_RE.test(line) || PROGRESS_RE.test(line))) type = "progress";
    else if (TRIP_RE.test(line)) type = "trip";
    else if (PURCHASE_RE.test(line)) type = "purchase";
    else if (DEAL_RE.test(line) && /客户|合作|签/.test(line)) type = "deal";
    const draft: Draft = {
      type, projectId: type === "progress" ? cand!.projectId : projectId, projectConfidence: type === "progress" ? 85 : pm?.score ?? 0,
      title: line.replace(/^(我要|要|需要|记得|别忘了|提醒我)/, "").slice(0, 80), detail: "", dueAt: due, priority: /急|马上|今天|尽快|重要/.test(line) ? "P0" : "P1",
      targetItemId: type === "progress" ? cand!.id : null, done: type === "progress" && DONE_RE.test(line) && !wait,
      waitingFor: wait ? wait[1] : "", evidence: line, fields: {},
    };
    if (type === "trip") { const c = line.match(/去([一-龥]{2,4}?)(出差|见|谈|开会|$)/); draft.fields = { city: c?.[1] ?? "", startAt: due }; }
    if (type === "deal") { const amt = line.match(/(\d+(?:\.\d+)?)\s*(万|w|W)/); if (amt) draft.fields = { amountYuan: Number(amt[1]) * 10000 }; }
    if (type === "purchase") { const b = line.match(/(\d{2,6})\s*(元|块)/); if (b) draft.fields = { budgetYuan: Number(b[1]) }; }
    out.push(draft);
  }
  return out;
}

// ---------- AI 整理 ----------
const SYSTEM = `你是一人公司的秘书。用户随手发来一段话（可能是语音转写，有错字和口语）。把它整理成要落到系统里的若干条草稿，严格输出 JSON：
{"drafts":[{"type":"item|progress|meeting|purchase|deal|trip|note","project":"项目 key，拿不准就填空串","confidence":0-100,"title":"简洁的事项标题（动词开头）","detail":"补充说明，可空","due":"YYYY-MM-DD 或空串","priority":"P0|P1|P2","target_item_id":"type=progress 时填已有事项的 id","done":false,"waiting_for":"在等谁（如 王经理、管局审核），没有填空串","evidence":"原话中支撑这条的片段","fields":{}}]}
类型规则：
- item：一件新的要做的事。
- progress：在说【已有事项】的进展或已办完（从给出的事项列表里找 id；已办完则 done=true）。不要为进展新建 item。
- meeting：整段是会议/通话记录，原文放 detail，只归档不拆。
- purchase：要买东西。fields 可含 budgetYuan、specMd、caveatsMd。
- deal：客户合作/商务。fields 可含 org、amountYuan、nextStep。
- trip：出差/出行。fields 可含 city、startAt(YYYY-MM-DD)、endAt(YYYY-MM-DD)、purpose。
- note：值得记下的信息，不需要做什么。
项目规则：只能从给出的项目 key 里选；话里没提且无法从内容确定就留空，confidence 给低分。一句话涉及多个项目要拆成多条。
不要编造原话里没有的事情、日期、金额。今天是 {{TODAY}}。`;

export async function parseByAi(text: string, now = new Date()) {
  const { projects, open } = context();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}（星期${"日一二三四五六"[now.getDay()]}）`;
  const ctx = [
    "项目：", ...projects.map((p) => `- ${p.key}｜${p.name}${p.aliases.length ? `｜别名 ${p.aliases.join("、")}` : ""}`),
    "", "未完成事项（id｜项目key｜标题）：", ...open.map((i) => `- ${i.id}｜${projects.find((p) => p.id === i.projectId)?.key}｜${i.title}`),
  ].join("\n");
  const r = await chat([
    { role: "system", content: SYSTEM.replace("{{TODAY}}", today) },
    { role: "user", content: `${ctx}\n\n用户发来：\n"""\n${text.slice(0, 6000)}\n"""` },
  ], { json: true, feature: "capture_parse", maxTokens: 2000 });
  const m = r.text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const json = JSON.parse((m ? m[1] : r.text).trim());
  const byKey = new Map(projects.map((p) => [p.key.toLowerCase(), p]));
  const openIds = new Map(open.map((i) => [i.id, i]));
  const drafts: Draft[] = [];
  for (const d of (Array.isArray(json.drafts) ? json.drafts : []).slice(0, 15)) {
    const type = (DRAFT_TYPES as readonly string[]).includes(d.type) ? (d.type as DraftType) : "item";
    const title = String(d.title ?? "").trim().slice(0, 120);
    if (!title) continue;
    let project = byKey.get(String(d.project ?? "").toLowerCase()) ?? null;
    let target = type === "progress" && d.target_item_id ? openIds.get(String(d.target_item_id)) ?? null : null;
    if (target) project = projects.find((p) => p.id === target!.projectId) ?? project;
    const due = typeof d.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.due) ? at18(new Date(d.due + "T12:00:00")) : null;
    const fields = d.fields && typeof d.fields === "object" ? { ...d.fields } : {};
    for (const k of ["startAt", "endAt"]) if (typeof fields[k] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fields[k])) fields[k] = at18(new Date(fields[k] + "T12:00:00")); else delete fields[k];
    drafts.push({
      type: type === "progress" && !target ? "item" : type, // 找不到对应事项的「进展」当新事项，由你确认
      projectId: project?.id ?? null, projectConfidence: project ? Math.max(0, Math.min(100, Number(d.confidence) || 50)) : 0,
      title, detail: type === "meeting" ? String(d.detail || text) : String(d.detail ?? "").slice(0, 2000), dueAt: due,
      priority: ["P0", "P1", "P2", "P3"].includes(d.priority) ? d.priority : "P1",
      targetItemId: target?.id ?? null, done: !!d.done && !!target, waitingFor: String(d.waiting_for ?? "").slice(0, 40),
      evidence: String(d.evidence ?? "").slice(0, 300), fields,
    });
  }
  return { drafts, model: r.model };
}

/** 统一入口：优先 AI，失败或没配置就用规则 */
export async function parseCapture(text: string, now = new Date()): Promise<{ drafts: Draft[]; parser: "ai" | "rules"; note?: string }> {
  if (getDefaultProvider()) {
    try {
      const r = await parseByAi(text, now);
      if (r.drafts.length) return { drafts: r.drafts, parser: "ai" };
    } catch (e) {
      return { drafts: parseByRules(text, now), parser: "rules", note: `AI 整理失败，已用规则整理：${(e as Error).message.slice(0, 80)}` };
    }
  }
  return { drafts: parseByRules(text, now), parser: "rules" };
}
