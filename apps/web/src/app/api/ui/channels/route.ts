import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { setSetting } from "@/lib/notify";
import { encryptKey } from "@/lib/ai/provider";
import { feishuConfig, mintBindCode } from "@/lib/capture/feishu";
import { mintCaptureKey, revokeCaptureKey, captureKeyInfo } from "@/lib/capture/http";
import { asrConfig, transcribe } from "@/lib/capture/asr";
import { restartChannel, bootChannels } from "@/lib/capture/boot";
import { listChannels } from "@/lib/capture/channel";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function admin() {
  const u = await getSessionUser();
  return u && u.role !== "client" ? u : null;
}

export async function GET() {
  if (!(await admin())) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  await bootChannels();
  const f = feishuConfig();
  const a = asrConfig();
  return Response.json({
    ok: true,
    channels: listChannels().map((c) => ({ id: c.id, label: c.label, ...c.status() })),
    feishu: { enabled: f.enabled, appId: f.appId, hasSecret: f.hasSecret, domain: f.domain, owner: f.ownerOpenId ? (f.ownerName || "已绑定") : "", fromEnv: !!process.env.FEISHU_APP_ID },
    captureKey: captureKeyInfo(),
    asr: { base: a.base, model: a.model, hasKey: a.hasKey },
  });
}

export async function POST(req: NextRequest) {
  const u = await admin();
  if (!u) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const actor = { type: "user" as const, name: u.name };
  try {
    switch (b.action) {
      case "feishu_save": {
        if (b.app_id !== undefined) setSetting("feishu.app_id", String(b.app_id).trim());
        if (b.app_secret) setSetting("feishu.secret_enc", encryptKey(String(b.app_secret).trim()));
        if (b.domain) setSetting("feishu.domain", b.domain === "lark" ? "lark" : "feishu");
        if (b.enabled !== undefined) setSetting("feishu.enabled", b.enabled ? "1" : "0");
        audit(actor, "channel.feishu.save", "setting", "feishu", { enabled: b.enabled, domain: b.domain });
        await restartChannel("feishu");
        return Response.json({ ok: true });
      }
      case "feishu_bind": return Response.json({ ok: true, code: mintBindCode() });
      case "feishu_unbind": { setSetting("feishu.owner_open_id", ""); setSetting("feishu.owner_name", ""); audit(actor, "channel.feishu.unbind", "setting", "feishu", {}); return Response.json({ ok: true }); }
      case "feishu_restart": { await restartChannel("feishu"); return Response.json({ ok: true }); }
      case "key_mint": { const raw = mintCaptureKey(); audit(actor, "capture.key.mint", "setting", "capture", {}); return Response.json({ ok: true, key: raw }); }
      case "key_revoke": { revokeCaptureKey(); audit(actor, "capture.key.revoke", "setting", "capture", {}); return Response.json({ ok: true }); }
      case "asr_save": {
        if (b.base !== undefined) setSetting("asr.base_url", String(b.base).trim());
        if (b.model) setSetting("asr.model", String(b.model).trim());
        if (b.key) setSetting("asr.key_enc", encryptKey(String(b.key).trim()));
        if (b.clear_key) setSetting("asr.key_enc", "");
        return Response.json({ ok: true });
      }
      case "asr_test": {
        // 1 秒静音 wav，只测连通性和鉴权
        const sr = 16000, n = sr, buf = Buffer.alloc(44 + n * 2);
        buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12); buf.writeUInt32LE(16, 16);
        buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
        buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
        const t = await transcribe({ data: buf, mime: "audio/wav", fileName: "test.wav" });
        return Response.json({ ok: t != null, detail: t == null ? "还没填服务地址" : `连通，返回：「${t.slice(0, 40)}」` });
      }
      default: return Response.json({ ok: false, error: "未知操作" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
