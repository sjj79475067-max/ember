import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getSetting, setSetting } from "@/lib/notify";
import type { ChannelAdapter } from "./channel";

/**
 * 通用 HTTP 渠道：iOS 快捷指令、安卓 Tasker、任何能发 HTTP 的东西。
 * 用单独的「随手记密钥」，只能往待审箱里投，不能读数据、不能落库（和 agent token 分开，丢了也只是多几条待审）。
 */
const hash = (x: string) => createHash("sha256").update(x).digest("hex");

export function mintCaptureKey() {
  const raw = `cap_${randomBytes(20).toString("base64url")}`;
  setSetting("capture.key_hash", hash(raw));
  setSetting("capture.key_prefix", raw.slice(0, 10));
  return raw;
}
export function revokeCaptureKey() {
  setSetting("capture.key_hash", "");
  setSetting("capture.key_prefix", "");
}
export function captureKeyInfo() {
  return { prefix: getSetting("capture.key_prefix", ""), active: !!getSetting("capture.key_hash", "") };
}
export function checkCaptureKey(raw: string | null | undefined) {
  const want = getSetting("capture.key_hash", "");
  if (!raw || !want) return false;
  const a = Buffer.from(hash(raw)), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const httpAdapter: ChannelAdapter = {
  id: "http",
  label: "快捷指令 / HTTP",
  canPush: false,
  status() {
    const k = captureKeyInfo();
    return { configured: k.active, connected: k.active, detail: k.active ? `密钥 ${k.prefix}…` : "还没生成密钥" };
  },
};

export const webAdapter: ChannelAdapter = {
  id: "web",
  label: "网页",
  canPush: false,
  status: () => ({ configured: true, connected: true }),
};
