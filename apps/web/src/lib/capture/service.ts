import { db, s } from "@/lib/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { addItems, updateItem, addProgress } from "@/lib/services/items";
import { getInbox } from "@/lib/services/projects";
import { createMeeting } from "@/lib/services/meetings";
import { savePurchase } from "@/lib/services/purchases";
import { saveDeal } from "@/lib/services/crm";
import { saveTrip } from "@/lib/services/trips";
import { upsertNote } from "@/lib/services/notes";
import { parseCapture, type Draft } from "./parse";
import { transcribe } from "./asr";
import { getChannel, type Envelope, type ReviewView } from "./channel";

export const TYPE_LABEL: Record<string, string> = { item: "待办", progress: "进展", meeting: "会议记录", purchase: "采购", deal: "客户合作", trip: "行程", note: "笔记" };
const MAX_TEXT = 8000;

type CaptureRow = typeof s.captures.$inferSelect;
type DraftRow = typeof s.captureDrafts.$inferSelect;

function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** 收一条消息：幂等去重 → 转写 → 整理成草稿。不落任何业务数据。 */
export async function ingestEnvelope(env: Envelope, opts: { now?: Date } = {}) {
  const exists = db.select().from(s.captures).where(and(eq(s.captures.channel, env.channel), eq(s.captures.externalId, env.externalId))).get();
  if (exists) return { capture: exists, duplicate: true, drafts: draftsOf(exists.id) };
  const id = newId("cap");
  db.insert(s.captures).values({
    id, channel: env.channel, externalId: env.externalId, sender: env.sender, chatRef: env.chatRef ?? "", kind: env.kind,
    rawText: (env.text ?? "").slice(0, MAX_TEXT), status: "pending", createdAt: nowSec(), updatedAt: nowSec(),
  }).run();
  let text = (env.text ?? "").trim();
  try {
    if (env.kind === "audio") {
      if (!env.audio) throw new Error("没有收到语音内容");
      const t = await transcribe(env.audio);
      if (t == null) throw new Error("还没配置语音识别，请发文字，或在「设置 → 随手记」里接上语音识别服务");
      if (!t) throw new Error("没听清，请重说或发文字");
      text = t.slice(0, MAX_TEXT);
      db.update(s.captures).set({ transcript: text }).where(eq(s.captures.id, id)).run();
    }
    if (!text) throw new Error("内容是空的");
    const r = await parseCapture(text, opts.now);
    saveDrafts(id, r.drafts);
    db.update(s.captures).set({ status: "parsed", parser: r.parser, error: r.note ?? "", updatedAt: nowSec() }).where(eq(s.captures.id, id)).run();
  } catch (e) {
    db.update(s.captures).set({ status: "failed", error: (e as Error).message.slice(0, 300), updatedAt: nowSec() }).where(eq(s.captures.id, id)).run();
  }
  audit({ type: "user", name: `capture:${env.channel}` }, "capture.ingest", "capture", id, { kind: env.kind });
  const cap = db.select().from(s.captures).where(eq(s.captures.id, id)).get()!;
  return { capture: cap, duplicate: false, drafts: draftsOf(id) };
}

function saveDrafts(captureId: string, drafts: Draft[]) {
  drafts.forEach((d, i) => db.insert(s.captureDrafts).values({
    id: newId("cd"), captureId, position: i, type: d.type, projectId: d.projectId, projectConfidence: d.projectConfidence,
    title: d.title, detail: d.detail, dueAt: d.dueAt, priority: d.priority, targetItemId: d.targetItemId, done: d.done ? 1 : 0,
    waitingFor: d.waitingFor, evidence: d.evidence, fieldsJson: JSON.stringify(d.fields ?? {}), status: "pending", createdAt: nowSec(),
  }).run());
}

export function draftsOf(captureId: string) {
  return db.select().from(s.captureDrafts).where(eq(s.captureDrafts.captureId, captureId)).orderBy(s.captureDrafts.position).all();
}

export function getCapture(id: string) {
  return db.select().from(s.captures).where(eq(s.captures.id, id)).get() ?? null;
}

