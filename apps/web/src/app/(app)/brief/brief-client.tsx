"use client";
import { useEffect, useState } from "react";
import { Bot, Bell, RefreshCw, Copy, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Section = { title: string; lines: string[] };

export function BriefClient() {
  const [kind, setKind] = useState<"daily" | "weekly">("daily");
  const [data, setData] = useState<{ md: string; sections: Section[]; aiUsed: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load(k: "daily" | "weekly" = kind) {
    setLoading(true);
    const r = await fetch(`/api/ui/brief?kind=${k}`).then((x) => x.json()).catch(() => null);
    if (r?.ok) setData(r);
    else toast.error(r?.error ?? "生成失败");
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function copy() {
    if (!data) return;
    await navigator.clipboard.writeText(data.md);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">简报</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">把散落各处的进度收成一段话。复制发给任何人，或推到手机。</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-[var(--color-line)]/40 p-0.5 text-xs">
            {([["daily", "今日"], ["weekly", "本周"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => { setKind(k); load(k); }} className={`rounded-md px-2.5 py-1 ${kind === k ? "bg-[var(--color-card)] font-medium shadow-sm" : "text-[var(--color-muted)]"}`}>{l}</button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> 重新生成</Button>
        </div>
      </header>

      {!data ? <Card><CardContent className="p-8 text-center text-sm text-[var(--color-muted)]">{loading ? "生成中…" : "暂无数据"}</CardContent></Card> : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-muted)]">
            <Badge tone={data.aiUsed ? "brand" : "default"}>{data.aiUsed ? <><Sparkles className="size-3" />AI 撰写</> : "结构化生成"}</Badge>
            <span>{data.sections.length} 个板块</span>
            <Button size="sm" variant="ghost" onClick={copy} className="ml-auto">{copied ? <Check /> : <Copy />}{copied ? "已复制" : "复制全文"}</Button>
          </div>
          <Card><CardContent className="whitespace-pre-wrap p-5 text-[13.5px] leading-7">{data.md}</CardContent></Card>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.sections.map((sec) => (
              <Card key={sec.title}><CardContent className="p-4">
                <p className="mb-1.5 text-xs font-semibold text-[var(--color-muted)]">{sec.title}</p>
                <ul className="flex flex-col gap-1 text-[13px]">{sec.lines.slice(0, 8).map((l, i) => <li key={i} className="leading-6">· {l}</li>)}</ul>
              </CardContent></Card>
            ))}
          </div>
          <NotifyPanel />
        </div>
      )}
    </div>
  );
}

function NotifyPanel() {
  const [cfg, setCfg] = useState<{ enabled: boolean; channel: string; barkUrl: string; ntfyTopic: string; ntfyServer: string; webhookUrl: string; minSeverity: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/ui/notify").then((r) => r.json()).then((r) => { if (r.ok) setCfg(r.config); });
  }, []);
  if (!cfg) return null;

  async function save(patch: Partial<typeof cfg>) {
    const next = { ...cfg!, ...patch };
    setCfg(next); setSaving(true);
    await fetch("/api/ui/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
    setSaving(false);
  }
  async function act(action: string) {
    const r = await fetch("/api/ui/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, dry_run: action === "push" && !cfg?.enabled }) }).then((x) => x.json());
    if (action === "test") toast[r.result?.sent ? "success" : "error"](r.result?.sent ? `已发送（${r.result.detail}）` : `未发送：${r.result?.reason ?? r.result?.detail ?? "检查配置"}`);
    else toast.info(JSON.stringify(r.result));
  }

  return (
    <Card className="mt-2 border-dashed">
      <CardContent className="p-4">
        <div className="flex items-center gap-2"><Bell className="size-4 text-[var(--color-brand)]" /><p className="text-sm font-medium">手机推送</p>
          <label className="ml-auto flex items-center gap-1.5 text-xs"><input type="checkbox" checked={cfg.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> 启用</label>
        </div>
        <p className="mt-1 text-[12px] text-[var(--color-muted)]">逾期与阻塞事项推到手机。支持 Bark（iPhone，推荐）、ntfy（全平台免费）、自定义 Webhook。</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1"><span className="text-[11px] text-[var(--color-muted)]">渠道</span>
            <select value={cfg.channel} onChange={(e) => save({ channel: e.target.value })} className="h-8 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-xs">
              <option value="bark">Bark</option><option value="ntfy">ntfy</option><option value="webhook">Webhook</option>
            </select>
          </label>
          {cfg.channel === "bark" && <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-[11px] text-[var(--color-muted)]">Bark 地址（如 https://api.day.app/你的key）</span><Input className="h-8 text-xs" defaultValue={cfg.barkUrl.includes("…") ? "" : cfg.barkUrl} placeholder="https://api.day.app/xxxx" onBlur={(e) => e.target.value && save({ barkUrl: e.target.value })} /></label>}
          {cfg.channel === "ntfy" && <>
            <label className="flex flex-col gap-1"><span className="text-[11px] text-[var(--color-muted)]">ntfy 服务器</span><Input className="h-8 text-xs" defaultValue={cfg.ntfyServer} onBlur={(e) => save({ ntfyServer: e.target.value })} /></label>
            <label className="flex flex-col gap-1"><span className="text-[11px] text-[var(--color-muted)]">主题（topic）</span><Input className="h-8 text-xs" defaultValue={cfg.ntfyTopic} onBlur={(e) => save({ ntfyTopic: e.target.value })} /></label>
          </>}
          {cfg.channel === "webhook" && <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-[11px] text-[var(--color-muted)]">Webhook URL（POST JSON）</span><Input className="h-8 text-xs" defaultValue={cfg.webhookUrl.includes("…") ? "" : cfg.webhookUrl} onBlur={(e) => e.target.value && save({ webhookUrl: e.target.value })} /></label>}
          <label className="flex flex-col gap-1"><span className="text-[11px] text-[var(--color-muted)]">最低级别</span>
            <select value={cfg.minSeverity} onChange={(e) => save({ minSeverity: e.target.value })} className="h-8 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-xs">
              <option value="P0">仅 P0</option><option value="P1">P0 + P1</option><option value="P2">全部</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => act("test")} disabled={saving}>发送测试</Button>
          <Button size="sm" onClick={() => act("push")}><Bot /> 推送当前未读提醒</Button>
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-muted)]">自动推送：在服务器 crontab 加一行，每天 8:00 推送简报：
          <code className="ml-1 rounded bg-[var(--color-line)]/50 px-1">0 8 * * * curl -X POST &quot;http://localhost:3000/api/scheduled/brief?key=$CRON_KEY&quot;</code></p>
      </CardContent>
    </Card>
  );
}
