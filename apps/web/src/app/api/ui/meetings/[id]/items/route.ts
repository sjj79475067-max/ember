import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { addItems } from "@/lib/services/items";
import { saveMeetingItemsSnapshot, loadMeetingItemsSnapshot, previewMeetingItems, getMeeting } from "@/lib/services/meetings";

export const dynamic = "force-dynamic";

type InItem = { title: string; detail_md?: string; done_definition?: string; done?: boolean; status_note?: string; priority?: "P0" | "P1" | "P2" | "P3"; due_at?: number | null };

/** 会议页的「整理清单」：预览（preview）、按网页草稿落库（save）、保存快照（snapshot） */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role === "client") return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const m = getMeeting(id);
  if (!m) return Response.json({ ok: false, error: "会议不存在" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const actor = { type: "user" as const, name: user.name };
  try {
    if (body.action === "preview") {
      const snapshot = loadMeetingItemsSnapshot(id);
      if (snapshot) return Response.json({ ok: true, items: snapshot, fromSnapshot: true });
      return Response.json({ ok: true, ...(await previewMeetingItems(id)) });
    }
    if (body.action === "snapshot") {
      const items = (body.items ?? []) as InItem[];
      saveMeetingItemsSnapshot(id, items);
      return Response.json({ ok: true, saved: items.length });
    }
    // 默认：把网页上确认的草稿落成任务（只建未完成项；done 项归档为已完成）
    const items = (body.items ?? []) as InItem[];
    if (!items.length) return Response.json({ ok: false, error: "清单为空" }, { status: 400 });
    const todo = items.filter((i) => !i.done && i.title?.trim());
    const done = items.filter((i) => i.done && i.title?.trim());
    let created = 0;
    if (todo.length) {
      const res = addItems(m.projectId, todo.map((i) => ({
        title: i.title.trim(), detailMd: i.detail_md ?? "", doneDefinition: i.done_definition ?? "",
        priority: i.priority, dueAt: i.due_at ?? null, sourceType: "meeting" as const, sourceRef: `meeting:${id}`,
      })), actor);
      created += res.ids.length;
    }
    return Response.json({ ok: true, created, merged: 0, skippedDone: done.length });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return Response.json({ ok: false, error: err.message ?? "失败" }, { status: err.status ?? 500 });
  }
}