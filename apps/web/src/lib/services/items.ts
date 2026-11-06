import { db, s } from "@/lib/db";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { ensureInbox } from "./projects";
import { syncRequirement } from "./requirements";
import { waitingOn, cleanupDepsForItem } from "./deps";
import { nextOccurrence, validRecur, describeRecur } from "./recur";

export type ItemStatus = "todo" | "doing" | "blocked" | "done" | "dropped" | "changed";
const CLAIM_TTL = 60 * 60 * 2; // 2h 心跳过期
const PROGRESS_NOTE_MAX = 4000;

export type ItemInput = {
  title: string; detailMd?: string; doneDefinition?: string; priority?: "P0" | "P1" | "P2" | "P3";
  dueAt?: number | null; workstreamId?: string | null; parentId?: string | null;
  sourceType?: "meeting" | "decision" | "import" | "manual" | "agent"; sourceRef?: string;
  /** 同一件事的后续进展：若给 expected_version 且与当前版本不符（别人已推进过），合并进已有进展而不是另起一条 */
  expectedVersion?: number;
  /** 这条是某事项的当前进展/状态更新（而非新事项）：同项目已有相似未完成任务时，合并为进展而不是新建 */
  statusNote?: string;
  kind?: string; milestoneId?: string | null; requirementId?: string | null; mustMeet?: boolean;
  startAt?: number | null; leadTimeDays?: number | null;
  recurRule?: string; ownerType?: string; ownerId?: string;
};

export type UpdatePatch = {
  status?: ItemStatus; note?: string; evidence?: string; dueAt?: number | null;
  blockReason?: string; expectedVersion?: number; priority?: "P0" | "P1" | "P2" | "P3";
  title?: string; detailMd?: string; doneDefinition?: string;
  kind?: string; milestoneId?: string | null; requirementId?: string | null; mustMeet?: boolean;
  startAt?: number | null; leadTimeDays?: number | null;
  /** 秘书层：在等谁（空串=不等了）、什么时候催、计划哪天做（YYYY-MM-DD，空串=移出）、先放到哪天 */
  waitingFor?: string; followUpAt?: number | null; plannedFor?: string; deferUntil?: number | null;
  /** 到点主动提醒（改时间会重新提醒） */
  remindAt?: number | null;
};

const OPEN_STATUSES = ["todo", "doing", "blocked", "changed"] as const;
type OpenStatus = (typeof OPEN_STATUSES)[number];

export function progressFor(projectId: string) {
  const r = db.select({
    total: sql<number>`count(*)`,
    done: sql<number>`sum(case when ${s.items.status}='done' then 1 else 0 end)`,
    doing: sql<number>`sum(case when ${s.items.status}='doing' then 1 else 0 end)`,
    blocked: sql<number>`sum(case when ${s.items.status}='blocked' then 1 else 0 end)`,
    overdue: sql<number>`sum(case when ${s.items.dueAt} is not null and ${s.items.dueAt} < ${nowSec()} and ${s.items.status} not in ('done','dropped') then 1 else 0 end)`,
    changed: sql<number>`sum(case when ${s.items.status}='changed' then 1 else 0 end)`,
    needsReview: sql<number>`sum(case when ${s.items.needsReview}=1 then 1 else 0 end)`,
  }).from(s.items).where(and(eq(s.items.projectId, projectId), sql`${s.items.parkingLot} is null`)).get();
  return {
    project: projectId,
    total: r?.total ?? 0, done: r?.done ?? 0, doing: r?.doing ?? 0,
    blocked: r?.blocked ?? 0, overdue: r?.overdue ?? 0, changed: r?.changed ?? 0,
    needsReview: r?.needsReview ?? 0,
  };
}

