/**
 * 渠道适配层：飞书、快捷指令/HTTP、网页……每个渠道只负责「收消息、发审批卡、同步卡片状态」。
 * 整理、审批、落库全在 capture/service.ts，与渠道无关。做海外版时新增一个适配器（Slack/Telegram/Lark）即可。
 */

/** 统一信封：任何渠道进来的一条消息 */
export type Envelope = {
  channel: string;        // 适配器 id
  externalId: string;     // 渠道侧消息 id，用于幂等
  sender: string;         // 渠道侧发送者 id（飞书 open_id 等）
  chatRef?: string;       // 回复到哪里
  kind: "text" | "audio";
  text?: string;
  audio?: { data: Buffer; mime: string; fileName: string };
};

export type ReviewDraft = {
  id: string; type: string; typeLabel: string; title: string; projectId: string | null; projectName: string;
  confidence: number; dueAt: number | null; waitingFor: string; evidence: string; status: string; targetTitle?: string;
  resultHref?: string;
};
export type ReviewView = {
  captureId: string; source: string; drafts: ReviewDraft[]; webUrl: string; projects: Array<{ id: string; name: string }>; note?: string;
};

export interface ChannelAdapter {
  id: string;
  label: string;
  /** 能否主动推送审批卡片（HTTP 渠道不能，只能回响应） */
  canPush: boolean;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  status(): { configured: boolean; connected: boolean; detail?: string };
  /** 发一张审批卡，返回渠道侧消息 id（用来之后更新卡片） */
  sendReview?(chatRef: string, view: ReviewView, replyTo?: string): Promise<string>;
  /** 更新已发出的审批卡（网页上确认了，卡片也同步变状态） */
  updateReview?(reviewRef: string, view: ReviewView): Promise<void>;
  sendText?(chatRef: string, text: string, replyTo?: string): Promise<void>;
}

const g = globalThis as unknown as { __emberChannels?: Map<string, ChannelAdapter> };
const registry = (g.__emberChannels ??= new Map<string, ChannelAdapter>());

export function registerChannel(a: ChannelAdapter) {
  registry.set(a.id, a);
}
export function getChannel(id: string) {
  return registry.get(id);
}
export function listChannels() {
  return [...registry.values()];
}
