import { getSetting, setSetting } from "@/lib/notify";
import { decryptKey } from "@/lib/ai/provider";
import { nowSec } from "@/lib/id";
import type { ChannelAdapter, ReviewView } from "./channel";

/**
 * 飞书适配器（长连接：不需要公网地址、不需要配回调 URL）。
 * - 收：私聊/群里 @ 机器人的文字、语音 → 统一信封 → 整理成草稿 → 回一张审批卡
 * - 审：卡片按钮（确认 / 换项目 / 不要 / 去网页改），只认绑定的本人
 * - 同步：网页上处理了，卡片也跟着变
 * 海外版：设置里把域名切到 Lark 即可；换 Slack/Telegram 就新写一个适配器。
 */

export function feishuConfig() {
  const appId = process.env.FEISHU_APP_ID || getSetting("feishu.app_id", "");
  const enc = getSetting("feishu.secret_enc", "");
  const appSecret = process.env.FEISHU_APP_SECRET || (enc ? safeDecrypt(enc) : "");
  return {
    enabled: getSetting("feishu.enabled", "0") === "1",
    appId, appSecret, hasSecret: !!appSecret,
    domain: (getSetting("feishu.domain", "feishu") as "feishu" | "lark"),
    ownerOpenId: getSetting("feishu.owner_open_id", ""),
    ownerName: getSetting("feishu.owner_name", ""),
    bindCode: getSetting("feishu.bind_code", ""),
    bindExpires: Number(getSetting("feishu.bind_expires", "0")),
  };
}
function safeDecrypt(x: string) { try { return decryptKey(x); } catch { return ""; } }

