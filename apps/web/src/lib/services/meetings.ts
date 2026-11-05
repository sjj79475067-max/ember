import { db, s } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { addItems, addProgress, updateItem, supersedeItem } from "./items";
import { createFingerprint } from "./ingest";

export type MeetingInput = {
  projectId: string;
  title: string;
  heldAt?: number;
  participants?: string;
  source?: string;
  minutesMd: string;
  summaryMd?: string;
  tags?: string;
  attachments?: Array<{ name: string; path?: string; url?: string; size?: number; kind?: string }>;
  extractItems?: boolean;
  items?: Array<{
    title: string; detailMd?: string; doneDefinition?: string; dueAt?: number | null; priority?: "P0" | "P1" | "P2" | "P3";
    group?: string;
    /** true = 会上已经办完，归档为已完成（带 statusNote 作证据），不计入待办 */
    done?: boolean;
    statusNote?: string;
    /** 这条是某已有未完成事项的新版本：先更迭旧任务再建新任务 */
    supersedes?: string;
    expectedVersion?: number;
  }>;
  parseWithAi?: boolean;
};

export function listMeetings(projectId?: string, limit = 50) {
  const q = db.select().from(s.meetings).orderBy(desc(s.meetings.heldAt)).limit(limit);
  const rows = projectId ? q.where(eq(s.meetings.projectId, projectId)).all() : q.all();
  return rows.filter((r) => !r.id.endsWith(":items"));
}

export function getMeeting(id: string) {
  const m = db.select().from(s.meetings).where(eq(s.meetings.id, id)).get();
  if (!m) return null;
  // 关联事务 = 从这条会议衍生出来的 + 被指定挂到这条会议上的
  const all = db.select().from(s.items).all();
  const items = all.filter((i) => i.sourceRef === `meeting:${id}` || i.sourceRef.includes(`+link:${id}`));
  return { ...m, items };
}

/** 把已有任务挂到某条会议上（会议档案里显示它、但不改变任务本身） */
export function linkItemToMeeting(itemId: string, meetingId: string, actor: Actor) {
  const it = db.select().from(s.items).where(eq(s.items.id, itemId)).get();
  if (!it) throw Object.assign(new Error("任务不存在"), { status: 404 });
  const m = db.select().from(s.meetings).where(eq(s.meetings.id, meetingId)).get();
  if (!m) throw Object.assign(new Error("会议不存在"), { status: 404 });
  // 保留原来源（来自别的会议/导入的），用补充标记追加关联，避免覆盖溯源
  if (!it.sourceRef.includes(`+link:${meetingId}`)) {
    db.update(s.items).set({ sourceRef: `${it.sourceRef || ""}+link:${meetingId}` }).where(eq(s.items.id, itemId)).run();
  }
  db.insert(s.itemEvents).values({ id: newId("evt"), itemId, actorType: actor.type, actorName: actor.name, action: "update", note: `关联到会议：${m.title}`, createdAt: nowSec() }).run();
  audit(actor, "meeting.link_item", "meeting", meetingId, { itemId });
  return { ok: true };
}

