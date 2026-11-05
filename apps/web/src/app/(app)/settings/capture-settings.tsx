"use client";
import { useEffect, useState } from "react";
import { MessageSquare, Smartphone, Mic, Copy, RotateCw, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type St = {
  channels: Array<{ id: string; label: string; configured: boolean; connected: boolean; detail?: string }>;
  feishu: { enabled: boolean; appId: string; hasSecret: boolean; domain: string; owner: string; fromEnv: boolean };
  captureKey: { prefix: string; active: boolean };
  asr: { base: string; model: string; hasKey: boolean };
};

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/ui/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false, error: "网络错误" }));
  if (!r.ok) toast.error(r.error ?? r.detail ?? "失败");
  return r;
}

/** 设置 → 随手记：飞书机器人、快捷指令密钥、语音识别 */
export function CaptureSettings({ base }: { base: string }) {
  const [st, setSt] = useState<St | null>(null);
  const [f, setF] = useState({ appId: "", secret: "", domain: "feishu" });
  const [asr, setAsr] = useState({ base: "", model: "", key: "" });
  const [code, setCode] = useState("");
  const [key, setKey] = useState("");
  const load = () => fetch("/api/ui/channels").then((r) => r.json()).then((d: St & { ok: boolean }) => {
    if (!d.ok) return;
    setSt(d); setF((x) => ({ ...x, appId: d.feishu.appId, domain: d.feishu.domain })); setAsr((x) => ({ ...x, base: d.asr.base, model: d.asr.model }));
  });
  useEffect(() => { load(); }, []);
  if (!st) return null;
  const fs = st.channels.find((c) => c.id === "feishu");
  const copy = (t: string) => { navigator.clipboard.writeText(t); toast.success("已复制"); };
  const endpoint = `${base}/api/capture`;

  return (
    <section id="capture" className="mt-6">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="size-4" /> 随手记（手机发消息到平台）</h2>
      <Card><CardContent className="flex flex-col gap-5 p-4">
        <p className="text-[12px] leading-5 text-[var(--color-muted)]">发到这里的文字和语音会被整理成草稿，你确认后才落到项目。渠道和整理是分开的：以后做海外版，换成 Lark/Slack 只换渠道这一层。</p>

        {/* 飞书 */}
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <p className="text-[13px] font-medium">飞书机器人</p>
            {st.feishu.enabled ? (fs?.connected ? <Badge tone="ok">已连接</Badge> : <Badge tone="warn">未连接</Badge>) : <Badge>未启用</Badge>}
            {st.feishu.owner && <Badge tone="brand">已绑定 {st.feishu.owner}</Badge>}
            {fs?.detail && !fs.connected && st.feishu.enabled && <span className="text-[11px] text-[var(--color-muted)]">{fs.detail}</span>}
          </div>
          <details className="mb-2 text-[12px] leading-5 text-[var(--color-muted)]">
            <summary className="cursor-pointer select-none text-[var(--color-brand)]">怎么建飞书机器人（约 5 分钟）</summary>
            <ol className="mt-1 list-decimal pl-5">
              <li>打开 open.feishu.cn → 开发者后台 → 创建企业自建应用，添加「机器人」能力。</li>
              <li>权限管理里开通：接收单聊消息、读取用户发给机器人的单聊消息、获取群组中用户 @ 机器人的消息、以应用身份发消息、获取与上传图片或文件资源。</li>
              <li>事件与回调 → 订阅方式选「使用长连接接收事件」；添加事件「接收消息 im.message.receive_v1」；回调里添加「卡片回传交互 card.action.trigger」，同样选长连接。</li>
              <li>凭证与基础信息里复制 App ID 和 App Secret 填到下面，打开开关保存。</li>
              <li>版本管理里发布一个版本（仅自己可见即可），然后在飞书里搜到这个机器人。</li>
              <li>点「生成绑定码」，私聊机器人发「绑定 123456」。之后只有你本人发的消息和点的按钮才会被处理。</li>
            </ol>
            <p className="mt-1">长连接不需要公网地址，家里的电脑也能用。同一个机器人只让一台 Ember 连（正式实例），否则消息会被随机分走。</p>
          </details>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={f.appId} disabled={st.feishu.fromEnv} onChange={(e) => setF({ ...f, appId: e.target.value })} placeholder="App ID（cli_xxx）" className="font-mono" />
            <Input type="password" value={f.secret} disabled={st.feishu.fromEnv} onChange={(e) => setF({ ...f, secret: e.target.value })} placeholder={st.feishu.hasSecret ? "App Secret 已保存（留空不改）" : "App Secret"} />
            <select value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">
              <option value="feishu">飞书（国内）</option><option value="lark">Lark（海外）</option>
            </select>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={async () => { const r = await post({ action: "feishu_save", app_id: f.appId, app_secret: f.secret || undefined, domain: f.domain, enabled: true }); if (r.ok) { toast.success("已保存，正在连接"); setF({ ...f, secret: "" }); setTimeout(load, 2500); } }}>保存并启用</Button>
              {st.feishu.enabled && <Button size="sm" variant="ghost" onClick={async () => { await post({ action: "feishu_save", enabled: false }); load(); }}>停用</Button>}
              {st.feishu.enabled && <Button size="sm" variant="ghost" onClick={async () => { await post({ action: "feishu_restart" }); setTimeout(load, 2500); }}><RotateCw /> 重连</Button>}
            </div>
          </div>
          {st.feishu.fromEnv && <p className="mt-1 text-[11px] text-[var(--color-muted)]">App ID/Secret 来自环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET。</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
            <Button size="sm" variant="outline" onClick={async () => { const r = await post({ action: "feishu_bind" }); if (r.ok) setCode(r.code); }}><KeyRound /> 生成绑定码</Button>
            {code && <span>10 分钟内私聊机器人发：<code className="rounded bg-[var(--color-line)]/50 px-1.5 py-0.5 font-mono">绑定 {code}</code></span>}
            {st.feishu.owner && <Button size="sm" variant="ghost" onClick={async () => { await post({ action: "feishu_unbind" }); load(); }}>解除绑定</Button>}
          </div>
        </div>

        {/* 快捷指令 */}
        <div className="border-t border-[var(--color-line)] pt-4">
          <div className="mb-1.5 flex items-center gap-2"><Smartphone className="size-4" /><p className="text-[13px] font-medium">iPhone 快捷指令 / 任何能发 HTTP 的工具</p>{st.captureKey.active ? <Badge tone="ok">密钥 {st.captureKey.prefix}…</Badge> : <Badge>没有密钥</Badge>}</div>
          <p className="text-[12px] leading-5 text-[var(--color-muted)]">不想用飞书时的备选。这个密钥只能往待审箱里投，读不了数据，丢了也只是多几条要你确认的草稿。</p>
          <details className="mt-1 text-[12px] leading-5 text-[var(--color-muted)]">
            <summary className="cursor-pointer select-none text-[var(--color-brand)]">快捷指令怎么做</summary>
            <ol className="mt-1 list-decimal pl-5">
              <li>新建快捷指令：「听写文本」（或「要求输入」）。</li>
              <li>加「获取 URL 内容」：地址填下面的投递地址，方法 POST，请求体 JSON，加一个字段 text = 上一步的听写文本；头部加 Authorization = Bearer 你的密钥。</li>
              <li>加「显示结果」：显示返回内容里的 message。</li>
              <li>把快捷指令加到主屏幕或背面轻点，说完就进 Ember 待确认。手机要能访问到这台电脑的地址。</li>
            </ol>
          </details>
          <div className="mt-2 flex items-center gap-1 rounded-md bg-[var(--color-line)]/40 p-1.5"><code className="min-w-0 flex-1 truncate text-[11px]">POST {endpoint}</code><button onClick={() => copy(endpoint)}><Copy className="size-3.5" /></button></div>
          {key && <div className="mt-1.5 flex items-center gap-1 rounded-md bg-[var(--color-warn)]/10 p-1.5"><code className="min-w-0 flex-1 truncate text-[11px]">{key}</code><button onClick={() => copy(key)}><Copy className="size-3.5" /></button></div>}
          {key && <p className="mt-1 text-[11px] text-[var(--color-warn)]">密钥只显示这一次。</p>}
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" variant="outline" onClick={async () => { const r = await post({ action: "key_mint" }); if (r.ok) { setKey(r.key); load(); } }}>{st.captureKey.active ? "换一个密钥" : "生成密钥"}</Button>
            {st.captureKey.active && <Button size="sm" variant="ghost" onClick={async () => { await post({ action: "key_revoke" }); setKey(""); load(); }}>作废</Button>}
          </div>
        </div>

        {/* 语音识别 */}
        <div className="border-t border-[var(--color-line)] pt-4">
          <div className="mb-1.5 flex items-center gap-2"><Mic className="size-4" /><p className="text-[13px] font-medium">语音识别</p>{st.asr.base ? <Badge tone="ok">已配置</Badge> : <Badge>未配置（语音会提示改发文字）</Badge>}</div>
          <p className="text-[12px] leading-5 text-[var(--color-muted)]">用 OpenAI 兼容的转写接口（/audio/transcriptions）。本机可跑 SenseVoice 或 faster-whisper 的服务，免费、数据不出门；也可以填云服务（如硅基流动 FunAudioLLM/SenseVoiceSmall）。</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Input className="font-mono sm:col-span-3" value={asr.base} onChange={(e) => setAsr({ ...asr, base: e.target.value })} placeholder="服务地址，如 http://127.0.0.1:8000/v1 或 https://api.siliconflow.cn/v1" />
            <Input className="font-mono" value={asr.model} onChange={(e) => setAsr({ ...asr, model: e.target.value })} placeholder="模型名" />
            <Input type="password" value={asr.key} onChange={(e) => setAsr({ ...asr, key: e.target.value })} placeholder={st.asr.hasKey ? "Key 已保存（留空不改）" : "Key（本机服务可不填）"} />
            <div className="flex gap-1.5">
              <Button size="sm" onClick={async () => { const r = await post({ action: "asr_save", base: asr.base, model: asr.model, key: asr.key || undefined }); if (r.ok) { toast.success("已保存"); setAsr({ ...asr, key: "" }); load(); } }}>保存</Button>
              <Button size="sm" variant="ghost" onClick={async () => { const r = await post({ action: "asr_test" }); if (r.ok) toast.success(r.detail); }}>测试</Button>
            </div>
          </div>
        </div>
      </CardContent></Card>
    </section>
  );
}
