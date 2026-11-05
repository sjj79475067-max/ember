import { db, s } from "@/lib/db";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { ensureInbox, INBOX_KEY } from "./projects";

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
};

export type UpdatePatch = {
  status?: ItemStatus; note?: string; evidence?: string; dueAt?: number | null;
  blockReason?: string; expectedVersion?: number; priority?: "P0" | "P1" | "P2" | "P3";
  title?: string; detailMd?: string; doneDefinition?: string;
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
const PROGRESS_CUE = /(已完成|已提交|已发送|已确认|已完成|已上线|已部署|已修复|已签字|已报|已回复|已开会|已预约|已付|已收到|已通过|完成|提交|发送|确认|上线|部署|修复|对接|沟通|联系|整理|起草|草稿|初稿|方案|报价|核对|审核|修改|更新|反馈|跟进|推进|里程碑|第一步|第二步|进度|版本|v\d|阶段|已就绪|已交付)/;
const DONE_CUE = /(已完成|已提交|已发送|已上线|已部署|已修复|已签字|已回复|已通过|已交付|已完成并|验收通过|全部完成)/;

/** 判断「完成证据」是否其实是进度描述：证据里讲的是这件事本身，却没说明做到了什么程度 */
export function looksLikeProgressNotCompletion(title: string, evidence: string): { progress: boolean; completed: boolean } {
  const ev = evidence.trim();
  const short = ev.length <= 12;
  const progress = PROGRESS_CUE.test(ev) && !DONE_CUE.test(ev);
  const completed = DONE_CUE.test(ev) || /(100%|全部|已完成)/.test(ev);
  // 证据只是复述标题（把任务名抄一遍），不是完成依据
  const echo = ev.length <= title.length + 4 && (title.includes(ev) || ev.includes(title.slice(0, Math.min(title.length, 8)))) && !completed;
  return { progress: (progress && !completed) || echo, completed };
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
  const merged: Array<{ id: string; intoTitle: string; reason: string }> = [];
  const hints: string[] = [];
  const open = db.select().from(s.items).where(and(eq(s.items.projectId, p.id), inArray(s.items.status, [...OPEN_STATUSES]), isNull(s.items.parkingLot))).all();

  db.transaction(() => {
    list.forEach((it, i) => {
      const title = it.title.trim();
      // 1) 显式进展合并
      if (it.expectedVersion != null) {
        const cand = open.find((o) => o.version !== it.expectedVersion && similar(o.title, title));
        if (cand) {
          db.update(s.items).set({
            detailMd: appendProgress(cand.detailMd, `进展：${it.detailMd || title}`), version: cand.version + 1, updatedAt: nowSec(),
          }).where(eq(s.items.id, cand.id)).run();
          db.insert(s.itemEvents).values({ id: newId("evt"), itemId: cand.id, actorType: actor.type, actorName: actor.name, action: "progress", fromStatus: cand.status, toStatus: cand.status, note: it.detailMd || title, createdAt: nowSec() }).run();
          merged.push({ id: cand.id, intoTitle: cand.title, reason: "版本已更新，记为进展" });
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
      }).run();
      db.insert(s.itemEvents).values({ id: newId("evt"), itemId: id, actorType: actor.type, actorName: actor.name, action: "create", toStatus: "todo", createdAt: nowSec() }).run();
      created.push(id);
      if (needsDef) hints.push(`「${title.slice(0, 30)}」缺少可验收的 done_definition（做到什么程度算完）；过程性记录不要建成任务。`);
    });
  });
  audit(actor, "items.add", "project", p.id, { count: created.length, ids: created, merged }, { ip });
  return { ids: created, merged, hints, progress: progressFor(p.id) };
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
  }
  // 备注只写备注，不覆盖证据（证据是验收依据，必须单独保留）
  if (patch.note) set.evidence = cur.evidence ? cur.evidence : patch.note;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt;
  if (patch.blockReason !== undefined) set.blockReason = patch.blockReason;
  if (patch.priority) set.priority = patch.priority;
  if (patch.title) set.title = patch.title;
  if (patch.detailMd !== undefined) set.detailMd = patch.detailMd;
  if (patch.doneDefinition !== undefined) set.doneDefinition = patch.doneDefinition;
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
  return { item: updated, progress: progressFor(cur.projectId), flag };
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
    }).run();
    db.update(s.items).set({
      status: "done", completedAt: nowSec(), supersededBy: id, needsReview: 0, version: cur.version + 1, updatedAt: nowSec(),
      evidence: cur.evidence ? `${cur.evidence}；已被新版本「${next.title}」取代` : `已被新版本「${next.title}」取代`,
    }).where(eq(s.items.id, itemId)).run();
    db.insert(s.itemEvents).values({ id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name, action: "supersede", fromStatus: cur.status, toStatus: "done", note: `升级为新版本「${next.title}」(${id})`, createdAt: nowSec() }).run();
    db.insert(s.itemEvents).values({ id: newId("evt"), itemId: id, actorType: actor.type, actorName: actor.name, action: "create", toStatus: "todo", note: `由「${cur.title}」升级而来`, createdAt: nowSec() }).run();
  });
  audit(actor, "item.supersede", "item", itemId, { next: id, title: next.title }, { ip });
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
  return { conflict: false, item: db.select().from(s.items).where(eq(s.items.id, itemId)).get()! };
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
        sourceProjectKey: cur.sourceProjectKey || (db.select().from(s.projects).where(eq(s.projects.id, cur.projectId)).get()?.key ?? ""),
      }).where(eq(s.items.id, itemId)).run();
      db.insert(s.itemEvents).values({ id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name, action: "move", fromStatus: cur.status, toStatus: cur.status, note: `移动到 ${toProject.key}${opts.note ? `：${opts.note}` : ""}`, createdAt: nowSec() }).run();
    });
  } else {
    db.update(s.items).set({ parkingLot: parking, version: cur.version + 1, updatedAt: nowSec() }).where(eq(s.items.id, itemId)).run();
  }
  audit(actor, "item.move", "item", itemId, { from: cur.projectId, to: toProject.id, key: toProject.key, parking }, { ip });
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
      db.delete(s.items).where(eq(s.items.id, d.id)).run();
    }
  });
  audit(actor, "items.merge", "item", keepId, { merged: dups.map((d) => ({ id: d.id, title: d.title })) });
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