// ---------- 流水账识别 ----------
// 「进行中」的说法：在办、对接、联系过、做了一部分、等待中……
const PROGRESS_PHRASE = /(进行中|处理中|推进中|办理中|在办|对接中|沟通中|跟进中?|已对接|已联系|已沟通|已约|约了|联系了|对接了|一半|部分|初稿|草稿|第[一二三]步|还差|待[^\s，。]{0,6}|等待|等[^\s，。]{0,6}(回复|审核|确认|下发)|准备中|在做|开始做|着手)/;
// 办到一半的中间状态：提交了等审核、下单了等到货、申请了等结果
const INTERMEDIATE = /(已?提交审核|提交了审核|已?提交申请|已申请|申请中|审核中|已下单|下单了|已付款|已预约|已报名|(等|待|等待)[^\s，。；]{0,8})/g;
// 「做完了」的说法
const DONE_PHRASE = /(已完成|完成了|已提交|已发送|已上线|已部署|已修复|已签字|已签署|已回复|已通过|通过了?|审核通过|验收通过|测试通过|已交付|已开通|已下发|下发|已上传|已登记|已归档|已到账|到账|已回传|回传|已收到|收到|拿到|取得|成功|全部|100%|已发布|发布了|已上架|已备案|生效)/;
// 结果凭证：链接、路径、编号、单号
const ARTIFACT = /(https?:\/\/|~\/|\/[\w.-]+\/|[A-Za-z]:\\|备[0-9]|ICP备|号\s*[:：]?\s*[A-Za-z0-9]|[A-Za-z]{2,}\d{3,}|\d{4,}|回执|截图|录屏|扫描件|附件|PR\s*#?\d|commit)/;

/** 判断「完成证据」是否其实只是进度：只说了在办/对接过，没有做完的说法或结果凭证 */
export function looksLikeProgressNotCompletion(title: string, evidence: string): { progress: boolean; completed: boolean } {
  const ev = evidence.trim();
  // 「已下单等到货」「已提交审核」是在等结果：先去掉中间状态，再看有没有真正做完的说法
  const intermediate = ev.match(INTERMEDIATE) ?? [];
  const rest = ev.replace(INTERMEDIATE, "");
  // 有中间状态时，单号/受理号只能证明「办了」，必须有明确的做完说法才算完成
  const completed = DONE_PHRASE.test(rest) || (intermediate.length === 0 && ARTIFACT.test(rest));
  const saysProgress = PROGRESS_PHRASE.test(ev) || intermediate.length > 0;
  // 证据只是把标题抄一遍，不是完成依据
  const norm = (x: string) => x.replace(/[\s，。、,.!！]/g, "");
  const echo = norm(ev).length <= norm(title).length + 2 && (norm(title).includes(norm(ev)) || norm(ev).includes(norm(title)));
  if (echo && !ARTIFACT.test(ev)) return { progress: true, completed: false };
  if (!ev || ev.length < 4) return { progress: true, completed: false };
  return { progress: saysProgress && !completed, completed };
}

/** 标题层面：像「进度更新」「跟进」「沟通」这类过程性表达，不是可验收的交付物 */
export function isProgressLikeTitle(title: string) {
  const t = title.trim();
  if (/^(跟进|推进|沟通|联系|对接|协调|处理|看看|了解|确认一下|反馈)/.test(t) && t.length <= 14) return true;
  if (/(^|\s)(进行中|持续|继续|后续)/.test(t)) return true;
  return false;
}

// ---------- 写入 ----------

function appendProgress(existing: string, entry: string) {
  const line = `【${new Date().toISOString().slice(0, 16).replace("T", " ")}】${entry}`;
  const body = existing ? `${existing}\n\n${line}` : line;
  return body.length > PROGRESS_NOTE_MAX ? body.slice(body.length - PROGRESS_NOTE_MAX) : body;
}

/**
 * 添加任务。分层规则：
 * - 给了 expected_version 且版本不符 → 这是「同一件事的新进展」，合并进已有任务（返回 merged=true），不新建。
 * - 标题像过程性表达且同项目已有相似的未完成任务 → 作为进展合并进去，不新建流水账。
 * 返回值里 explicit: true 表示「需要检查是否重复」，供 agent 自己判断。
 */
export function addItems(projectId: string, list: ItemInput[], actor: Actor, ip = "") {
  ensureInbox();
  const p = db.select().from(s.projects).where(sql`${s.projects.id}=${projectId} or lower(${s.projects.key})=lower(${projectId})`).get()
    ?? db.select().from(s.projects).where(eq(s.projects.isInbox, 1)).get();
  if (!p) throw Object.assign(new Error("项目不存在"), { status: 404 });
  const maxPos = db.select({ m: sql<number>`coalesce(max(${s.items.position}),0)` }).from(s.items).where(eq(s.items.projectId, p.id)).get()?.m ?? 0;
  const created: string[] = [];
  const byIndex: Array<string | null> = list.map(() => null); // 第 i 条输入最终落到哪个事项（新建或合并进的）
  const merged: Array<{ id: string; intoTitle: string; reason: string }> = [];
  const hints: string[] = [];
  const openAll = db.select().from(s.items).where(and(eq(s.items.projectId, p.id), inArray(s.items.status, [...OPEN_STATUSES]), isNull(s.items.parkingLot))).all();

  db.transaction(() => {
    list.forEach((it, i) => {
      const title = it.title.trim();
      // 合并候选只在同一归属里找：采购的待办不会被并进合作的待办
      const open = openAll.filter((o) => (o.ownerType || "") === (it.ownerType || "") && (o.ownerId || "") === (it.ownerId || ""));
      // 1) 显式进展合并
      if (it.expectedVersion != null) {
        const cand = open.find((o) => o.version !== it.expectedVersion && similar(o.title, title));
        if (cand) {
          db.update(s.items).set({
            detailMd: appendProgress(cand.detailMd, `进展：${it.detailMd || title}`), version: cand.version + 1, updatedAt: nowSec(),
          }).where(eq(s.items.id, cand.id)).run();
          db.insert(s.itemEvents).values({ id: newId("evt"), itemId: cand.id, actorType: actor.type, actorName: actor.name, action: "progress", fromStatus: cand.status, toStatus: cand.status, note: it.detailMd || title, createdAt: nowSec() }).run();
          merged.push({ id: cand.id, intoTitle: cand.title, reason: "版本已更新，记为进展" });
          byIndex[i] = cand.id;
          return;
        }
      }
      // 2) 同名事项在本次会议/批次里已存在（未完成）→ 视为进展，合并进去
      const sameName = open.find((o) => similar(o.title, title));
      if (it.statusNote && sameName) {
        db.update(s.items).set({
          detailMd: appendProgress(sameName.detailMd, `进展：${it.statusNote}`), version: sameName.version + 1, updatedAt: nowSec(),
        }).where(eq(s.items.id, sameName.id)).run();
        db.insert(s.itemEvents).values({ id: newId("evt"), itemId: sameName.id, actorType: actor.type, actorName: actor.name, action: "progress", note: it.statusNote, createdAt: nowSec() }).run();
        merged.push({ id: sameName.id, intoTitle: sameName.title, reason: "同一事项的进展" });
        byIndex[i] = sameName.id;
        return;
      }
      // 3) 过程性标题 → 合并进相似未完成任务
      if (isProgressLikeTitle(title)) {
        const cand = open.find((o) => similar(o.title, title) || title.includes(o.title.slice(0, 6)) || o.title.includes(title.slice(0, 6)));
        if (cand) {
          db.update(s.items).set({
            detailMd: appendProgress(cand.detailMd, `进展：${title}`), version: cand.version + 1, updatedAt: nowSec(),
          }).where(eq(s.items.id, cand.id)).run();
          db.insert(s.itemEvents).values({ id: newId("evt"), itemId: cand.id, actorType: actor.type, actorName: actor.name, action: "progress", note: title, createdAt: nowSec() }).run();
          merged.push({ id: cand.id, intoTitle: cand.title, reason: "过程性描述，记为进展" });
          byIndex[i] = cand.id;
          return;
        }
      }
      const id = newId("itm");
      const needsDef = !it.doneDefinition || it.doneDefinition.trim().length < 2;
      db.insert(s.items).values({
        id, projectId: p.id, workstreamId: it.workstreamId ?? null, parentId: it.parentId ?? null,
        parkingLot: p.isInbox === 1 ? 1 : null,
        title: title.slice(0, 500), detailMd: it.statusNote ? appendProgress(it.detailMd ?? "", `进展：${it.statusNote}`) : (it.detailMd ?? ""), doneDefinition: it.doneDefinition ?? "",
        priority: it.priority ?? "P1", dueAt: it.dueAt ?? null, sourceType: it.sourceType ?? "manual",
        sourceRef: it.sourceRef ?? "", position: maxPos + i + 1, createdAt: nowSec(), updatedAt: nowSec(),
        kind: it.kind ?? "task", milestoneId: it.milestoneId ?? null, requirementId: it.requirementId ?? null,
        mustMeet: it.mustMeet ? 1 : 0, startAt: it.startAt ?? null, leadTimeDays: it.leadTimeDays ?? null,
        recurRule: it.recurRule && validRecur(it.recurRule) ? it.recurRule : "", ownerType: it.ownerType ?? "", ownerId: it.ownerId ?? "",
      }).run();
      db.insert(s.itemEvents).values({ id: newId("evt"), itemId: id, actorType: actor.type, actorName: actor.name, action: "create", toStatus: "todo", createdAt: nowSec() }).run();
      created.push(id);
      byIndex[i] = id;
      if (needsDef) hints.push(`「${title.slice(0, 30)}」缺少可验收的 done_definition（做到什么程度算完）；过程性记录不要建成任务。`);
    });
  });
  audit(actor, "items.add", "project", p.id, { count: created.length, ids: created, merged }, { ip });
  for (const it of list) syncRequirement(it.requirementId);
  return { ids: created, byIndex, merged, hints, progress: progressFor(p.id) };
}

function normalize(t: string) {
  return t.split("").filter((c) => !/\s/.test(c) && "，。！？、,.!?:：;；“”'‘’()（）-—_".indexOf(c) < 0).join("").toLowerCase();
}

/** 粗粒度相似：字符二元组重合率 ≥ 0.6 */
export function similar(a: string, b: string) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const grams = (x: string) => { const set = new Set<string>(); for (let i = 0; i < x.length - 1; i++) set.add(x.slice(i, i + 2)); return set; };
  const ga = grams(na), gb = grams(nb);
  if (!ga.size || !gb.size) return false;
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit++;
  return hit / Math.min(ga.size, gb.size) >= 0.6;
}

