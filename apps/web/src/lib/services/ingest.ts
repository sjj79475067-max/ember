import { db, s } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { addItems } from "./items";

export function createFingerprint(text: string) {
  const norm = text.replace(/\s+/g, " ").trim().slice(0, 20000);
  return createHash("sha256").update(norm).digest("hex").slice(0, 24);
}

export type IngestInput = {
  projectId?: string;          // 可空：仅归档为笔记
  kind?: "meeting" | "notes" | "checklist";
  source?: string;
  title?: string;
  text: string;
  occurredAt?: number;
  participants?: string;
  createItems?: boolean;
  useAi?: boolean;
};

export async function ingest(input: IngestInput, actor: Actor, ip = "") {
  const fp = createFingerprint(input.text);
  const dup = db.select().from(s.importBatches).where(eq(s.importBatches.fingerprint, fp)).get();
  if (dup) return { deduped: true, batchId: dup.id, itemIds: JSON.parse(dup.createdItemIds) as string[] };

  let summary = "";
  let items: Array<{ title: string; detailMd?: string; doneDefinition?: string; dueAt?: number | null; priority?: "P0" | "P1" | "P2" | "P3" }> = [];
  let title = input.title ?? "导入内容";
  const useAi = input.useAi ?? true;

  if (useAi) {
    const { extractMeeting, isAiReady } = await import("@/lib/ai/extract");
    if (await isAiReady()) {
      const parsed = await extractMeeting(input.text, title);
      if (parsed) {
        summary = parsed.summary; title = parsed.title || title;
        if (input.createItems !== false) items = parsed.items;
      }
    }
  }
  if (!summary) summary = input.text.replace(/\s+/g, " ").slice(0, 300);

  const batchId = newId("imp");
  let itemIds: string[] = [];
  if (input.createItems !== false && input.projectId && items.length) {
    const res = addItems(input.projectId, items.map((i) => ({ ...i, sourceType: "import" as const, sourceRef: `import:${batchId}` })), actor, ip);
    itemIds = res.ids;
  }
  db.insert(s.importBatches).values({
    id: batchId, projectId: input.projectId ?? null, kind: input.kind ?? "meeting", source: input.source ?? "paste",
    fingerprint: fp, rawText: input.text.slice(0, 200000), summaryMd: summary,
    createdItemIds: JSON.stringify(itemIds), createdAt: nowSec(),
  }).run();

  // 同时归档一条会议/笔记，保证可检索
  if (input.projectId) {
    if ((input.kind ?? "meeting") === "meeting") {
      const { createMeeting } = await import("./meetings");
      await createMeeting({
        projectId: input.projectId, title, heldAt: input.occurredAt ?? nowSec(),
        participants: input.participants ?? "", source: input.source ?? "import",
        minutesMd: input.text, summaryMd: summary,
      }, actor, ip);
    }
  }
  return { deduped: false, batchId, summary, createdItems: items, itemIds };
}

export function listImports(limit = 50) {
  return db.select().from(s.importBatches).orderBy(desc(s.importBatches.createdAt)).limit(limit).all();
}
