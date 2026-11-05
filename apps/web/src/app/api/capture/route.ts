import { NextRequest } from "next/server";
import { checkCaptureKey } from "@/lib/capture/http";
import { ingestEnvelope } from "@/lib/capture/service";
import { newId } from "@/lib/id";
import { sendNotification } from "@/lib/notify";

export const dynamic = "force-dynamic";
const MAX_AUDIO = 20 * 1024 * 1024;

/**
 * 随手记投递口（快捷指令 / HTTP）。只进待审箱，不直接落库。
 * - JSON: {"text": "...", "id": "可选，防重复"}
 * - multipart: file=语音文件（可选 text）
 * 认证：Authorization: Bearer cap_xxx，或 ?key=cap_xxx（快捷指令里更好填）
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || req.nextUrl.searchParams.get("key");
  if (!checkCaptureKey(key)) return Response.json({ ok: false, error: "随手记密钥无效" }, { status: 401 });
  const ct = req.headers.get("content-type") ?? "";
  let text = "", externalId = "", audio: { data: Buffer; mime: string; fileName: string } | undefined;
  try {
    if (ct.includes("multipart/form-data")) {
      const f = await req.formData();
      text = String(f.get("text") ?? "");
      externalId = String(f.get("id") ?? "");
      const file = f.get("file");
      if (file && typeof file !== "string") {
        if (file.size > MAX_AUDIO) return Response.json({ ok: false, error: "语音太大（最多 20MB）" }, { status: 413 });
        audio = { data: Buffer.from(await file.arrayBuffer()), mime: file.type || "audio/m4a", fileName: file.name || "voice.m4a" };
      }
    } else if (ct.includes("json")) {
      const b = await req.json();
      text = String(b.text ?? "");
      externalId = String(b.id ?? "");
    } else {
      text = await req.text();
    }
  } catch {
    return Response.json({ ok: false, error: "请求格式不对" }, { status: 400 });
  }
  if (!audio && !text.trim()) return Response.json({ ok: false, error: "内容是空的" }, { status: 422 });
  const r = await ingestEnvelope({ channel: "http", externalId: externalId.slice(0, 80) || newId("http"), sender: "shortcut", kind: audio ? "audio" : "text", text, audio });
  const n = r.drafts.length;
  if (!r.duplicate && r.capture.status !== "failed") void sendNotification("随手记待确认", `整理出 ${n} 条：${r.drafts.slice(0, 3).map((d) => d.title).join("；")}`).catch(() => undefined);
  const base = (process.env.APP_URL || "").replace(/\/$/, "");
  return Response.json({
    ok: r.capture.status !== "failed",
    error: r.capture.status === "failed" ? r.capture.error : undefined,
    // 快捷指令里直接显示这句话
    message: r.capture.status === "failed" ? `没整理成：${r.capture.error}` : `收到，整理出 ${n} 条，去 Ember 确认${base ? `：${base}/capture` : ""}`,
    drafts: r.drafts.map((d) => ({ type: d.type, title: d.title })),
    url: base ? `${base}/capture?id=${r.capture.id}` : undefined,
  });
}
