"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, KeyRound, Trash2, Plug, Terminal, Globe, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/utils";
import { toast } from "sonner";

type T = { id: string; name: string; agentType: string; prefix: string; lastUsedAt: number | null; revokedAt: number | null; createdAt: number };

export function ConnectClient({ base, user, tokens }: { base: string; user: string; tokens: T[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [agentType, setAgentType] = useState("claude-code");
  const [fresh, setFresh] = useState<{ id: string; token: string; name: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [tab, setTab] = useState<"mcp" | "http">("mcp");

  const token = fresh?.token ?? "<在此生成 TOKEN>";
  const mcpUrl = `${base}/api/mcp`;

  async function mint() {
    if (!name.trim()) return toast.error("给这个 agent 起个名字");
    const r = await fetch("/api/ui/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, agent_type: agentType }) }).then((x) => x.json());
    if (!r.ok) return toast.error(r.error ?? "失败");
    setFresh({ id: r.id, token: r.token, name });
    setName("");
    router.refresh();
  }
  async function revoke(id: string) {
    await fetch(`/api/ui/tokens?id=${id}`, { method: "DELETE" });
    toast.success("已吊销"); router.refresh();
  }
  async function testConnection() {
    if (!fresh) return toast.error("先生成 Token 再测试");
    setTesting("running");
    try {
      const res = await fetch(`${base}/api/v1/onboard`, { headers: { authorization: `Bearer ${fresh.token}` } });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(`连接成功：${data.data.projects.length} 个项目，${data.data.reminders_unread.total} 条提醒`);
      setTesting("ok");
    } catch (e) {
      toast.error(`连接失败：${(e as Error).message}`); setTesting("fail");
    }
  }

  const cards = [
    { id: "claude-code", title: "Claude Code", icon: <Terminal className="size-4" />, cmd: `claude mcp add --transport http ember ${mcpUrl} --header "Authorization: Bearer ${token}"`, note: "在终端执行；之后新开 Claude Code 会话自动带 ember 工具。" },
    { id: "codex", title: "Codex CLI / OpenAI", icon: <Terminal className="size-4" />, code: `# ~/.codex/config.toml\n[mcp_servers.ember]\nurl = "${mcpUrl}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }`, note: "写入后重启 codex。" },
    { id: "cursor", title: "Cursor / Cline / Continue", icon: <Plug className="size-4" />, code: `// .cursor/mcp.json 或 Cline 的 mcp_settings.json\n{\n  "mcpServers": {\n    "ember": {\n      "url": "${mcpUrl}",\n      "headers": { "Authorization": "Bearer ${token}" }\n    }\n  }\n}`, note: "Cline 需加 \"type\": \"streamableHttp\"。" },
    { id: "http", title: "任何支持 HTTP 的 Agent（豆包/龙虾/hermes 等）", icon: <Globe className="size-4" />, code: `请先阅读 ${base}/llms.txt 了解我能调用的能力，然后：\n1) curl -H "Authorization: Bearer ${token}" "${base}/api/v1/onboard" 获取当前工作上下文\n2) 用 POST ${base}/api/v1/call/<工具名> 调用工具\n3) 所有写操作遵循 onboard 返回的 how_to_work`, note: "把这段直接发给 agent 即可。" },
    { id: "stdio", title: "不支持远程 MCP 的终端（stdio 桥）", icon: <Terminal className="size-4" />, cmd: `npx ember-mcp --url ${base} --token ${token}`, note: "作为 stdio MCP server 配置到本地 agent。" },
  ];

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">接入 Agent</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">生成 Token，把配置粘贴给任意 agent。它一进来就知道自己是谁、有哪些事没做完、资料在哪。</p>
      </header>

      <Card className="mb-5">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-1 flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">Token 名称（agent 名）</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：Claude Code - Mac mini" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">类型</span>
              <select value={agentType} onChange={(e) => setAgentType(e.target.value)} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">
                <option value="claude-code">Claude Code</option><option value="codex">Codex</option><option value="cursor">Cursor</option><option value="cline">Cline</option><option value="doubao">豆包工作</option><option value="hermes">Hermes / 龙虾</option><option value="generic">其他</option>
              </select>
            </label>
            <Button onClick={mint}><KeyRound /> 生成 Token</Button>
            <Button variant="outline" onClick={testConnection} disabled={testing === "running"}><Zap /> {testing === "running" ? "测试中…" : "测试连接"}</Button>
          </div>
          {fresh && (
            <div className="mt-3 rounded-lg border border-[var(--color-ok)]/30 bg-[var(--color-ok)]/8 p-3">
              <p className="text-xs font-medium text-[var(--color-ok)]">已生成（只显示一次，请立即复制保存）</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-[var(--color-card)] px-2 py-1.5 font-mono text-[12px]">{fresh.token}</code>
                <CopyBtn text={fresh.token} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mb-3 flex gap-1 rounded-lg bg-[var(--color-line)]/40 p-0.5 text-xs w-fit">
        <button onClick={() => setTab("mcp")} className={`rounded-md px-3 py-1.5 ${tab === "mcp" ? "bg-[var(--color-card)] font-medium shadow-sm" : "text-[var(--color-muted)]"}`}>MCP（推荐）</button>
        <button onClick={() => setTab("http")} className={`rounded-md px-3 py-1.5 ${tab === "http" ? "bg-[var(--color-card)] font-medium shadow-sm" : "text-[var(--color-muted)]"}`}>HTTP 兜底</button>
      </div>

      <div className="flex flex-col gap-3">
        {cards.filter((c) => (tab === "mcp" ? c.id !== "http" : c.id === "http" || c.id === "stdio")).map((c) => (
          <Card key={c.id}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2"><span className="text-[var(--color-brand)]">{c.icon}</span><p className="text-sm font-medium">{c.title}</p></div>
              <div className="mt-2 flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-[oklch(0.22_0.01_80)] p-3 text-[12px] leading-5 text-[oklch(0.92_0.01_90)]">{c.cmd ?? c.code}</pre>
                <CopyBtn text={c.cmd ?? c.code ?? ""} />
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">{c.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-5">
        <CardContent className="p-4">
          <p className="mb-2 text-sm font-medium">已发放的 Token</p>
          <div className="divide-y divide-[var(--color-line)]">
            {tokens.length === 0 && <p className="py-3 text-xs text-[var(--color-muted)]">还没有 Token。</p>}
            {tokens.map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-2 text-[13px]">
                <span className="font-medium">{t.name}</span>
                <Badge>{t.agentType}</Badge>
                <code className="font-mono text-[11px] text-[var(--color-muted)]">{t.prefix}…</code>
                {t.revokedAt ? <Badge tone="danger">已吊销</Badge> : t.lastUsedAt ? <Badge tone="ok">最近使用 {fmtDate(t.lastUsedAt, true)}</Badge> : <Badge>未使用</Badge>}
                {!t.revokedAt && <button onClick={() => revoke(t.id)} className="ml-auto rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-line)]/50" title="吊销"><Trash2 className="size-3.5" /></button>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-5 border-dashed">
        <CardContent className="p-4 text-[12.5px] leading-6 text-[var(--color-muted)]">
          <p className="mb-1 font-medium text-[var(--color-fg)]">怎么让所有 agent 都知道用这个网页？</p>
          <p>1. 给每个 agent 生成一个 Token（按名字区分，便于追溯）。</p>
          <p>2. 支持的走 MCP 配置卡，粘贴即用；不支持的把「HTTP 兜底」那段话发给它，它会自己读 <code>/llms.txt</code> 并调用 <code>/api/v1/onboard</code>。</p>
          <p>3. 每次 agent 连接，中心会推给它未读提醒与必读条例——这就是你说的「反向管理」。</p>
          <p>4. 在项目目录放一个 AGENTS.md 指向 <code>{`${base}/llms.txt`}</code>，新开的会话也能第一时间发现。</p>
        </CardContent>
      </Card>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="outline" size="icon" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }} title="复制">
      {done ? <Check className="text-[var(--color-ok)]" /> : <Copy />}
    </Button>
  );
}