export function updateItem(itemId: string, patch: UpdatePatch, actor: Actor, agentSessionId?: string, ip = "") {
  const cur = db.select().from(s.items).where(eq(s.items.id, itemId)).get();
  if (!cur) throw Object.assign(new Error("任务不存在"), { status: 404 });
  if (patch.expectedVersion != null && patch.expectedVersion !== cur.version) {
    throw Object.assign(new Error(`版本冲突：当前版本 ${cur.version}，你提交的是 ${patch.expectedVersion}。请重新读取后再提交。`), { status: 409, current: cur });
  }
  const set: Record<string, unknown> = { version: cur.version + 1, updatedAt: nowSec() };
  let flag: string | undefined;
  if (patch.status && patch.status !== cur.status) {
    set.status = patch.status;
    if (patch.status === "done") set.completedAt = nowSec();
    if (patch.status !== "blocked") set.blockReason = "";
    if (patch.evidence) set.evidence = patch.evidence;
    if (patch.status === "done" && cur.status !== "done") {
      const verdict = looksLikeProgressNotCompletion(cur.title, patch.evidence ?? patch.note ?? "");
      if (verdict.progress) {
        set.needsReview = 1;
        flag = "evidence_is_progress";
      } else {
        set.needsReview = 0;
      }
    }
    if (patch.status !== "done") set.needsReview = 0;
  } else if (patch.status === "done" && cur.status === "done" && (patch.evidence || patch.note)) {
    // 已完成事项补证据/核实：用户亲自核实即清除待核实；agent 补证据则重新判定
    const ev = patch.evidence || patch.note || "";
    if (patch.evidence) set.evidence = patch.evidence;
    if (actor.type === "user") set.needsReview = 0;
    else {
      const verdict = looksLikeProgressNotCompletion(cur.title, ev);
      set.needsReview = verdict.progress ? 1 : 0;
      if (verdict.progress) flag = "evidence_is_progress";
    }
    db.insert(s.itemEvents).values({ id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name, action: "verify", fromStatus: "done", toStatus: "done", evidence: ev, note: "补充/核实完成证据", createdAt: nowSec() }).run();
  }
  // 备注只写备注，不覆盖证据（证据是验收依据，必须单独保留）
  if (patch.note && set.evidence === undefined) set.evidence = cur.evidence ? cur.evidence : patch.note;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt;
  if (patch.blockReason !== undefined) set.blockReason = patch.blockReason;
  if (patch.priority) set.priority = patch.priority;
  if (patch.title) set.title = patch.title;
  if (patch.detailMd !== undefined) set.detailMd = patch.detailMd;
  if (patch.doneDefinition !== undefined) set.doneDefinition = patch.doneDefinition;
  if (patch.kind) set.kind = patch.kind;
  if (patch.milestoneId !== undefined) set.milestoneId = patch.milestoneId;
  if (patch.requirementId !== undefined) set.requirementId = patch.requirementId;
  if (patch.mustMeet !== undefined) set.mustMeet = patch.mustMeet ? 1 : 0;
  if (patch.startAt !== undefined) set.startAt = patch.startAt;
  if (patch.leadTimeDays !== undefined) set.leadTimeDays = patch.leadTimeDays;
  applySecretaryPatch(cur, patch, set);
  db.transaction(() => {
    db.update(s.items).set(set).where(eq(s.items.id, itemId)).run();
    if (patch.status && patch.status !== cur.status) {
      db.insert(s.itemEvents).values({
        id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name,
        action: patch.status === "done" ? "complete" : patch.status === "changed" ? "change" : "update",
        fromStatus: cur.status, toStatus: patch.status, note: patch.note ?? "", evidence: patch.evidence ?? "", createdAt: nowSec(),
      }).run();
    } else if (patch.note) {
      db.insert(s.itemEvents).values({ id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name, action: "progress", fromStatus: cur.status, toStatus: cur.status, note: patch.note, createdAt: nowSec() }).run();
    }
  });
  audit(actor, "item.update", "item", itemId, { patch, session: agentSessionId, flag }, { ip });
  const updated = db.select().from(s.items).where(eq(s.items.id, itemId)).get()!;
  syncRequirement(updated.requirementId);
  if (cur.requirementId && cur.requirementId !== updated.requirementId) syncRequirement(cur.requirementId);
  const nextRecur = patch.status === "done" && cur.status !== "done" ? spawnNextRecurrence(updated, actor) : null;
  // 开工但前置没完成：不拦，只提醒（一人公司常有「先并行准备」的情况）
  const waits = patch.status === "doing" ? waitingOn(itemId) : [];
  return { item: updated, progress: progressFor(cur.projectId), flag, waitingOn: waits.map((w) => w.blockerTitle), nextRecur };
}

