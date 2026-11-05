import { NextRequest } from "next/server";
import { feedByToken, renderIcs } from "@/lib/services/calendar";

export const dynamic = "force-dynamic";

/** 手机日历订阅（只读）：/api/calendar/cal_xxx.ics —— 独立 token，可在「事务 → 日历」吊销 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const raw = token.replace(/\.ics$/, "");
  if (!feedByToken(raw)) return new Response("not found", { status: 404 });
  const base = process.env.APP_URL || new URL(req.url).origin;
  return new Response(renderIcs(base), {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store", "content-disposition": 'inline; filename="ember.ics"' },
  });
}