export async function createMeeting(input: MeetingInput, actor: Actor, ip = "") {
  const fp = createFingerprint(input.minutesMd, input.projectId);
  const exists = db.select().from(s.meetings).where(eq(s.meetings.id, `fp_${fp}`)).get();
  if (exists) return { meeting: getMeeting(exists.id), deduped: true, createdItemIds: [] as string[], progressNotes: [] as string[], doneNotes: [] as string[] };

  let summary = input.summaryMd ?? "";
  let items = input.items ?? [];

  if ((input.parseWithAi || (input.extractItems === true && !input.items?.length)) && input.minutesMd.trim()) {
    const { extractMeeting, isAiReady } = await import("@/lib/ai/extract");
    if (await isAiReady()) {
      const parsed = await extractMeeting(input.minutesMd, input.title);
      if (parsed) {
        summary = summary || parsed.summary;
        if (!items.length) items = parsed.items;
      }
    }
  }
  if (!items.length && !input.items?.length && input.extractItems === true) {
    // 用户明确要清单时才用确定性规则抽
    const { extractDeterministic } = await import("@/lib/ai/rules");
    const d = extractDeterministic(input.minutesMd, Date.now());
    if (!summary) summary = d.summary;
    items = d.items;
  }
  if (!summary) summary = input.minutesMd.slice(0, 400);

  const id = newId("mtg");
  db.insert(s.meetings).values({
    id, projectId: input.projectId, title: input.title, heldAt: input.heldAt ?? nowSec(),
    participants: input.participants ?? "", source: input.source ?? "manual", minutesMd: input.minutesMd,
    summaryMd: summary, attachments: JSON.stringify(input.attachments ?? []), tags: input.tags ?? "",
    createdAt: nowSec(), updatedAt: nowSec(),
  }).run();
  audit(actor, "meeting.create", "meeting", id, { projectId: input.projectId, title: input.title }, { ip });

  let createdItemIds: string[] = [];
  const progressNotes: string[] = [];
  const doneNotes: string[] = [];
  if (items.length) {
    const pending = items.filter((i) => !i.done);
    const finished = items.filter((i) => i.done);
    if (pending.length) {
      const toAdd: typeof pending = [];
      for (const it of pending) {
        if (it.supersedes) {
          try {
            const r = supersedeItem(it.supersedes, { title: it.title, detailMd: it.detailMd ?? it.statusNote, doneDefinition: it.doneDefinition, dueAt: it.dueAt ?? null, priority: it.priority }, actor, ip);
            createdItemIds.push(r.next.id);
            progressNotes.push(`「${it.title}」作为「${r.old.title}」的新版本建立`);
          } catch { toAdd.push(it); }
        } else toAdd.push(it);
      }
      if (toAdd.length) {
        const res = addItems(input.projectId, toAdd.map((i) => ({
          title: i.title, detailMd: i.detailMd, statusNote: i.statusNote,
          doneDefinition: i.doneDefinition, dueAt: i.dueAt, priority: i.priority,
          sourceType: "meeting" as const, sourceRef: `meeting:${id}`, expectedVersion: i.expectedVersion,
        })), actor, ip);
        createdItemIds.push(...res.ids);
        for (const m of res.merged) progressNotes.push(`「${m.intoTitle}」的进展已合并，未新建`);
      }
    }
    for (const it of finished) {
      const { findDuplicates } = await import("./items");
      const cand = findDuplicates(input.projectId, it.title)[0];
      if (cand) {
        if (it.statusNote && it.statusNote.length > 8) {
          try { updateItem(cand.item_id, { status: "done", evidence: it.statusNote, expectedVersion: cand.version }, actor, undefined, ip); }
          catch { addProgress(cand.item_id, `已办（来自会议「${input.title}」）：${it.title}`, actor); }
        } else addProgress(cand.item_id, `已办（来自会议「${input.title}」）：${it.title}`, actor);
        doneNotes.push(`「${it.title}」对应已有任务，已核销/记录`);
        continue;
      }
      const { ensureGroup } = await import("./boards");
      const res = addItems(input.projectId, [{ title: it.title, detailMd: it.detailMd, doneDefinition: it.doneDefinition, priority: it.priority, dueAt: it.dueAt, workstreamId: it.group ? ensureGroup(input.projectId, it.group).id : null, sourceType: "import", sourceRef: `meeting:${id}` }], actor, ip);
      if (res.ids[0]) {
        try { updateItem(res.ids[0], { status: "done", evidence: it.statusNote || `会议「${input.title}」中已确认办完` }, actor, undefined, ip); } catch {}
        createdItemIds.push(res.ids[0]);
        doneNotes.push(`「${it.title}」已办，归档为已完成`);
      }
    }
  }
  return { meeting: getMeeting(id), deduped: false, createdItemIds, progressNotes, doneNotes };
}

/**
 * 会议「整理清单」：按规则对原文抽一版草稿（不落库），供网页审阅后保存，或交给 agent 处理。
 * 只在用户点了「整理」或 agent 主动调用时才跑，导入本身不触发任何抽取。
 */
export async function previewMeetingItems(meetingId: string) {
  const m = db.select().from(s.meetings).where(eq(s.meetings.id, meetingId)).get();
  if (!m) throw Object.assign(new Error("会议不存在"), { status: 404 });
  const { extractDeterministic } = await import("@/lib/ai/rules");
  const d = extractDeterministic(m.minutesMd, Date.now());
  return { title: m.title, items: d.items };
}

/** 会议清单快照：保存「这条会议确认下来的清单」，便于下次查看（不是任务本体） */
export function saveMeetingItemsSnapshot(meetingId: string, items: unknown[]) {
  const pid = db.select().from(s.meetings).where(eq(s.meetings.id, meetingId)).get()?.projectId ?? "none";
  db.insert(s.meetings).values({
    id: meetingId + ":items", projectId: pid, title: "清单快照", heldAt: nowSec(), minutesMd: "", summaryMd: "",
    attachments: JSON.stringify(items), createdAt: nowSec(), updatedAt: nowSec(),
  }).onConflictDoUpdate({ target: s.meetings.id, set: { attachments: JSON.stringify(items), updatedAt: nowSec() } }).run();
}

export function loadMeetingItemsSnapshot(meetingId: string) {
  const r = db.select().from(s.meetings).where(eq(s.meetings.id, meetingId + ":items")).get();
  return r ? JSON.parse(r.attachments || "[]") : null;
}

export function updateMeeting(id: string, patch: Partial<MeetingInput>, actor: Actor) {
  const cur = db.select().from(s.meetings).where(eq(s.meetings.id, id)).get();
  if (!cur) throw Object.assign(new Error("会议不存在"), { status: 404 });
  const set: Record<string, unknown> = { updatedAt: nowSec() };
  for (const k of ["title", "participants", "source", "minutesMd", "summaryMd", "tags"] as const) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  if (patch.heldAt) set.heldAt = patch.heldAt;
  if (patch.attachments) set.attachments = JSON.stringify(patch.attachments);
  db.update(s.meetings).set(set).where(eq(s.meetings.id, id)).run();
  audit(actor, "meeting.update", "meeting", id, patch);
  return getMeeting(id);
}