const DAY = 86400;
export const FOLLOW_UP_DEFAULT_DAYS = 3;

/** 等待/计划/搁置字段：交出去自动记日期并默认 3 天后催；改计划日清零滚动计数；完成即清空等待与计划 */
function applySecretaryPatch(cur: typeof s.items.$inferSelect, patch: UpdatePatch, set: Record<string, unknown>) {
  if (patch.waitingFor !== undefined) {
    const w = patch.waitingFor.trim().slice(0, 80);
    set.waitingFor = w;
    if (w && w !== cur.waitingFor) {
      set.delegatedAt = nowSec();
      set.followUpAt = patch.followUpAt ?? nowSec() + FOLLOW_UP_DEFAULT_DAYS * DAY;
    }
    if (!w) { set.delegatedAt = null; set.followUpAt = null; }
  }
  if (patch.followUpAt !== undefined && (patch.waitingFor === undefined || patch.waitingFor.trim())) set.followUpAt = patch.followUpAt;
  if (patch.plannedFor !== undefined) {
    const d = patch.plannedFor.trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw Object.assign(new Error("planned_for 要写成 YYYY-MM-DD"), { status: 400 });
    set.plannedFor = d;
    if (d !== cur.plannedFor) set.rollCount = 0;
  }
  if (patch.deferUntil !== undefined) set.deferUntil = patch.deferUntil;
  if (patch.remindAt !== undefined && patch.remindAt !== cur.remindAt) { set.remindAt = patch.remindAt; set.remindedAt = null; }
  const finalStatus = (set.status as string | undefined) ?? cur.status;
  if (finalStatus === "done" || finalStatus === "dropped") {
    set.waitingFor = ""; set.followUpAt = null; set.plannedFor = ""; set.rollCount = 0;
  }
}