/** 待审列表（网页「随手记」） */
export function listCaptures(opts: { status?: "open" | "all"; limit?: number } = {}) {
  const rows = db.select().from(s.captures).orderBy(desc(s.captures.createdAt)).limit(Math.min(opts.limit ?? 50, 200)).all()
    // 刚处理完的保留 1 小时，方便看落到了哪里
    .filter((c) => opts.status === "all" || ["pending", "parsed", "failed"].includes(c.status) || c.updatedAt > nowSec() - 3600);
  return rows.map((c) => ({ ...c, drafts: draftsOf(c.id) }));
}

export function pendingDraftCount() {
  return db.select().from(s.captureDrafts).where(eq(s.captureDrafts.status, "pending")).all().length;
}

export type DraftPatch = Partial<{ type: string; projectId: string | null; title: string; detail: string; dueAt: number | null; priority: string; waitingFor: string; targetItemId: string | null; done: boolean; fields: Record<string, unknown> }>;

export function editDraft(id: string, patch: DraftPatch) {
  const d = db.select().from(s.captureDrafts).where(eq(s.captureDrafts.id, id)).get();
  if (!d) throw Object.assign(new Error("草稿不存在"), { status: 404 });
  if (d.status !== "pending") throw Object.assign(new Error("这条已经处理过了"), { status: 409 });
  if (patch.projectId) {
    const p = db.select().from(s.projects).where(eq(s.projects.id, patch.projectId)).get();
    if (!p) throw Object.assign(new Error("项目不存在"), { status: 404 });
  }
  const set: Record<string, unknown> = {};
  if (patch.type && TYPE_LABEL[patch.type]) set.type = patch.type;
  if (patch.projectId !== undefined) { set.projectId = patch.projectId; set.projectConfidence = patch.projectId ? 100 : 0; }
  if (patch.title !== undefined) set.title = patch.title.trim().slice(0, 120) || d.title;
  if (patch.detail !== undefined) set.detail = patch.detail.slice(0, 4000);
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt;
  if (patch.priority && ["P0", "P1", "P2", "P3"].includes(patch.priority)) set.priority = patch.priority;
  if (patch.waitingFor !== undefined) set.waitingFor = patch.waitingFor.slice(0, 40);
  if (patch.targetItemId !== undefined) set.targetItemId = patch.targetItemId;
  if (patch.done !== undefined) set.done = patch.done ? 1 : 0;
  if (patch.fields) set.fieldsJson = JSON.stringify(patch.fields);
  if (Object.keys(set).length) db.update(s.captureDrafts).set(set).where(eq(s.captureDrafts.id, id)).run();
  return db.select().from(s.captureDrafts).where(eq(s.captureDrafts.id, id)).get()!;
}

