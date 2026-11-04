import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { extractMeeting, isAiReady } from "@/lib/ai/extract";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const { text, title } = await req.json();
  if (!text?.trim()) return Response.json({ ok: false, error: "内容为空" }, { status: 400 });

  if (await isAiReady()) {
    const parsed = await extractMeeting(text, title || "会议记录");
    if (parsed) return Response.json({ ok: true, data: { ...parsed, ai: true } });
  }
  const { extractDeterministic } = await import("@/lib/ai/rules");
  const d = extractDeterministic(text, Date.now());
  return Response.json({ ok: true, data: { title: title || d.title, summary: d.summary, items: d.items, ai: false } });
}
