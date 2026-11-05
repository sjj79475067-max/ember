import { registerChannel, listChannels } from "./channel";
import { feishuAdapter } from "./feishu";
import { httpAdapter, webAdapter } from "./http";

const g = globalThis as unknown as { __emberChannelsBooted?: boolean };

/** 进程启动时注册并启动渠道。飞书默认不启用，必须在设置里打开（避免开发实例和正式实例抢同一个机器人的消息）。 */
export async function bootChannels(force = false) {
  if (g.__emberChannelsBooted && !force) return;
  g.__emberChannelsBooted = true;
  registerChannel(webAdapter);
  registerChannel(httpAdapter);
  registerChannel(feishuAdapter);
  for (const a of listChannels()) {
    try { await a.start?.(); } catch (e) { console.warn(`[channel:${a.id}] 启动失败`, (e as Error).message); }
  }
}

export async function restartChannel(id: string) {
  if (!g.__emberChannelsBooted) return bootChannels();
  const a = listChannels().find((x) => x.id === id);
  await a?.start?.();
}