/** 确认一条草稿 → 落到对应项目/对象。幂等：已处理的直接返回上次结果。 */
export async function confirmDraft(id: string, actor: Actor, patch?: DraftPatch) {
  let d = db.select().from(s.captureDrafts).where(eq(s.captureDrafts.id, id)).get();
  if (!d) throw Object.assign(new Error("草稿不存在"), { status: 404 });
  if (d.status !== "pending") return { draft: d, already: true, href: resultHref(d) };
  if (patch && Object.keys(patch).length) d = editDraft(id, patch);
  const cap = getCapture(d.captureId)!;
  const projectId = d.projectId ?? getInbox().id;
  const fields = JSON.parse(d.fieldsJson || "{}") as Record<string, any>;
  const source = cap.transcript || cap.rawText;
  const srcRef = `capture:${cap.id}`;
  let resultType = d.type, resultId = "";
  switch (d.type) {
    case "progress": {
      const target = d.targetItemId ? db.select().from(s.items).where(eq(s.items.id, d.targetItemId)).get() : undefined;
      if (!target) throw Object.assign(new Error("找不到对应的事项，改成「待办」再确认"), { status: 422 });
      if (d.done) updateItem(target.id, { status: "done", evidence: d.evidence || d.title }, actor);
      else {
        addProgress(target.id, d.title + (d.detail ? `：${d.detail}` : ""), actor);
        if (d.waitingFor) updateItem(target.id, { waitingFor: d.waitingFor }, actor);
      }
      resultType = "item"; resultId = target.id;
      break;
    }
    case "meeting": {
      const r = await createMeeting({ projectId, title: d.title, minutesMd: d.detail || source, source: `随手记·${cap.channel}`, extractItems: false } as never, actor);
      resultId = r.meeting?.id ?? "";
      break;
    }
    case "purchase": {
      const p = savePurchase({ title: d.title, specMd: fields.specMd ?? d.detail, caveatsMd: fields.caveatsMd ?? "", budgetYuan: num(fields.budgetYuan), neededBy: d.dueAt, projectId: d.projectId }, actor);
      resultId = p.id;
      break;
    }
    case "deal": {
      const x = saveDeal({ title: d.title, org: fields.org ?? null, amountYuan: num(fields.amountYuan), nextStep: fields.nextStep ?? (d.detail || d.title), nextStepAt: d.dueAt, notesMd: source, projectId: d.projectId }, actor);
      resultId = x.id;
      break;
    }
    case "trip": {
      const start = num(fields.startAt) ?? d.dueAt;
      if (start) {
        const t = saveTrip({ title: d.title, city: fields.city ?? "", purpose: fields.purpose ?? d.detail, startAt: start, endAt: num(fields.endAt) ?? start, projectId: d.projectId }, actor);
        resultId = t.id;
      } else {
        // 没有出发日期：先记成一件待办「定行程」，免得丢
        const r = addItems(projectId, [{ title: `定行程：${d.title}`, detailMd: source, sourceType: "import", sourceRef: srcRef }], actor);
        resultType = "item"; resultId = r.byIndex[0] ?? "";
      }
      break;
    }
    case "note": {
      const n = upsertNote({ projectId: d.projectId, title: d.title, bodyMd: d.detail || source, source: `随手记·${cap.channel}` }, actor);
      resultId = (n as { id: string }).id;
      break;
    }
    default: {
      const r = addItems(projectId, [{ title: d.title, detailMd: d.detail, dueAt: d.dueAt, priority: d.priority as never, sourceType: "import", sourceRef: srcRef }], actor);
      resultType = "item"; resultId = r.byIndex[0] ?? "";
      if (resultId && d.waitingFor) updateItem(resultId, { waitingFor: d.waitingFor }, actor);
    }
  }
  db.update(s.captureDrafts).set({ status: "confirmed", resultType, resultId, decidedBy: actor.name, decidedAt: nowSec() }).where(eq(s.captureDrafts.id, id)).run();
  closeIfDone(cap.id);
  audit(actor, "capture.confirm", "capture_draft", id, { resultType, resultId });
  const out = db.select().from(s.captureDrafts).where(eq(s.captureDrafts.id, id)).get()!;
  return { draft: out, already: false, href: resultHref(out) };
}

export function rejectDraft(id: string, actor: Actor) {
  const d = db.select().from(s.captureDrafts).where(eq(s.captureDrafts.id, id)).get();
  if (!d) throw Object.assign(new Error("草稿不存在"), { status: 404 });
  if (d.status !== "pending") return d;
  db.update(s.captureDrafts).set({ status: "rejected", decidedBy: actor.name, decidedAt: nowSec() }).where(eq(s.captureDrafts.id, id)).run();
  closeIfDone(d.captureId);
  audit(actor, "capture.reject", "capture_draft", id, {});
  return db.select().from(s.captureDrafts).where(eq(s.captureDrafts.id, id)).get()!;
}

export async function confirmAll(captureId: string, actor: Actor) {
  const out = [];
  for (const d of draftsOf(captureId).filter((x) => x.status === "pending")) out.push(await confirmDraft(d.id, actor));
  return out;
}

