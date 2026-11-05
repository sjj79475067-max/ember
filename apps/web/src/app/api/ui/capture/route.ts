import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ingestEnvelope, confirmDraft, rejectDraft, editDraft, confirmAll, reparse, dismissCapture, syncChannelCard } from "@/lib/capture/service";
import { db, s } from "@/lib/db";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/id";

export const dynamic = "force-dynamic";

/** 网页「随手记」页的动作。处理完同步飞书卡片 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role === "client") return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const actor = { type: "user" as const, name: user.name };
  const capOf = (draftId: string) => db.select().from(s.captureDrafts).where(eq(s.captureDrafts.id, draftId)).get()?.captureId;
  try {
    switch (b.action) {
      case "submit": {
        const text = String(b.text ?? "").trim();
        if (!text) return Response.json({ ok: false, error: "写点什么" }, { status: 422 });
        const r = await ingestEnvelope({ channel: "web", externalId: newId("web"), sender: user.name, kind: "text", text });
        return Response.json({ ok: true, captureId: r.capture.id, drafts: r.drafts.length, error: r.capture.status === "failed" ? r.capture.error : undefined });
      }
      case "confirm": {
        const r = await confirmDraft(b.id, actor, b.patch);
        void syncChannelCard(r.draft.captureId);
        return Response.json({ ok: true, href: r.href });
      }
      case "reject": { const d = rejectDraft(b.id, actor); void syncChannelCard(d.captureId); return Response.json({ ok: true }); }
      case "edit": { const d = editDraft(b.id, b.patch ?? {}); void syncChannelCard(d.captureId); return Response.json({ ok: true }); }
      case "confirm_all": { await confirmAll(b.capture_id, actor); void syncChannelCard(b.capture_id); return Response.json({ ok: true }); }
      case "reparse": { await reparse(b.capture_id, b.text); void syncChannelCard(b.capture_id); return Response.json({ ok: true }); }
      case "dismiss": { dismissCapture(b.capture_id, actor); void syncChannelCard(b.capture_id); return Response.json({ ok: true }); }
      default: return Response.json({ ok: false, error: "未知操作" }, { status: 400 });
    }
  } catch (e) {
    const err = e as { status?: number; message?: string };
    const cid = b.id ? capOf(b.id) : b.capture_id;
    if (cid) void syncChannelCard(cid);
    return Response.json({ ok: false, error: err.message ?? "失败" }, { status: err.status ?? 500 });
  }
}
