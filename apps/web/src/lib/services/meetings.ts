import { db, s } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { addItems } from "./items";
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
  items?: Array<{ title: string; detailMd?: string; doneDefinition?: string; dueAt?: number | null; priority?: "P0" | "P1" | "P2" | "P3" }>;
  parseWithAi?: boolean;
};

export function listMeetings(projectId?: string, limit = 50) {
  const q = db.select().from(s.meetings).orderBy(desc(s.meetings.heldAt)).limit(limit);
  const rows = projectId ? q.where(eq(s.meetings.projectId, projectId)).all() : q.all();
  return rows;
}

export function getMeeting(id: string) {
  const m = db.select().from(s.meetings).where(eq(s.meetings.id, id)).get();
  if (!m) return null;
  const items = db.select().from(s.items).where(eq(s.items.sourceRef, `meeting:${id}`)).all();
  return { ...m, items };
}

export async function createMeeting(input: MeetingInput, actor: Actor, ip = "") {
  const fp = createFingerprint(input.minutesMd);
  const exists = db.select().from(s.meetings).where(eq(s.meetings.id, `fp_${fp}`)).get();
  if (exists) return { meeting: getMeeting(exists.id), deduped: true, createdItemIds: [] as string[] };

  let summary = input.summaryMd ?? "";
  let items = input.items ?? [];

  if ((input.parseWithAi || (!input.items?.length && input.extractItems !== false)) && input.minutesMd.trim()) {
    const { extractMeeting, isAiReady } = await import("@/lib/ai/extract");
    if (await isAiReady()) {
      const parsed = await extractMeeting(input.minutesMd, input.title);
      if (parsed) {
        summary = summary || parsed.summary;
        if (!items.length) items = parsed.items;
      }
    }
  }
  if (!items.length && !input.items?.length) {
    // 无 AI 或 AI 未产出：使用确定性规则抽取，保证导入后清单不为空
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
  if (items.length) {
    const res = addItems(input.projectId, items.map((i) => ({ ...i, sourceType: "meeting" as const, sourceRef: `meeting:${id}` })), actor, ip);
    createdItemIds = res.ids;
  }
  return { meeting: getMeeting(id), deduped: false, createdItemIds };
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
