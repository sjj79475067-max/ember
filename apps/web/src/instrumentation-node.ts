import { bootChannels } from "@/lib/capture/boot";

if (process.env.EMBER_DISABLE_CHANNELS !== "1") {
  // 不阻塞启动：连不上飞书也不影响网页
  void bootChannels().catch((e) => console.warn("[channels] boot", e));
}
