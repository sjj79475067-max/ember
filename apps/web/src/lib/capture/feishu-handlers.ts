import { feishuConfig, tryBind, parseCardAction } from "./feishu";
import { ingestEnvelope, confirmDraft, rejectDraft, editDraft, confirmAll, reviewView, setReviewRef, draftsOf } from "./service";
import { secretaryOverview } from "@/lib/services/secretary";
import { db, s } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { Actor } from "@/lib/audit";

type Ch = {
  send(to: string, input: object, opts?: { replyTo?: string }): Promise<{ messageId: string }>;
  updateCard(messageId: string, card: object): Promise<void>;
  downloadResource(fileKey: string, type: "image" | "file"): Promise<Buffer>;
};
type Msg = { messageId: string; chatId: string; chatType: string; senderId: string; senderName?: string; content: string; rawContentType: string; resources: Array<{ type: string; fileKey: string; fileName?: string }> };

/**
 * 改卡片要等飞书客户端处理完这次点击：点击回调还没返回就改，客户端会用旧卡片盖回去（看起来像"退回没确认"）。
 * 所以先落库、让回调尽快返回，稍后再刷新卡片；刷新失败记日志并补发一条文字，不再悄悄吞掉。
 */
export const CARD_REFRESH_DELAY_MS = 1500;
function refreshCardLater(ch: Ch, messageId: string, build: () => Promise<object>, onFail?: (e: Error) => void) {
  setTimeout(async () => {
    try { await ch.updateCard(messageId, await build()); }
    catch (e) {
      console.warn("[feishu] 卡片刷新失败", (e as Error).message);
      onFail?.(e as Error);
    }
  }, CARD_REFRESH_DELAY_MS);
}

const reply = (ch: Ch, m: Msg, text: string) => ch.send(m.chatId, { markdown: text }, { replyTo: m.messageId }).catch(() => undefined);
function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

/** 收到消息。只处理绑定的本人；其他人一律不理（不回话、不落库） */
export async function onMessage(m: Msg, ch: Ch) {
  const c = feishuConfig();
  const text = (m.content || "").replace(/@_user_\d+|<at[^>]*>.*?<\/at>/g, "").trim();
  if (!c.ownerOpenId || c.ownerOpenId !== m.senderId) {
    if (m.chatType === "p2p") {
      const b = tryBind(text, m.senderId, m.senderName ?? "");
      if (b === true) return reply(ch, m, "✅ 绑定成功。\n直接发话给我就行：问进展、说某件事做完了、说要买什么、要记一条想法——我都听得懂。\n发「今天」看今日安排，「待办」看全部提醒。");
      if (b === false) return reply(ch, m, "绑定码不对或已过期，请在 Ember「设置 → 随手记」重新生成。");
      if (!c.ownerOpenId) return reply(ch, m, "还没绑定。请在 Ember「设置 → 随手记」生成绑定码，然后发「绑定 123456」。");
    }
    return;
  }
  if (/^(今天|今日|today)$/i.test(text)) return reply(ch, m, todayText());
  // 「反馈：…」「记不了：…」「乱了：…」→ 直接进 Ember 维护账本，不走草稿
  const fb = text.match(/^(反馈|记不了|乱了|规则不对|ember\s*问题)\s*[:：]\s*([\s\S]+)/i);
  if (fb) {
    const { reportFeedback } = await import("@/lib/services/maintenance");
    const kind = fb[1] === "记不了" ? "gap" : fb[1] === "乱了" ? "confusion" : fb[1] === "规则不对" ? "rule" : "bug";
    const r = reportFeedback({ kind, title: fb[2].split(/\n/)[0].slice(0, 100), example: fb[2] }, { type: "user", name: c.ownerName || "我（飞书）" });
    return reply(ch, m, r.merged ? `记到已有的问题上了（第 ${r.times} 次）。` : "记下了，维护 Ember 时处理。");
  }
  // 语音先走整理（能识别成待办），不直接当命令
  if (m.rawContentType === "audio") {
    const res = m.resources.find((r) => r.type === "audio");
    if (!res) return reply(ch, m, "没收到语音文件，请重发。");
    const data = await ch.downloadResource(res.fileKey, "file");
    const env0 = { channel: "feishu", externalId: m.messageId, sender: m.senderId, chatRef: m.chatId, kind: "audio" as const, audio: { data, mime: "audio/ogg", fileName: `${res.fileKey}.opus` } };
    const r0 = await ingestEnvelope(env0);
    if (r0.duplicate) return;
    if (r0.capture.status === "failed") return reply(ch, m, `没整理成：${r0.capture.error}`);
    const sent0 = await ch.send(m.chatId, { card: (await import("./feishu")).buildReviewCard(reviewView(r0.capture.id)) }, { replyTo: m.messageId });
    setReviewRef(r0.capture.id, sent0.messageId);
    return;
  }
  if (!["text", "post"].includes(m.rawContentType)) {
    return reply(ch, m, "目前只认文字和语音。图片和文件请到网页「导入」。");
  }
  if (!text) return;

  // 会话式处理：查询直接回，写操作给确认卡，剩下的走随手记草稿
  const handled = await handleConversation(ch, m, text, c);
  if (handled) return;

  const env = { channel: "feishu", externalId: m.messageId, sender: m.senderId, chatRef: m.chatId, kind: "text" as const, text };
  const r = await ingestEnvelope(env);
  if (r.duplicate) return;
  if (r.capture.status === "failed") return reply(ch, m, `没整理成：${r.capture.error}`);
  const sent = await ch.send(m.chatId, { card: (await import("./feishu")).buildReviewCard(reviewView(r.capture.id)) }, { replyTo: m.messageId });
  setReviewRef(r.capture.id, sent.messageId);
}