/** 重复事项完成后生成下一期（同一根下只保留一个未完成的下一期，防止重复点完成生成多条） */
function spawnNextRecurrence(done: typeof s.items.$inferSelect, actor: Actor) {
  if (!done.recurRule) return null;
  const root = done.recurParentId || done.id;
  const pending = db.select().from(s.items).where(eq(s.items.recurParentId, root)).all().find((i) => !["done", "dropped"].includes(i.status) && i.id !== done.id);
  if (pending) return { id: pending.id, dueAt: pending.dueAt };
  const due = nextOccurrence(done.recurRule, Math.max(done.dueAt ?? 0, nowSec()));
  if (!due) return null;
  const id = newId("itm");
  const t = nowSec();
  const maxPos = db.select({ m: sql<number>`coalesce(max(${s.items.position}),0)` }).from(s.items).where(eq(s.items.projectId, done.projectId)).get()?.m ?? 0;
  const base = done.detailMd.includes("【") ? done.detailMd.slice(0, done.detailMd.indexOf("【")).trim() : done.detailMd;
  db.insert(s.items).values({
    id, projectId: done.projectId, title: done.title, detailMd: base, doneDefinition: done.doneDefinition, priority: done.priority,
    kind: done.kind, dueAt: due, recurRule: done.recurRule, recurParentId: root, ownerType: done.ownerType, ownerId: done.ownerId,
    workstreamId: done.workstreamId, milestoneId: null, sourceType: "manual", sourceRef: `recur:${root}`, position: maxPos + 1, createdAt: t, updatedAt: t,
  }).run();
  db.insert(s.itemEvents).values({ id: newId("evt"), itemId: id, actorType: "system", actorName: "system", action: "create", toStatus: "todo", note: `${describeRecur(done.recurRule)}的下一期（上一期由 ${actor.name} 完成）`, createdAt: t }).run();
  return { id, dueAt: due };
}

/** 追加一条进展（不改变状态）：进度是叠加的，不是靠新建任务体现 */
export function addProgress(itemId: string, note: string, actor: Actor, opts: { percent?: number } = {}) {
  const cur = db.select().from(s.items).where(eq(s.items.id, itemId)).get();
  if (!cur) throw Object.assign(new Error("任务不存在"), { status: 404 });
  if (cur.status === "done" || cur.status === "dropped") throw Object.assign(new Error(`任务已是「${cur.status}」，如需继续请先重新打开；新增事项请建新任务并说明与它的关系`), { status: 409 });
  const entry = opts.percent != null ? `${note}（进度 ${Math.min(100, Math.max(0, opts.percent))}%）` : note;
  db.transaction(() => {
    db.update(s.items).set({ detailMd: appendProgress(cur.detailMd, entry), version: cur.version + 1, updatedAt: nowSec() }).where(eq(s.items.id, itemId)).run();
    db.insert(s.itemEvents).values({ id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name, action: "progress", fromStatus: cur.status, toStatus: cur.status, note: entry, createdAt: nowSec() }).run();
  });
  audit(actor, "item.progress", "item", itemId, { note: entry });
  return { item: db.select().from(s.items).where(eq(s.items.id, itemId)).get()! };
}

/**
 * 版本更迭：原事项因需求变化而升级为新版本。
 * - 旧任务：状态记为 done，evidence 写明「已被 <新版标题> 取代」，supersededBy 指向新任务；
 * - 新任务：建为待办，detailMd 记录「由 <旧任务> 升级而来」。
 * 不删除历史，保证可追溯「这件事是怎么演变的」。
 */