// ---------- 卡片（JSON 2.0） ----------
const md = (content: string) => ({ tag: "markdown", content });
const fmt = (sec: number | null) => (sec ? `${new Date(sec * 1000).getMonth() + 1}/${new Date(sec * 1000).getDate()}` : "");
const fmtTime = (sec: number) => { const x = new Date(sec * 1000); return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
const esc = (t: string) => t.replace(/[<>]/g, (c) => (c === "<" ? "＜" : "＞"));

export function buildReviewCard(v: ReviewView) {
  const pending = v.drafts.filter((d) => d.status === "pending");
  const done = v.drafts.length > 0 && pending.length === 0;
  const elements: unknown[] = [md(`**原话**：${esc(v.source)}${v.source.length >= 300 ? "…" : ""}`)];
  if (v.note) elements.push(md(`<font color='orange'>${esc(v.note)}</font>`));
  if (!v.drafts.length) elements.push(md("没整理出要做的事。可以去网页手动处理。"));
  v.drafts.forEach((d, i) => {
    elements.push({ tag: "hr" });
    const proj = d.projectName ? `${d.projectName}${d.confidence && d.confidence < 70 ? "（不太确定）" : ""}` : "<font color='orange'>未定项目 → 收件箱</font>";
    const meta = [`**${d.typeLabel}**`, proj, d.remindAt ? `⏰ ${fmtTime(d.remindAt)} 提醒你` : d.dueAt ? `截止 ${fmt(d.dueAt)}` : "", d.waitingFor ? `等 ${esc(d.waitingFor)}` : "", d.targetTitle ? `对应「${esc(d.targetTitle)}」` : ""].filter(Boolean).join(" · ");
    const state = d.status === "confirmed" ? " <font color='green'>✓ 已落实</font>" : d.status === "rejected" ? " <font color='grey'>已忽略</font>" : "";
    elements.push(md(`${i + 1}. ${d.status === "rejected" ? `~~${esc(d.title)}~~` : `**${esc(d.title)}**`}${state}\n${meta}${d.evidence && d.status === "pending" ? `\n<font color='grey'>依据：${esc(d.evidence.slice(0, 80))}</font>` : ""}`));
    if (d.status === "pending") {
      elements.push({
        tag: "column_set", flex_mode: "flow", horizontal_spacing: "small",
        columns: [
          col({ tag: "button", text: { tag: "plain_text", content: "确认" }, type: "primary_filled", size: "small", behaviors: [{ type: "callback", value: { a: "ok", d: d.id } }] }),
          ...(d.type !== "progress" ? [col({
            tag: "select_static", placeholder: { tag: "plain_text", content: d.projectName ? "换项目" : "选项目" }, width: "fill",
            options: v.projects.slice(0, 50).map((p) => ({ text: { tag: "plain_text", content: p.name.slice(0, 20) }, value: p.id })),
            behaviors: [{ type: "callback", value: { a: "proj", d: d.id } }],
          })] : []),
          col({ tag: "button", text: { tag: "plain_text", content: "不要" }, type: "default", size: "small", behaviors: [{ type: "callback", value: { a: "no", d: d.id } }] }),
        ],
      });
    } else if (d.resultHref) {
      elements.push({ tag: "column_set", columns: [col({ tag: "button", text: { tag: "plain_text", content: "查看" }, type: "text", size: "small", behaviors: [{ type: "open_url", default_url: d.resultHref }] })] });
    }
  });
  elements.push({ tag: "hr" });
  elements.push({
    tag: "column_set", flex_mode: "flow", horizontal_spacing: "small",
    columns: [
      ...(pending.length > 1 ? [col({ tag: "button", text: { tag: "plain_text", content: `全部确认（${pending.length}）` }, type: "primary", size: "small", behaviors: [{ type: "callback", value: { a: "all", c: v.captureId } }] })] : []),
      col({ tag: "button", text: { tag: "plain_text", content: "去网页改" }, type: "default", size: "small", behaviors: [{ type: "open_url", default_url: v.webUrl }] }),
    ],
  });
  return {
    schema: "2.0",
    config: { update_multi: true, summary: { content: done ? "随手记已处理" : `整理出 ${v.drafts.length} 条，待你确认` } },
    header: { template: done ? "green" : "orange", title: { tag: "plain_text", content: done ? "已处理" : `整理出 ${v.drafts.length} 条，确认后落到项目` } },
    body: { elements },
  };
}
const col = (el: unknown) => ({ tag: "column", width: "auto", elements: [el] });

// ---------- 动作解析（与 SDK 解耦，便于测试） ----------
export type CardAction = { kind: "ok" | "no" | "proj"; draftId: string; projectId?: string } | { kind: "all"; captureId: string };

export function parseCardAction(value: unknown, option?: string): CardAction | null {
  const v = (typeof value === "string" ? safeJson(value) : value) as Record<string, string> | null;
  if (!v || typeof v !== "object") return null;
  if (v.a === "all" && v.c) return { kind: "all", captureId: v.c };
  if (!v.d) return null;
  if (v.a === "ok") return { kind: "ok", draftId: v.d };
  if (v.a === "no") return { kind: "no", draftId: v.d };
  if (v.a === "proj" && option) return { kind: "proj", draftId: v.d, projectId: option };
  return null;
}
function safeJson(s: string) { try { return JSON.parse(s); } catch { return null; } }

/** 绑定码：设置页生成 6 位数字，10 分钟内私聊机器人发「绑定 123456」 */
export function mintBindCode() {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  setSetting("feishu.bind_code", code);
  setSetting("feishu.bind_expires", String(nowSec() + 600));
  return code;
}
export function tryBind(text: string, openId: string, name = "") {
  const m = text.trim().match(/^(?:绑定|bind)\s*(\d{6})$/i);
  if (!m) return null;
  const c = feishuConfig();
  if (!c.bindCode || c.bindExpires < nowSec() || m[1] !== c.bindCode) return false;
  setSetting("feishu.owner_open_id", openId);
  setSetting("feishu.owner_name", name);
  setSetting("feishu.bind_code", "");
  return true;
}

// ---------- 适配器 ----------
type LarkChannelLike = {
  connect(): Promise<void>; disconnect(): Promise<void>;
  on(h: Record<string, (e: any) => unknown>): unknown;
  send(to: string, input: object, opts?: { replyTo?: string }): Promise<{ messageId: string }>;
  updateCard(messageId: string, card: object): Promise<void>;
  downloadResource(fileKey: string, type: "image" | "file"): Promise<Buffer>;
};

const g = globalThis as unknown as { __emberFeishu?: { ch: LarkChannelLike | null; connected: boolean; detail: string } };
const state = (g.__emberFeishu ??= { ch: null, connected: false, detail: "" });

export const feishuAdapter: ChannelAdapter = {
  id: "feishu",
  label: "飞书",
  canPush: true,
  status() {
    const c = feishuConfig();
    return { configured: !!(c.appId && c.appSecret), connected: state.connected, detail: state.detail || (c.ownerOpenId ? `已绑定 ${c.ownerName || "本人"}` : "还没绑定本人") };
  },
  async start() {
    await this.stop?.();
    const c = feishuConfig();
    if (!c.enabled || !c.appId || !c.appSecret) { state.detail = c.enabled ? "缺 App ID 或 App Secret" : "未启用"; return; }
    const lark = await import("@larksuiteoapi/node-sdk");
    const ch = lark.createLarkChannel({
      appId: c.appId, appSecret: c.appSecret, transport: "websocket",
      domain: c.domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu,
      policy: { dmMode: "open", requireMention: true },
      loggerLevel: lark.LoggerLevel.warn, source: "ember",
    }) as unknown as LarkChannelLike;
    const { onMessage, onCardAction } = await import("./feishu-handlers");
    ch.on({
      message: (m: any) => { void onMessage(m, ch).catch((e) => console.warn("[feishu] 处理消息失败", e)); },
      cardAction: (e: any) => onCardAction(e, ch),
      error: (e: any) => { state.detail = `出错：${e?.message ?? e}`; },
      reconnecting: () => { state.connected = false; state.detail = "重连中"; },
      reconnected: () => { state.connected = true; state.detail = ""; },
    });
    state.ch = ch;
    try {
      await ch.connect();
      state.connected = true; state.detail = "";
    } catch (e) {
      state.connected = false; state.detail = `连接失败：${(e as Error).message}`;
    }
  },
  async stop() {
    if (state.ch) { try { await state.ch.disconnect(); } catch { /* 忽略 */ } }
    state.ch = null; state.connected = false;
  },
  async sendReview(chatRef, view, replyTo) {
    if (!state.ch) throw new Error("飞书未连接");
    const r = await state.ch.send(chatRef, { card: buildReviewCard(view) }, replyTo ? { replyTo } : undefined);
    return r.messageId;
  },
  async updateReview(ref, view) {
    if (!state.ch) return;
    await state.ch.updateCard(ref, buildReviewCard(view));
  },
  async sendText(chatRef, text, replyTo) {
    if (!state.ch) return;
    await state.ch.send(chatRef, { markdown: text }, replyTo ? { replyTo } : undefined);
  },
};

/** 测试用：注入假的连接 */
export function __setFeishuChannelForTest(ch: LarkChannelLike | null) {
  state.ch = ch; state.connected = !!ch;
}