/**
 * 会话式处理。返回 true 表示已经回过话了。
 * - 查询：直接回结果
 * - 变更：回一张确认卡，你点「确认」才落库
 * - 不确定：返回 false，交给随手记草稿
 */
async function handleConversation(ch: Ch, m: Msg, text: string, c: ReturnType<typeof feishuConfig>): Promise<boolean> {
  const { interpret, runIntent, feishuCtx } = await import("./feishu-converse");
  let intent;
  try {
    intent = await interpret(text, feishuCtx(c.ownerName || "我（飞书）"));
  } catch (e) {
    console.warn("[feishu] 对话理解失败", (e as Error).message);
    return false;
  }
  if (intent.action === "unknown") return false;

  const ctx = feishuCtx(c.ownerName || "我（飞书）");

  // 写操作：先给确认卡，你点「确认」才落库
  if (intent.action === "tool" && intent.tool && isWriteTool(intent.tool)) {
    const preview = intent.text || `要执行：${intent.tool}`;
    const sent = await ch.send(m.chatId, { card: buildConfirmCard(preview, intent.tool, intent.args ?? {}) }, { replyTo: m.messageId });
    pendingActions.set(sent.messageId, { intent, actor: ctx.actor });
    return true;
  }

  const answer = await runIntent(intent, ctx);
  await reply(ch, m, answer);
  return true;
}

/** 需要确认的写工具 */
function isWriteTool(name: string) {
  return ["checklist_update", "checklist_progress", "checklist_add", "note_save", "decision_record",
    "asset_save", "purchase_save", "deal_save", "trip_save", "item_move", "reminder_ack"].includes(name);
}

/** 待确认的写操作（按飞书消息 id 存） */
const pendingActions = new Map<string, { intent: { tool?: string; args?: Record<string, unknown>; text?: string }; actor: Actor }>();

