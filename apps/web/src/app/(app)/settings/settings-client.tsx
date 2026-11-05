"use client";
import { CaptureSettings } from "./capture-settings";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Plus, Check, Trash2, Activity, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { relTime } from "@/lib/utils";
import { toast } from "sonner";

type Provider = { id: string; label: string; kind: string; baseUrl: string; model: string; enabled: number; isDefault: number; hasKey: boolean };
type Session = { id: string; agentName: string; agentType: string; status: string; lastSeenAt: number; summary: string };

const PRESETS = [
  { label: "DeepSeek", kind: "openai_compat", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  { label: "通义千问", kind: "openai_compat", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { label: "豆包（火山方舟）", kind: "openai_compat", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-1-5-pro-32k" },
  { label: "智谱 GLM", kind: "openai_compat", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus" },
  { label: "OpenAI 中转站", kind: "openai_compat", baseUrl: "", model: "gpt-4o-mini" },
  { label: "Claude 直连", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5" },
];

export function SettingsClient({ providers, usage, sessions, user, base }: { providers: Provider[]; usage: { calls: number; input: number; output: number }; sessions: Session[]; user: { name: string; email: string }; base: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ id: "", label: "", kind: "openai_compat", baseUrl: "", model: "", api_key: "" });
  const [testing, setTesting] = useState<string | null>(null);

  function startNew(preset?: (typeof PRESETS)[number]) {
    setForm({ id: "", label: preset?.label ?? "", kind: preset?.kind ?? "openai_compat", baseUrl: preset?.baseUrl ?? "", model: preset?.model ?? "", api_key: "" });
    setOpen(true);
  }
  function startEdit(p: Provider) { setForm({ id: p.id, label: p.label, kind: p.kind, baseUrl: p.baseUrl, model: p.model, api_key: "" }); setOpen(true); }

  async function save() {
    const r = await fetch("/api/ui/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, enabled: true }) }).then((x) => x.json());
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("已保存"); setOpen(false); router.refresh();
  }
  async function act(action: string, id: string) {
    const r = await fetch("/api/ui/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id }) });
    if (action === "test") {
      const j = await r.json();
      const res = j.result;
      toast[res?.ok ? "success" : "error"](`${res?.ok ? "连接成功" : "连接失败"} · ${res?.ms}ms · ${res?.message}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">AI 配置、会话、数据。核心功能不依赖 AI，未配置时可手动录入。</p>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Bot className="size-4" /> AI 模型（可选）</h2>
          <Button size="sm" variant="outline" onClick={() => startNew()}><Plus /> 添加</Button>
        </div>
        <Card><CardContent className="p-4">
          <p className="mb-3 text-[12px] leading-5 text-[var(--color-muted)]">用到 AI 的地方：会议记录整理与事务抽取、导入预览。其余全部是结构化计算。国内模型优先，支持中转站；海外可直连。</p>
          <div className="divide-y divide-[var(--color-line)]">
            {providers.length === 0 && <p className="py-3 text-xs text-[var(--color-muted)]">未配置。导入时将按行拆分列表。</p>}
            {providers.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 py-2.5 text-[13px]">
                <span className="font-medium">{p.label}</span>
                <Badge>{p.kind === "anthropic" ? "Anthropic" : "OpenAI 兼容"}</Badge>
                <span className="font-mono text-[11px] text-[var(--color-muted)]">{p.model}</span>
                {p.isDefault ? <Badge tone="ok">默认</Badge> : null}
                {!p.hasKey && <Badge tone="danger">缺少 Key</Badge>}
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => act("test", p.id)}>测试</Button>
                  {!p.isDefault && <Button size="sm" variant="ghost" onClick={() => act("default", p.id)}>设为默认</Button>}
                  <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>编辑</Button>
                  <Button size="sm" variant="ghost" onClick={() => act("delete", p.id)}><Trash2 /></Button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-muted)]">用量：{usage.calls} 次调用 · 输入 {usage.input.toLocaleString()} / 输出 {usage.output.toLocaleString()} tokens</p>
        </CardContent></Card>
      </section>

      <CaptureSettings base={base} />

      <section className="mt-6">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Activity className="size-4" /> Agent 会话</h2>
        <Card><CardContent className="p-4">
          <div className="divide-y divide-[var(--color-line)]">
            {sessions.length === 0 && <p className="py-3 text-xs text-[var(--color-muted)]">还没有 agent 连接过。</p>}
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-2 py-2 text-[12.5px]">
                <span className="size-1.5 rounded-full bg-[var(--color-ok)]" />
                <span className="font-medium">{s.agentName}</span>
                <Badge>{s.agentType}</Badge>
                <span className="truncate text-[11px] text-[var(--color-muted)]">{s.summary}</span>
                <span className="ml-auto text-[11px] text-[var(--color-muted)]">{relTime(s.lastSeenAt)}</span>
              </div>
            ))}
          </div>
        </CardContent></Card>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        <Card><CardContent className="p-4">
          <p className="text-sm font-medium">账号</p>
          <p className="mt-1 text-[12px] text-[var(--color-muted)]">{user.name} · {user.email}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium"><Download className="size-4" /> 导出数据</p>
          <p className="mt-1 text-[12px] text-[var(--color-muted)]">导出全部项目与档案为 JSON，便于备份。</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => window.open("/api/ui/export", "_blank")}>导出</Button>
        </CardContent></Card>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "编辑模型" : "添加模型"}</DialogTitle><DialogDescription>快照常用配置，可填中转站地址。</DialogDescription></DialogHeader>
          {!form.id && (
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => <button key={p.label} onClick={() => startNew(p)} className="rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px] hover:bg-[var(--color-brand-soft)]">{p.label}</button>)}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">名称</span><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">协议</span>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">
                <option value="openai_compat">OpenAI 兼容</option><option value="anthropic">Anthropic</option>
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">Base URL</span><Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.deepseek.com" className="font-mono" /></label>
            <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">模型</span><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="deepseek-chat" className="font-mono" /></label>
            <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">API Key {form.id && <span className="text-[11px]">（留空则不修改）</span>}</span><Input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} /></label>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button onClick={save}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
