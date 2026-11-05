import { feishuConfig, tryBind, parseCardAction } from "./feishu";
import { ingestEnvelope, confirmDraft, rejectDraft, editDraft, confirmAll, reviewView, setReviewRef, draftsOf } from "./service";
import { secretaryOverview } from "@/lib/services/secretary";
import { db, s } from "@/lib/db";
import { eq } from "drizzle-orm";

type Ch = {
  send(to: string, input: object, opts?: { replyTo?: string }): Promise<{ messageId: string }>;
  updateCard(messageId: string, card: object): Promise<void>;
  downloadResource(fileKey: string, type: "image" | "file"): Promise<Buffer>;
};
type Msg = { messageId: string; chatId: string; chatType: string; senderId: string; senderName?: string; content: string; rawContentType: string; resources: Array<{ type: string; fileKey: string; fileName?: string }> };

const reply = (ch: Ch, m: Msg, text: string) => ch.send(m.chatId, { markdown: text }, { replyTo: m.messageId }).catch(() => undefined);

/** 收到消息。只处理绑定的本人；其他人一律不理（不回话、不落库） */
export async function onMessage(m: Msg, ch: Ch) {
  const c = feishuConfig();
  const text = (m.content || "").replace(/@_user_\d+|<at[^>]*>.*?<\/at>/g, "").trim();
  if (!c.ownerOpenId || c.ownerOpenId !== m.senderId) {
    if (m.chatType === "p2p") {
      const b = tryBind(text, m.senderId, m.senderName ?? "");
      if (b === true) return reply(ch, m, "✅ 绑定成功。以后直接发文字或语音给我，我整理好请你确认。\n发「今天」看今日安排。");
      if (b === false) return reply(ch, m, "绑定码不对或已过期，请在 Ember「设置 → 随手记」重新生成。");
      if (!c.ownerOpenId) return reply(ch, m, "还没绑定。请在 Ember「设置 → 随手记」生成绑定码，然后发「绑定 123456」。");
    }
    return;
  }
  if (/^(今天|今日|today)$/i.test(text)) return reply(ch, m, todayText());
  let env;
  if (m.rawContentType === "audio") {
    const res = m.resources.find((r) => r.type === "audio");
    if (!res) return reply(ch, m, "没收到语音文件，请重发。");
    const data = await ch.downloadResource(res.fileKey, "file");
    env = { channel: "feishu", externalId: m.messageId, sender: m.senderId, chatRef: m.chatId, kind: "audio" as const, audio: { data, mime: "audio/ogg", fileName: `${res.fileKey}.opus` } };
  } else if (["text", "post"].includes(m.rawContentType)) {
    if (!text) return;
    env = { channel: "feishu", externalId: m.messageId, sender: m.senderId, chatRef: m.chatId, kind: "text" as const, text };
  } else {
    return reply(ch, m, "目前只认文字和语音。图片和文件请到网页「导入」。");
  }
  const r = await ingestEnvelope(env);
  if (r.duplicate) return;
  if (r.capture.status === "failed") return reply(ch, m, `没整理成：${r.capture.error}`);
  const sent = await ch.send(m.chatId, { card: (await import("./feishu")).buildReviewCard(reviewView(r.capture.id)) }, { replyTo: m.messageId });
  setReviewRef(r.capture.id, sent.messageId);
}

/** 点卡片按钮。只认本人；处理完更新这张卡 */
export async function onCardAction(e: { messageId: string; operator: { openId: string; name?: string }; action: { value: unknown; option?: string } }, ch: Ch) {
  const c = feishuConfig();
  if (!c.ownerOpenId || e.operator.openId !== c.ownerOpenId) return;
  const act = parseCardAction(e.action.value, e.action.option);
  if (!act) return;
  const actor = { type: "user" as const, name: c.ownerName || "我（飞书）" };
  let captureId: string;
  try {
    if (act.kind === "all") {
      captureId = act.captureId;
      await confirmAll(captureId, actor);
    } else {
      const d = db.select().from(s.captureDrafts).where(eq(s.captureDrafts.id, act.draftId)).get();
      if (!d) return;
      captureId = d.captureId;
      if (act.kind === "ok") await confirmDraft(d.id, actor);
      else if (act.kind === "no") rejectDraft(d.id, actor);
      else if (act.kind === "proj") editDraft(d.id, { projectId: act.projectId! });
    }
  } catch (err) {
    const d = act.kind === "all" ? null : db.select().from(s.captureDrafts).where(eq(s.captureDrafts.id, act.draftId)).get();
    const cid = act.kind === "all" ? act.captureId : d?.captureId;
    if (cid) await ch.updateCard(e.messageId, (await import("./feishu")).buildReviewCard({ ...reviewView(cid), note: `没成功：${(err as Error).message}` })).catch(() => undefined);
    return;
  }
  setReviewRef(captureId, e.messageId);
  await ch.updateCard(e.messageId, (await import("./feishu")).buildReviewCard(reviewView(captureId))).catch(() => undefined);
}

function todayText() {
  const o = secretaryOverview();
  const lines = [`**今日 ${o.date}**`];
  if (o.top3.length) lines.push(`本周三件事：${o.top3.map((x) => `${x.status === "done" ? "✅" : "⬜"}${x.title}`).join("；")}`);
  lines.push(o.today.length ? o.today.slice(0, 8).map((i, n) => `${n + 1}. ${i.title}${i.projectName ? `（${i.projectName}）` : ""}`).join("\n") : "今天没有到期和计划的事。");
  const nudge = o.waiting.filter((w) => w.nudge);
  if (nudge.length) lines.push(`🔔 该催了：${nudge.map((w) => `${w.title}（等 ${w.waitingFor}）`).join("；")}`);
  if (o.decisions.length) lines.push(`要你拍板 ${o.decisions.length} 件，到网页「今日」处理。`);
  return lines.join("\n\n");
}

export const __test = { draftsOf };