/** 写操作的确认卡 */
export function buildConfirmCard(preview: string, tool: string, args: Record<string, unknown>) {
  const lines = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `**${k}**：${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");
  return {
    schema: "2.0",
    config: { update_multi: true, summary: { content: "等你确认" } },
    header: { template: "orange", title: { tag: "plain_text", content: "确认执行？" } },
    body: {
      elements: [
        { tag: "markdown", content: preview },
        ...(lines ? [{ tag: "hr" }, { tag: "markdown", content: lines }] : []),
        { tag: "hr" },
        {
          tag: "column_set", flex_mode: "flow", horizontal_spacing: "small",
          columns: [
            { tag: "column", width: "auto", elements: [{ tag: "button", text: { tag: "plain_text", content: "确认" }, type: "primary_filled", size: "small", behaviors: [{ type: "callback", value: { a: "run", t: tool } }] }] },
            { tag: "column", width: "auto", elements: [{ tag: "button", text: { tag: "plain_text", content: "算了" }, type: "default", size: "small", behaviors: [{ type: "callback", value: { a: "skip" } }] }] },
          ],
        },
      ],
    },
  };
}

/** 点卡片按钮。只认本人；处理完更新这张卡 */
export async function onCardAction(e: { messageId: string; chatId?: string; operator: { openId: string; name?: string }; action: { value: unknown; option?: string } }, ch: Ch) {
  const c = feishuConfig();
  if (!c.ownerOpenId || e.operator.openId !== c.ownerOpenId) return;

  // 写操作确认卡：「确认」/「算了」
  const raw = (typeof e.action.value === "string" ? safeJson(e.action.value) : e.action.value) as { a?: string; t?: string } | null;
  if (raw?.a === "run" || raw?.a === "skip") {
    const pending = pendingActions.get(e.messageId);
    pendingActions.delete(e.messageId);
    if (raw.a === "skip") {
      if (e.chatId) await ch.send(e.chatId, { markdown: "好，不动。" }, { replyTo: e.messageId }).catch(() => undefined);
      return;
    }
    if (!pending?.intent.tool) {
      if (e.chatId) await ch.send(e.chatId, { markdown: "这个操作已经过期了，再说一次就行。" }, { replyTo: e.messageId }).catch(() => undefined);
      return;
    }
    const { runIntent, feishuCtx } = await import("./feishu-converse");
    const answer = await runIntent({ action: "tool", tool: pending.intent.tool, args: pending.intent.args }, feishuCtx(c.ownerName || "我（飞书）"));
    if (e.chatId) await ch.send(e.chatId, { markdown: answer }, { replyTo: e.messageId }).catch(() => undefined);
    return;
  }

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
    if (cid) refreshCardLater(ch, e.messageId, async () => (await import("./feishu")).buildReviewCard({ ...reviewView(cid), note: `没成功：${(err as Error).message}` }));
    return;
  }
  setReviewRef(captureId, e.messageId);
  const cid = captureId;
  refreshCardLater(ch, e.messageId, async () => (await import("./feishu")).buildReviewCard(reviewView(cid)), () => {
    // 卡片改不了也要让你知道已经落实了
    const done = draftsOf(cid).filter((d) => d.status === "confirmed").length;
    if (e.chatId) void ch.send(e.chatId, { markdown: `已落实 ${done} 条（卡片没刷新成功，以网页「随手记」为准）。` }).catch(() => undefined);
  });
}

export function todayText() {
  const o = secretaryOverview();
  const lines = [`**今日 ${o.date}**`];
  if (o.top3.length) {
    lines.push(`本周三件事：${o.top3.map((x) => `${x.status === "done" ? "✅" : "⬜"}${x.title}`).join("；")}`);
  }
  if (!o.today.length) {
    lines.push("今天没有到期和计划的事。");
  } else {
    const whyLabel: Record<string, string> = {
      overdue: "已逾期", due_today: "今天到期", planned: "今天计划", doing: "进行中",
    };
    for (const i of o.today.slice(0, 10)) {
      const proj = i.projectName ? `**${i.projectName}** — ` : "";
      lines.push(`· ${proj}${i.title}`);
      const meta: string[] = [];
      if (i.priority) meta.push(i.priority);
      if (i.why) meta.push(whyLabel[i.why] ?? i.why);
      if (i.dueAt) {
        const d = new Date(i.dueAt * 1000);
        meta.push(`截止 ${d.getMonth() + 1}/${d.getDate()}`);
      }
      if (meta.length) lines.push(`  ${meta.join(" · ")}`);
      if (i.blockReason) lines.push(`  🚫 阻塞：${i.blockReason}`);
      if (i.waitingFor) lines.push(`  ⏳ 在等：${i.waitingFor}`);
    }
    if (o.today.length > 10) lines.push(`…还有 ${o.today.length - 10} 件`);
  }
  const nudge = o.waiting.filter((w) => w.nudge);
  if (nudge.length) {
    lines.push("");
    lines.push("🔔 该催了：");
    for (const w of nudge.slice(0, 5)) {
      lines.push(`· ${w.projectName ? `**${w.projectName}** — ` : ""}${w.title}（在等 ${w.waitingFor}）`);
    }
  }
  if (o.decisions.length) lines.push(`要你拍板 ${o.decisions.length} 件，到网页「今日」处理。`);
  return lines.join("\n");
}

export const __test = { draftsOf };
