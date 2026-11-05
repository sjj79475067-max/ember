import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { planToday, saveWeeklyReview, localYmd } from "@/lib/services/secretary";
import { updateItem, addProgress } from "@/lib/services/items";

export const dynamic = "force-dynamic";
const DAY = 86400;

/** 今日 / 复盘页面的用户动作 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role === "client") return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const actor = { type: "user" as const, name: user.name };
  const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === "string") : typeof b.id === "string" ? [b.id] : [];
  try {
    switch (b.action) {
      case "plan": return Response.json({ ok: true, n: planToday(ids, true, actor) });
      case "unplan": return Response.json({ ok: true, n: planToday(ids, false, actor) });
      case "tomorrow": {
        const d = localYmd(Math.floor(Date.now() / 1000) + DAY);
        for (const id of ids) updateItem(id, { plannedFor: d, deferUntil: null }, actor);
        return Response.json({ ok: true });
      }
      case "defer": {
        const days = Math.max(1, Math.min(365, Number(b.days) || 7));
        for (const id of ids) updateItem(id, { plannedFor: "", deferUntil: Math.floor(Date.now() / 1000) + days * DAY }, actor);
        return Response.json({ ok: true });
      }
      case "drop": {
        for (const id of ids) updateItem(id, { status: "dropped", note: b.note || "复盘时决定不做了" }, actor);
        return Response.json({ ok: true });
      }
      case "wait": {
        const w = String(b.waiting_for ?? "").trim();
        if (!w) return Response.json({ ok: false, error: "写上在等谁" }, { status: 400 });
        for (const id of ids) updateItem(id, { waitingFor: w, followUpAt: b.days ? Math.floor(Date.now() / 1000) + Number(b.days) * DAY : undefined }, actor);
        return Response.json({ ok: true });
      }
      case "nudged": {
        // 催过了：记一笔进展，3 天后再提醒
        const days = Math.max(1, Math.min(60, Number(b.days) || 3));
        for (const id of ids) {
          addProgress(id, b.note ? `催办：${b.note}` : "已催办", actor);
          updateItem(id, { followUpAt: Math.floor(Date.now() / 1000) + days * DAY }, actor);
        }
        return Response.json({ ok: true });
      }
      case "unwait": {
        for (const id of ids) updateItem(id, { waitingFor: "", note: b.note || undefined }, actor);
        return Response.json({ ok: true });
      }
      case "done": {
        const ev = String(b.evidence ?? "").trim();
        if (!ev) return Response.json({ ok: false, error: "写一句做到了什么程度" }, { status: 400 });
        for (const id of ids) updateItem(id, { status: "done", evidence: ev }, actor);
        return Response.json({ ok: true });
      }
      case "review": return Response.json({ ok: true, review: saveWeeklyReview({ week: b.week, top3: b.top3 ?? [], notesMd: b.notes }, actor) });
      default: return Response.json({ ok: false, error: "未知操作" }, { status: 400 });
    }
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return Response.json({ ok: false, error: err.message ?? "失败" }, { status: err.status ?? 500 });
  }
}