export function supersedeItem(itemId: string, next: { title: string; detailMd?: string; doneDefinition?: string; dueAt?: number | null; priority?: "P0" | "P1" | "P2" | "P3"; workstreamId?: string | null }, actor: Actor, ip = "") {
  const cur = db.select().from(s.items).where(eq(s.items.id, itemId)).get();
  if (!cur) throw Object.assign(new Error("任务不存在"), { status: 404 });
  if (cur.supersededBy) throw Object.assign(new Error("该任务已被替换过，请在其最新版本上继续"), { status: 409 });
  const id = newId("itm");
  const maxPos = db.select({ m: sql<number>`coalesce(max(${s.items.position}),0)` }).from(s.items).where(eq(s.items.projectId, cur.projectId)).get()?.m ?? 0;
  db.transaction(() => {
    db.insert(s.items).values({
      id, projectId: cur.projectId, workstreamId: next.workstreamId ?? cur.workstreamId, parentId: cur.parentId,
      title: next.title.slice(0, 500), detailMd: next.detailMd ?? `由「${cur.title}」升级而来`,
      doneDefinition: next.doneDefinition ?? cur.doneDefinition, priority: next.priority ?? cur.priority,
      dueAt: next.dueAt !== undefined ? next.dueAt : cur.dueAt, sourceType: "agent", sourceRef: `supersede:${cur.id}`,
      position: maxPos + 1, createdAt: nowSec(), updatedAt: nowSec(),
      kind: cur.kind, milestoneId: cur.milestoneId, requirementId: cur.requirementId, mustMeet: cur.mustMeet,
      startAt: cur.startAt, leadTimeDays: cur.leadTimeDays,
    }).run();
    // 依赖随新版本转移：旧版卡着的事改由新版卡，旧版等的前置新版继续等
    db.update(s.itemDeps).set({ blockerId: id }).where(eq(s.itemDeps.blockerId, itemId)).run();
    db.update(s.itemDeps).set({ blockedId: id }).where(eq(s.itemDeps.blockedId, itemId)).run();
    db.update(s.items).set({
      status: "done", completedAt: nowSec(), supersededBy: id, needsReview: 0, version: cur.version + 1, updatedAt: nowSec(),
      evidence: cur.evidence ? `${cur.evidence}；已被新版本「${next.title}」取代` : `已被新版本「${next.title}」取代`,
    }).where(eq(s.items.id, itemId)).run();
    db.insert(s.itemEvents).values({ id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name, action: "supersede", fromStatus: cur.status, toStatus: "done", note: `升级为新版本「${next.title}」(${id})`, createdAt: nowSec() }).run();
    db.insert(s.itemEvents).values({ id: newId("evt"), itemId: id, actorType: actor.type, actorName: actor.name, action: "create", toStatus: "todo", note: `由「${cur.title}」升级而来`, createdAt: nowSec() }).run();
  });
  audit(actor, "item.supersede", "item", itemId, { next: id, title: next.title }, { ip });
  syncRequirement(cur.requirementId);
  return { old: db.select().from(s.items).where(eq(s.items.id, itemId)).get()!, next: db.select().from(s.items).where(eq(s.items.id, id)).get()! };
}

export function claimItem(itemId: string, sessionId: string, actor: Actor) {
  const cur = db.select().from(s.items).where(eq(s.items.id, itemId)).get();
  if (!cur) throw Object.assign(new Error("任务不存在"), { status: 404 });
  if (cur.status === "done" || cur.status === "dropped") throw Object.assign(new Error("已关闭的任务不能认领；如需继续请重新打开"), { status: 409 });
  const fresh = cur.claimedBy && cur.claimedAt && nowSec() - cur.claimedAt < CLAIM_TTL;
  if (fresh && cur.claimedBy !== sessionId) {
    return { conflict: true, claimedBy: cur.claimedBy, claimedAt: cur.claimedAt, item: cur };
  }
  db.update(s.items).set({ claimedBy: sessionId, claimedAt: nowSec(), status: cur.status === "todo" ? "doing" : cur.status, updatedAt: nowSec() }).where(eq(s.items.id, itemId)).run();
  db.insert(s.itemEvents).values({ id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name, action: "claim", fromStatus: cur.status, toStatus: cur.status === "todo" ? "doing" : cur.status, note: sessionId, createdAt: nowSec() }).run();
  syncRequirement(cur.requirementId);
  return { conflict: false, item: db.select().from(s.items).where(eq(s.items.id, itemId)).get()!, waitingOn: waitingOn(itemId).map((w) => w.blockerTitle) };
}