/** 失败的（如没配语音识别）或整理得不好：你手动改原文后重新整理 */
export async function reparse(captureId: string, text?: string) {
  const cap = getCapture(captureId);
  if (!cap) throw Object.assign(new Error("不存在"), { status: 404 });
  const src = (text ?? (cap.transcript || cap.rawText)).trim();
  if (!src) throw Object.assign(new Error("内容是空的"), { status: 422 });
  db.delete(s.captureDrafts).where(and(eq(s.captureDrafts.captureId, captureId), eq(s.captureDrafts.status, "pending"))).run();
  const r = await parseCapture(src);
  saveDrafts(captureId, r.drafts);
  db.update(s.captures).set({ status: "parsed", parser: r.parser, error: r.note ?? "", ...(text != null ? (cap.kind === "audio" ? { transcript: src } : { rawText: src }) : {}), updatedAt: nowSec() }).where(eq(s.captures.id, captureId)).run();
  return { capture: getCapture(captureId)!, drafts: draftsOf(captureId) };
}

export function dismissCapture(captureId: string, actor: Actor) {
  for (const d of draftsOf(captureId).filter((x) => x.status === "pending")) rejectDraft(d.id, actor);
  db.update(s.captures).set({ status: "done", updatedAt: nowSec() }).where(eq(s.captures.id, captureId)).run();
}

function closeIfDone(captureId: string) {
  const left = db.select().from(s.captureDrafts).where(and(eq(s.captureDrafts.captureId, captureId), eq(s.captureDrafts.status, "pending"))).all().length;
  if (!left) db.update(s.captures).set({ status: "done", updatedAt: nowSec() }).where(eq(s.captures.id, captureId)).run();
}

const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

export function resultHref(d: DraftRow) {
  if (d.status !== "confirmed" || !d.resultId) return undefined;
  if (d.resultType === "item") {
    const it = db.select().from(s.items).where(eq(s.items.id, d.resultId)).get();
    return it ? `/p/${it.projectId}?tab=checklist` : undefined;
  }
  return { meeting: `/meetings/${d.resultId}`, purchase: "/affairs?tab=purchases", deal: "/affairs?tab=deals", trip: "/affairs?tab=trips", note: "/notes" }[d.resultType];
}

/** 渠道审批卡的视图（与网页同一份数据） */
export function reviewView(captureId: string): ReviewView {
  const cap = getCapture(captureId)!;
  const projects = db.select().from(s.projects).all().filter((p) => p.status === "active" && p.isInbox !== 1).map((p) => ({ id: p.id, name: p.name }));
  const names = new Map(db.select().from(s.projects).all().map((p) => [p.id, p.name]));
  const drafts = draftsOf(captureId).map((d) => {
    const target = d.targetItemId ? db.select().from(s.items).where(eq(s.items.id, d.targetItemId)).get() : undefined;
    return {
      id: d.id, type: d.type, typeLabel: TYPE_LABEL[d.type] ?? d.type, title: d.title, projectId: d.projectId, projectName: d.projectId ? names.get(d.projectId) ?? "" : "",
      confidence: d.projectConfidence, dueAt: d.dueAt, waitingFor: d.waitingFor, evidence: d.evidence, status: d.status,
      targetTitle: target?.title, resultHref: resultHref(d) ? appUrl() + resultHref(d) : undefined,
    };
  });
  return { captureId, source: (cap.transcript || cap.rawText).slice(0, 300), drafts, webUrl: `${appUrl()}/capture?id=${captureId}`, projects, note: cap.status === "failed" ? cap.error : cap.error || undefined };
}

/** 网页上处理后，把渠道里那张卡片也改成最新状态（双向同步） */
export async function syncChannelCard(captureId: string) {
  const cap = getCapture(captureId);
  if (!cap?.reviewRef) return;
  const ch = getChannel(cap.channel);
  if (!ch?.updateReview) return;
  try { await ch.updateReview(cap.reviewRef, reviewView(captureId)); } catch (e) { console.warn("[capture] 卡片同步失败", (e as Error).message); }
}

export function setReviewRef(captureId: string, ref: string) {
  db.update(s.captures).set({ reviewRef: ref }).where(eq(s.captures.id, captureId)).run();
}

export function draftsByIds(ids: string[]) {
  return ids.length ? db.select().from(s.captureDrafts).where(inArray(s.captureDrafts.id, ids)).all() : [];
}
