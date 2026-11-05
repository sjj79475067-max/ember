"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Radio, Clock, Unlock, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { relTime } from "@/lib/utils";
import { toast } from "sonner";

type Data = {
  agents: Array<{ name: string; sessions: number; lastSeen: number; done: number; claimed: number; active: number; types: string[] }>;
  active_claims: Array<{ id: string; title: string; project: string; projectId: string; status: string; claimedBy: string; claimedAt: number | null; stale: boolean }>;
  staleCount: number;
  totals: { agents: number; sessionsActive24h: number; done7d: number; failedVerifications: number };
  recentEvents: Array<{ at: number; actor: string; actorType: string; action: string; title: string; from: string; to: string; evidence: string }>;
};

const ACTION: Record<string, string> = { create: "创建", update: "更新", claim: "认领", release: "释放", complete: "完成", change: "变更", block: "阻塞" };

export function MatrixClient({ initial }: { initial: Data }) {
  const router = useRouter();
  const [data, setData] = useState(initial);

  async function release(id?: string) {
    const r = await fetch("/api/ui/oversight", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(id ? { action: "release", item_id: id } : { action: "release_stale" }) }).then((x) => x.json());
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success(id ? "已释放认领" : `已释放 ${r.released} 个超时认领`);
    const fresh = await fetch("/api/ui/oversight").then((x) => x.json());
    if (fresh.ok) setData(fresh.data);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">智能体</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">谁在做事、做到哪、有没有东西卡在别人手里。</p>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Bot />} label="接入过的 Agent" value={data.totals.agents} />
        <Stat icon={<Radio />} label="24 小时内活跃会话" value={data.totals.sessionsActive24h} tone="ok" />
        <Stat icon={<CheckCircle2 />} label="近 7 天完成" value={data.totals.done7d} />
        <Stat icon={<Clock />} label="超时未释放认领" value={data.staleCount} tone={data.staleCount ? "danger" : "default"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h2 className="mb-2.5 text-sm font-semibold text-[var(--color-muted)]">Agent 活跃度</h2>
          <Card><CardContent className="divide-y divide-[var(--color-line)] p-0">
            {data.agents.length === 0 && <p className="p-5 text-sm text-[var(--color-muted)]">还没有 agent 连接过。去「接入 Agent」生成 Token。</p>}
            {data.agents.map((a) => (
              <div key={a.name} className="flex items-center gap-3 p-3.5">
                <span className={`size-2 rounded-full ${a.active ? "bg-[var(--color-ok)]" : "bg-[var(--color-line)]"}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <p className="text-[11px] text-[var(--color-muted)]">{a.types.join(" / ")} · 最近 {relTime(a.lastSeen)}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Badge tone="ok">完成 {a.done}</Badge>
                  <Badge>认领 {a.claimed}</Badge>
                  <Badge>{a.sessions} 会话</Badge>
                </div>
              </div>
            ))}
          </CardContent></Card>
        </section>

        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-muted)]">当前认领</h2>
            {data.staleCount > 0 && <Button size="sm" variant="outline" onClick={() => release()}><Unlock /> 释放全部超时</Button>}
          </div>
          <Card><CardContent className="divide-y divide-[var(--color-line)] p-0">
            {data.active_claims.length === 0 && <p className="p-5 text-sm text-[var(--color-muted)]">当前没有认领中的任务。</p>}
            {data.active_claims.map((c) => (
              <div key={c.id} className="flex items-start gap-2 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{c.title}</p>
                  <p className="text-[11px] text-[var(--color-muted)]">{c.project} · {c.claimedBy} · {relTime(c.claimedAt)}认领</p>
                </div>
                {c.stale && <Badge tone="danger">已超时</Badge>}
                <button onClick={() => release(c.id)} className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-line)]/60" title="释放"><Unlock className="size-3.5" /></button>
              </div>
            ))}
          </CardContent></Card>
        </section>
      </div>

      <section className="mt-6">
        <h2 className="mb-2.5 text-sm font-semibold text-[var(--color-muted)]">近 7 天操作流</h2>
        <div className="relative ml-2 border-l border-[var(--color-line)] pl-5">
          {data.recentEvents.length === 0 && <p className="py-6 text-sm text-[var(--color-muted)]">暂无记录。</p>}
          {data.recentEvents.map((e, i) => (
            <div key={i} className="relative pb-3">
              <span className={`absolute -left-[26px] top-1.5 size-2.5 rounded-full border-2 border-[var(--color-bg)] ${e.actorType === "agent" ? "bg-[var(--color-brand)]" : "bg-[var(--color-muted)]"}`} />
              <p className="text-[13px]"><span className="font-medium">{e.actor || e.actorType}</span> {ACTION[e.action] ?? e.action} <span className="font-medium">{e.title}</span></p>
              {e.evidence && <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-muted)]">{e.evidence}</p>}
              <p className="text-[11px] text-[var(--color-muted)]">{relTime(e.at)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ icon, label, value, tone = "default" }: { icon: React.ReactNode; label: string; value: number; tone?: "default" | "ok" | "danger" }) {
  const color = tone === "ok" ? "text-[var(--color-ok)]" : tone === "danger" ? "text-[var(--color-danger)]" : "";
  return <Card><CardContent className="flex items-center gap-3 p-4">
    <span className={`${color} opacity-90 [&_svg]:size-5`}>{icon}</span>
    <div><p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p><p className="text-[11px] text-[var(--color-muted)]">{label}</p></div>
  </CardContent></Card>;
}