/** 分拣：把任务移到另一个项目/待办池。跨项目移动只改归属，不改状态，留下审计与事件。 */
export function moveItem(itemId: string, targetProjectId: string | null, actor: Actor, opts: { parkingLot?: boolean | null; note?: string } = {}, ip = "") {
  const cur = db.select().from(s.items).where(eq(s.items.id, itemId)).get();
  if (!cur) throw Object.assign(new Error("任务不存在"), { status: 404 });
  const target = targetProjectId ? db.select().from(s.projects).where(sql`${s.projects.id}=${targetProjectId} or lower(${s.projects.key})=lower(${targetProjectId})`).get() : null;
  if (targetProjectId && !target) throw Object.assign(new Error(`目标项目「${targetProjectId}」不存在`), { status: 404 });
  const toProject = target ?? db.select().from(s.projects).where(eq(s.projects.id, cur.projectId)).get()!;
  const isInbox = toProject.isInbox === 1;
  const parking = isInbox ? 1 : (opts.parkingLot === true ? 1 : opts.parkingLot === false ? null : (target ? null : cur.parkingLot ?? 1));
  if (toProject.id !== cur.projectId) {
    const maxPos = db.select({ m: sql<number>`coalesce(max(${s.items.position}),0)` }).from(s.items).where(eq(s.items.projectId, toProject.id)).get()?.m ?? 0;
    db.transaction(() => {
      db.update(s.items).set({
        projectId: toProject.id, parkingLot: parking, position: maxPos + 1, version: cur.version + 1, updatedAt: nowSec(),
        milestoneId: null, requirementId: null, mustMeet: 0,
        sourceProjectKey: cur.sourceProjectKey || (db.select().from(s.projects).where(eq(s.projects.id, cur.projectId)).get()?.key ?? ""),
      }).where(eq(s.items.id, itemId)).run();
      db.insert(s.itemEvents).values({ id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name, action: "move", fromStatus: cur.status, toStatus: cur.status, note: `移动到 ${toProject.key}${opts.note ? `：${opts.note}` : ""}`, createdAt: nowSec() }).run();
    });
  } else {
    db.update(s.items).set({ parkingLot: parking, version: cur.version + 1, updatedAt: nowSec() }).where(eq(s.items.id, itemId)).run();
  }
  audit(actor, "item.move", "item", itemId, { from: cur.projectId, to: toProject.id, key: toProject.key, parking }, { ip });
  if (toProject.id !== cur.projectId) syncRequirement(cur.requirementId);
  return { item: db.select().from(s.items).where(eq(s.items.id, itemId)).get()!, project: { id: toProject.id, key: toProject.key, name: toProject.name, isInbox: toProject.isInbox === 1 } };
}

/** 合并重复任务：保留 keepId，把 dupIds 的资料引用与事件挂到 keepId 上，然后删除 dupIds（记审计，可追溯）。 */
export function mergeItems(keepId: string, dupIds: string[], actor: Actor) {
  const keep = db.select().from(s.items).where(eq(s.items.id, keepId)).get();
  if (!keep) throw Object.assign(new Error("保留的任务不存在"), { status: 404 });
  const dups = dupIds.filter((id) => id !== keepId).map((id) => db.select().from(s.items).where(eq(s.items.id, id)).get()).filter(Boolean) as Array<typeof keep>;
  const foreign = dups.filter((d) => d.projectId !== keep.projectId);
  if (foreign.length) throw Object.assign(new Error("只能合并同一项目内的任务；跨项目请用 item_move"), { status: 422 });
  db.transaction(() => {
    for (const d of dups) {
      db.update(s.fileRefs).set({ itemId: keepId }).where(eq(s.fileRefs.itemId, d.id)).run();
      db.update(s.itemEvents).set({ itemId: keepId, note: sql`${s.itemEvents.note} || ' [合并自 ' || ${d.title} || ']'` }).where(eq(s.itemEvents.itemId, d.id)).run();
      for (const dep of db.select().from(s.itemDeps).where(eq(s.itemDeps.blockerId, d.id)).all()) {
        if (dep.blockedId !== keepId) db.insert(s.itemDeps).values({ ...dep, id: newId("dep"), blockerId: keepId }).onConflictDoNothing().run();
      }
      for (const dep of db.select().from(s.itemDeps).where(eq(s.itemDeps.blockedId, d.id)).all()) {
        if (dep.blockerId !== keepId) db.insert(s.itemDeps).values({ ...dep, id: newId("dep"), blockedId: keepId }).onConflictDoNothing().run();
      }
      cleanupDepsForItem(d.id);
      if (!keep.requirementId && d.requirementId) db.update(s.items).set({ requirementId: d.requirementId }).where(eq(s.items.id, keepId)).run();
      db.delete(s.items).where(eq(s.items.id, d.id)).run();
    }
  });
  audit(actor, "items.merge", "item", keepId, { merged: dups.map((d) => ({ id: d.id, title: d.title })) });
  for (const d of dups) syncRequirement(d.requirementId);
  return { keep: db.select().from(s.items).where(eq(s.items.id, keepId)).get()!, merged: dups.length };
}

export function releaseItem(itemId: string, actor: Actor) {
  db.update(s.items).set({ claimedBy: "", claimedAt: null, updatedAt: nowSec() }).where(eq(s.items.id, itemId)).run();
  db.insert(s.itemEvents).values({ id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name, action: "release", createdAt: nowSec() }).run();
  return true;
}

export function listItems(opts: { projectId?: string; status?: ItemStatus | "open"; dueBefore?: number; limit?: number; cursor?: number; q?: string; includeParking?: boolean; needsReview?: boolean }) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const conds = [];
  if (!opts.includeParking) conds.push(sql`${s.items.parkingLot} is null`);
  if (opts.projectId) conds.push(eq(s.items.projectId, opts.projectId));
  if (opts.status === "open") conds.push(notInClosed());
  else if (opts.status) conds.push(eq(s.items.status, opts.status));
  if (opts.dueBefore) conds.push(lte(s.items.dueAt, opts.dueBefore));
  if (opts.cursor) conds.push(sql`${s.items.position} > ${opts.cursor}`);
  if (opts.q) conds.push(sql`(${s.items.title} like ${"%" + opts.q + "%"} or ${s.items.detailMd} like ${"%" + opts.q + "%"})`);
  if (opts.needsReview) conds.push(eq(s.items.needsReview, 1));
  const rows = db.select().from(s.items)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(s.items.position), asc(s.items.createdAt))
    .limit(limit + 1).all();
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit), nextCursor: hasMore ? rows[limit - 1].position : null };
}

