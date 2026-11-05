import { getSetting } from "@/lib/notify";
import { decryptKey } from "@/lib/ai/provider";

/**
 * 语音转文字（可插拔）：走 OpenAI 兼容的 /audio/transcriptions 接口。
 * 本机跑 SenseVoice / faster-whisper 的服务、硅基流动、OpenAI 都能接，换服务只改设置。
 * 没配置时返回 null，由调用方提示「请发文字」。
 */
export function asrConfig() {
  const base = getSetting("asr.base_url", "").replace(/\/$/, "");
  const enc = getSetting("asr.key_enc", "");
  return { base, model: getSetting("asr.model", "whisper-1"), hasKey: !!enc, enc, configured: !!base };
}

export async function transcribe(audio: { data: Buffer; mime: string; fileName: string }): Promise<string | null> {
  const c = asrConfig();
  if (!c.configured) return null;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio.data)], { type: audio.mime || "application/octet-stream" }), audio.fileName || "voice.opus");
  form.append("model", c.model);
  form.append("language", "zh");
  form.append("response_format", "json");
  const res = await fetch(`${c.base}/audio/transcriptions`, {
    method: "POST",
    headers: c.enc ? { authorization: `Bearer ${decryptKey(c.enc)}` } : {},
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`语音识别 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const ct = res.headers.get("content-type") ?? "";
  const text = ct.includes("json") ? String((await res.json()).text ?? "") : await res.text();
  return text.trim();
}