function notInClosed() {
  return sql`${s.items.status} in ('todo','doing','blocked','changed')`;
}

/** 项目内可能重复的未完成任务（供 agent / 用户核对，不自动删） */
export function findDuplicates(projectId: string, title: string) {
  const open = db.select().from(s.items).where(and(eq(s.items.projectId, projectId), inArray(s.items.status, [...OPEN_STATUSES]))).all();
  return open.filter((o) => similar(o.title, title) || o.title.slice(0, 6) === title.slice(0, 6)).slice(0, 5)
    .map((o) => ({ item_id: o.id, title: o.title, status: o.status, version: o.version }));
}

export function verifyChecklist(projectId: string) {
  const rows = db.select().from(s.items).where(eq(s.items.projectId, projectId)).all().filter((x) => x.parkingLot == null);
  const gaps: Array<{ id: string; title: string; issue: string }> = [];
  for (const it of rows) {
    if (it.status === "done" && !it.evidence.trim() && !it.supersededBy) gaps.push({ id: it.id, title: it.title, issue: "done 但缺少完成证据" });
    if (it.status === "done" && it.needsReview === 1) gaps.push({ id: it.id, title: it.title, issue: "完成证据看起来是进度描述，需核实是否真的做完" });
    if (it.status === "blocked" && !it.blockReason.trim()) gaps.push({ id: it.id, title: it.title, issue: "blocked 但未说明原因" });
    if (it.status === "doing" && !it.claimedBy) gaps.push({ id: it.id, title: it.title, issue: "进行中但无人认领" });
    if (it.status === "doing" && it.claimedBy && it.claimedAt && nowSec() - it.claimedAt > CLAIM_TTL) gaps.push({ id: it.id, title: it.title, issue: `认领超时（${it.claimedBy}）` });
    if (it.dueAt && it.dueAt < nowSec() && !["done", "dropped"].includes(it.status)) gaps.push({ id: it.id, title: it.title, issue: `已逾期：${new Date(it.dueAt * 1000).toISOString().slice(0, 16)}` });
    if (it.status === "changed" && !it.evidence.trim()) gaps.push({ id: it.id, title: it.title, issue: "标记为变更但没写变更内容" });
    if (!it.doneDefinition.trim() && !["done", "dropped"].includes(it.status)) gaps.push({ id: it.id, title: it.title, issue: "缺少完成标准（如何算完成）" });
  }
  // 需求与阶段（第一批）
  const reqs = db.select().from(s.requirements).where(eq(s.requirements.projectId, projectId)).all();
  for (const r of reqs) {
    const its = rows.filter((i) => i.requirementId === r.id);
    if (r.status === "accepted" && !its.length && nowSec() - r.updatedAt > 7 * 86400) gaps.push({ id: r.id, title: `${r.code} ${r.title}`, issue: "需求已确认超过 7 天还没拆出事项" });
    if (r.status === "dropped" && r.closeConfirmed === 0) gaps.push({ id: r.id, title: `${r.code} ${r.title}`, issue: "agent 提议放弃，待用户确认" });
    if (r.status === "proposed" && nowSec() - r.createdAt > 14 * 86400) gaps.push({ id: r.id, title: `${r.code} ${r.title}`, issue: "需求提出超过 14 天未决定做不做" });
  }
  const ms = db.select().from(s.milestones).where(eq(s.milestones.projectId, projectId)).all();
  for (const m of ms) {
    if (["done", "cancelled"].includes(m.status) || !m.dueAt || m.dueAt > nowSec()) continue;
    const open = rows.filter((i) => i.milestoneId === m.id && i.mustMeet === 1 && !["done", "dropped"].includes(i.status));
    if (open.length) gaps.push({ id: m.id, title: `阶段 ${m.name}`, issue: `已过截止日，还有 ${open.length} 个必过项未完成` });
  }
  for (const i of rows.filter((r) => r.status === "doing")) {
    const w = waitingOn(i.id);
    if (w.length) gaps.push({ id: i.id, title: i.title, issue: `已开工但前置未完成：${w.map((x) => x.blockerTitle).join("、")}` });
  }
  // 重复未完成项
  const openRows = rows.filter((r) => (OPEN_STATUSES as readonly string[]).includes(r.status));
  const seen: Array<{ id: string; title: string }> = [];
  for (const r of openRows) {
    const dup = seen.find((x) => similar(x.title, r.title));
    if (dup) gaps.push({ id: r.id, title: r.title, issue: `与「${dup.title}」疑似重复，考虑 item_merge` });
    else seen.push({ id: r.id, title: r.title });
  }
  return { progress: progressFor(projectId), gaps, total: rows.length };
}