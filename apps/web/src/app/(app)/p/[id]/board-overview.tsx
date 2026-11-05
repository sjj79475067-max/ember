"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AlertTriangle, CheckCircle2, Clock, Hourglass, Link2, Flag, Send, ShieldAlert, GitPullRequestArrow, CircleDashed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { callTool } from "@/lib/ui-api";
import { fmtDate, relTime } from "@/lib/utils";
import { KIND_LABEL, HEALTH_LABEL, GATE_LABEL, MS_STATUS_LABEL } from "@/lib/labels";
import { toast } from "sonner";
import type { themeColors as TC } from "@/components/viz/echart";

const EChart = dynamic(() => import("@/components/viz/echart").then((m) => m.EChart), { ssr: false, loading: () => <div className="h-full animate-pulse rounded-lg bg-[var(--color-line)]/40" /> });

type Brief = { id: string; title: string; status: string; kind: string; priority: string; dueAt: number | null; claimedBy: string | null; waitingOn: string[]; leadTimeDays: number | null; overdue: boolean; needsReview: boolean };
type Phase = {
  id: string; name: string; kind: string; goal: string; status: string; position: number; startAt: number | null; dueAt: number | null; daysLeft: number | null;
  gate: { decision: string; note: string; decidedAt: number | null; decidedBy: string; proposal: string };
  total: number; done: number; mustTotal: number; mustDone: number; ready: boolean; gaps: Brief[]; leadRisk: Array<{ id: string; title: string; leadTimeDays: number | null }>;
};
export type Board = {
  project: { id: string; key: string; name: string; kind: string; dueAt: number | null; template: string };
  totals: { total: number; done: number; open: number };
  current: { id: string; name: string } | null;
  release: { id: string; name: string; mustTotal: number; mustDone: number; ready: boolean; gaps: Brief[]; daysLeft: number | null; leadRisk: Array<{ id: string; title: string; leadTimeDays: number | null }> } | null;
  phases: Phase[];
  byKind: Array<{ kind: string; label: string; total: number; done: number; blocked: number; overdue: number }>;
  funnel: { proposed: number; accepted: number; in_progress: number; done: number; dropped: number; untriaged: Array<{ id: string; code: string; title: string }>; dropUnconfirmed: Array<{ id: string; code: string; title: string; reason: string }>; staleProposed: Array<{ id: string; code: string; title: string }> };
  attention: { overdue: Brief[]; blocked: Array<Brief & { reason: string }>; waiting: Brief[]; violations: Array<{ blockerId: string; blockedId: string; blockerTitle: string; blockedTitle: string }>; needsReview: Brief[]; unclaimedDoing: Brief[] };
  trend: Array<{ day: string; done: number; created: number }>;
  health: { value: "on_track" | "at_risk" | "off_track"; source: string; suggested: string; reasons: string[]; lastUpdate: null | { id: string; health: string; at: number; author: string; progress: string; blockers: string; next: string }; updateMissing: boolean; updateEveryDays: number };
  unphased: number;
  templates?: Array<{ key: string; name: string; description: string; phases: string[]; items: number; compliance: string[] }>;
};

function colors(): ReturnType<typeof TC> {
  if (typeof window === "undefined") return { fg: "#222", muted: "#888", line: "#e5e5e5", brand: "#d9622b", ok: "#2f9e6e", warn: "#d99a1e", danger: "#d64545", card: "#fff" };
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { fg: v("--color-fg", "#222"), muted: v("--color-muted", "#888"), line: v("--color-line", "#e5e5e5"), brand: v("--color-brand", "#d9622b"), ok: v("--color-ok", "#2f9e6e"), warn: v("--color-warn", "#d99a1e"), danger: v("--color-danger", "#d64545"), card: v("--color-card", "#fff") };
}

export function BoardOverview({ board, onOpenTab }: { board: Board; onOpenTab: (tab: string) => void }) {
  const router = useRouter();
  const [gateFor, setGateFor] = useState<Phase | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [attnTab, setAttnTab] = useState<"waiting" | "blocked" | "overdue" | "review" | "viol">("waiting");
  const c = useMemo(colors, []);
  const noStructure = board.phases.length === 0;

  if (noStructure) return <EmptyStructure board={board} onDone={() => router.refresh()} />;

  const h = HEALTH_LABEL[board.health.value];
  const rel = board.release;
  const pct = board.totals.total ? Math.round((board.totals.done / board.totals.total) * 100) : 0;

  const ringOption = rel ? {
    series: [{
      type: "gauge", startAngle: 90, endAngle: -270, min: 0, max: Math.max(1, rel.mustTotal), radius: "92%",
      pointer: { show: false }, progress: { show: true, roundCap: true, width: 12, itemStyle: { color: rel.ready ? c.ok : c.brand } },
      axisLine: { lineStyle: { width: 12, color: [[1, c.line]] } }, splitLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false },
      title: { show: false },
      detail: { valueAnimation: true, offsetCenter: [0, 0], fontSize: 20, fontWeight: 600, color: c.fg, formatter: () => `${rel.mustDone}/${rel.mustTotal}` },
      data: [{ value: rel.mustDone }],
    }],
  } : null;

  const attn = {
    waiting: board.attention.waiting, blocked: board.attention.blocked, overdue: board.attention.overdue, review: board.attention.needsReview,
    viol: board.attention.violations,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 第一排：健康 · 发版就绪 · 当前阶段 */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-[var(--color-muted)]">项目健康</p>
              <Button size="sm" variant="ghost" onClick={() => setUpdateOpen(true)}><Send /> 发进展</Button>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${h.tone === "ok" ? "bg-[var(--color-ok)]" : h.tone === "warn" ? "bg-[var(--color-warn)]" : "bg-[var(--color-danger)]"}`} />
              <span className="text-lg font-semibold">{h.label}</span>
              {board.health.source === "system" && <Badge>系统判断</Badge>}
              {board.health.updateMissing && <Badge tone="warn">进展更新缺失</Badge>}
            </div>
            {board.health.reasons.length > 0 && <p className="mt-1.5 text-[12px] leading-5 text-[var(--color-muted)]">{board.health.reasons.join("；")}</p>}
            {board.health.lastUpdate && (
              <p className="mt-2 line-clamp-2 text-[12px] leading-5">
                <span className="text-[var(--color-muted)]">{relTime(board.health.lastUpdate.at)} · {board.health.lastUpdate.author}：</span>{board.health.lastUpdate.progress || board.health.lastUpdate.next}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            {ringOption ? <div className="size-24 shrink-0 sm:size-28"><EChart option={ringOption} height={112} /></div> : <CircleDashed className="size-16 text-[var(--color-line)]" />}
            <div className="min-w-0">
              <p className="text-xs text-[var(--color-muted)]">能不能发「{rel?.name ?? "—"}」</p>
              {rel ? (rel.ready
                ? <p className="mt-1 flex items-center gap-1 text-base font-semibold text-[var(--color-ok)]"><CheckCircle2 className="size-4" />必过项已齐，可评审放行</p>
                : <p className="mt-1 text-base font-semibold">还差 <span className="text-[var(--color-brand)]">{rel.mustTotal - rel.mustDone}</span> 项</p>) : <p className="mt-1 text-sm">没有发布阶段</p>}
              {rel?.daysLeft != null && <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">{rel.daysLeft >= 0 ? `距截止 ${rel.daysLeft} 天` : `已超期 ${-rel.daysLeft} 天`}</p>}
              {rel && rel.leadRisk.length > 0 && <p className="mt-1 flex items-center gap-1 text-[12px] text-[var(--color-danger)]"><Hourglass className="size-3.5" />{rel.leadRisk.length} 项办理周期来不及</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[var(--color-muted)]">现在在哪</p>
            <p className="mt-1 text-lg font-semibold">{board.current?.name ?? "全部阶段已结束"}</p>
            <div className="mt-2 mb-1 flex justify-between text-[11px] text-[var(--color-muted)]"><span>总进度 {board.totals.done}/{board.totals.total}</span><span>{pct}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]"><div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${pct}%` }} /></div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {board.attention.overdue.length > 0 && <Badge tone="danger">{board.attention.overdue.length} 逾期</Badge>}
              {board.attention.blocked.length > 0 && <Badge tone="danger">{board.attention.blocked.length} 阻塞</Badge>}
              {board.attention.waiting.length > 0 && <Badge tone="warn">{board.attention.waiting.length} 等前置</Badge>}
              {board.unphased > 0 && <button onClick={() => onOpenTab("checklist")}><Badge>{board.unphased} 未分阶段</Badge></button>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 里程碑轨道 */}
      <MilestoneRail phases={board.phases} currentId={board.current?.id} onGate={setGateFor} />

      {/* 第二排：还差什么 · 卡在哪 */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Flag className="size-4 text-[var(--color-brand)]" />发「{rel?.name ?? "—"}」还差什么</h3>
              <button onClick={() => onOpenTab("plan")} className="text-[12px] text-[var(--color-brand)] hover:underline">看依赖图</button>
            </div>
            {!rel || rel.gaps.length === 0
              ? <p className="rounded-lg bg-[var(--color-ok)]/10 p-3 text-[13px]">{rel ? "必过项都完成了。到阶段卡片上点「评审」决定是否放行。" : "还没有设置发布阶段。"}</p>
              : <ul className="flex flex-col divide-y divide-[var(--color-line)]">
                  {rel.gaps.map((g) => <GapRow key={g.id} g={g} />)}
                </ul>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><ShieldAlert className="size-4 text-[var(--color-danger)]" />卡在哪</h3>
            <div className="mb-2 flex flex-wrap gap-1 text-xs">
              {([["waiting", "等前置", attn.waiting.length], ["blocked", "阻塞", attn.blocked.length], ["overdue", "逾期", attn.overdue.length], ["review", "待核实", attn.review.length], ["viol", "排不开", attn.viol.length]] as const).map(([k, l, n]) => (
                <button key={k} onClick={() => setAttnTab(k)} className={`rounded-md px-2 py-1 ${attnTab === k ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]" : "text-[var(--color-muted)] hover:bg-[var(--color-line)]/40"}`}>{l} {n}</button>
              ))}
            </div>
            {attnTab === "viol"
              ? (attn.viol.length ? <ul className="flex flex-col gap-1.5">{attn.viol.map((v, i) => <li key={i} className="rounded-lg border border-[var(--color-danger)]/30 p-2 text-[12px]"><b>{v.blockerTitle}</b> 预计完成晚于 <b>{v.blockedTitle}</b> 的计划开始，排期需要调整</li>)}</ul> : <Empty text="依赖排期没有冲突" />)
              : (() => {
                  const rows = (attnTab === "waiting" ? attn.waiting : attnTab === "blocked" ? attn.blocked : attnTab === "overdue" ? attn.overdue : attn.review) as Array<Brief & { reason?: string }>;
                  return rows.length ? <ul className="flex flex-col divide-y divide-[var(--color-line)]">{rows.slice(0, 12).map((g) => <GapRow key={g.id} g={g} extra={g.reason} />)}</ul> : <Empty text="没有" />;
                })()}
          </CardContent>
        </Card>
      </div>

      {/* 第三排：按类型进度 · 需求漏斗 · 30 天趋势 */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold">按类型看进度</h3>
            {board.byKind.length === 0 ? <Empty text="还没有事项" /> : (
              <div className="flex flex-col gap-2.5">
                {board.byKind.map((k) => {
                  const p = k.total ? Math.round((k.done / k.total) * 100) : 0;
                  return (
                    <div key={k.kind}>
                      <div className="mb-1 flex items-center justify-between text-[12px]">
                        <span className="font-medium">{k.label}</span>
                        <span className="text-[var(--color-muted)]">{k.done}/{k.total}{k.blocked ? ` · 阻塞 ${k.blocked}` : ""}{k.overdue ? ` · 逾期 ${k.overdue}` : ""}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]"><div className={`h-full rounded-full ${k.overdue || k.blocked ? "bg-[var(--color-warn)]" : "bg-[var(--color-brand)]"}`} style={{ width: `${p}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">需求有没有着落</h3>
              <button onClick={() => onOpenTab("requirements")} className="text-[12px] text-[var(--color-brand)] hover:underline">全部需求</button>
            </div>
            <ReqFunnel f={board.funnel} />
            {(board.funnel.untriaged.length > 0 || board.funnel.dropUnconfirmed.length > 0) && (
              <div className="mt-2 flex flex-col gap-1 text-[12px]">
                {board.funnel.dropUnconfirmed.map((r) => <p key={r.id} className="text-[var(--color-warn)]">待你确认放弃：{r.code} {r.title}</p>)}
                {board.funnel.untriaged.slice(0, 4).map((r) => <p key={r.id} className="text-[var(--color-danger)]">未拆解：{r.code} {r.title}</p>)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="mb-1 text-sm font-semibold">近 30 天</h3>
            <EChart height={170} option={{
              grid: { left: 24, right: 8, top: 24, bottom: 20 },
              legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 6, textStyle: { color: c.muted, fontSize: 11 } },
              tooltip: { trigger: "axis" },
              xAxis: { type: "category", data: board.trend.map((t) => t.day), axisLabel: { color: c.muted, fontSize: 10, interval: 6 }, axisLine: { lineStyle: { color: c.line } }, axisTick: { show: false } },
              yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: c.line } }, axisLabel: { color: c.muted, fontSize: 10 } },
              series: [
                { name: "完成", type: "bar", data: board.trend.map((t) => t.done), itemStyle: { color: c.ok, borderRadius: [2, 2, 0, 0] }, barMaxWidth: 8 },
                { name: "新增", type: "line", smooth: true, symbol: "none", data: board.trend.map((t) => t.created), lineStyle: { color: c.brand, width: 1.5 } },
              ],
            }} />
          </CardContent>
        </Card>
      </div>

      {gateFor && <GateDialog phase={gateFor} onClose={() => setGateFor(null)} onDone={() => { setGateFor(null); router.refresh(); }} />}
      <UpdateDialog open={updateOpen} onOpenChange={setUpdateOpen} board={board} onDone={() => { setUpdateOpen(false); router.refresh(); }} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-4 text-center text-[12px] text-[var(--color-muted)]">{text}</p>;
}

function GapRow({ g, extra }: { g: Brief; extra?: string }) {
  return (
    <li className="flex items-start gap-2 py-2">
      <Badge className="mt-0.5 shrink-0">{KIND_LABEL[g.kind] ?? g.kind}</Badge>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] ${g.overdue ? "text-[var(--color-danger)]" : ""}`}>{g.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--color-muted)]">
          <span>{g.status === "doing" ? "进行中" : g.status === "blocked" ? "阻塞" : g.status === "done" ? "待核实" : "未开始"}</span>
          {g.claimedBy && <span>· 有人在做</span>}
          {g.dueAt && <span className={g.overdue ? "text-[var(--color-danger)]" : ""}>· {fmtDate(g.dueAt)}{g.overdue ? " 已逾期" : ""}</span>}
          {g.leadTimeDays ? <span>· 通常要 {g.leadTimeDays} 天</span> : null}
          {g.waitingOn.length > 0 && <span className="text-[var(--color-warn)]"><Link2 className="inline size-3" /> 等：{g.waitingOn.join("、")}</span>}
          {extra && <span className="text-[var(--color-danger)]">· {extra}</span>}
        </div>
      </div>
    </li>
  );
}

function ReqFunnel({ f }: { f: Board["funnel"] }) {
  const rows = [
    { k: "提出", n: f.proposed, cls: "bg-[var(--color-line)]" },
    { k: "确认要做", n: f.accepted, cls: "bg-[var(--color-brand)]/40" },
    { k: "进行中", n: f.in_progress, cls: "bg-[var(--color-brand)]/70" },
    { k: "已完成", n: f.done, cls: "bg-[var(--color-ok)]" },
    { k: "已放弃", n: f.dropped, cls: "bg-[var(--color-muted)]/50" },
  ];
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) return <Empty text="还没有需求。把用户提的每个要求记成需求，才能保证有始有终。" />;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-3 overflow-hidden rounded-full">{rows.map((r) => r.n ? <div key={r.k} className={r.cls} style={{ width: `${(r.n / total) * 100}%` }} title={`${r.k} ${r.n}`} /> : null)}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-muted)]">{rows.map((r) => <span key={r.k} className="inline-flex items-center gap-1"><span className={`size-2 rounded-sm ${r.cls}`} />{r.k} {r.n}</span>)}</div>
    </div>
  );
}

function MilestoneRail({ phases, currentId, onGate }: { phases: Phase[]; currentId?: string; onGate: (p: Phase) => void }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-2">
        {phases.map((p, i) => {
          const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
          const isCur = p.id === currentId;
          const late = p.daysLeft != null && p.daysLeft < 0 && !["done", "cancelled"].includes(p.status);
          return (
            <div key={p.id} className="flex items-stretch">
              <div className={`w-56 rounded-xl border p-3 transition-shadow ${isCur ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]/40 shadow-sm" : "border-[var(--color-line)] bg-[var(--color-card)]"} ${p.status === "cancelled" ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between gap-1">
                  <p className="truncate text-sm font-semibold">{p.kind === "release" && <Flag className="mr-1 inline size-3.5 text-[var(--color-brand)]" />}{p.name}</p>
                  <Badge tone={p.status === "done" ? "ok" : p.status === "active" ? "brand" : "default"}>{MS_STATUS_LABEL[p.status]}</Badge>
                </div>
                {p.goal && <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-muted)]">{p.goal}</p>}
                <div className="mt-2 mb-1 flex justify-between text-[11px] text-[var(--color-muted)]"><span>{p.done}/{p.total}</span><span>{pct}%</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]"><div className={`h-full rounded-full ${p.status === "done" ? "bg-[var(--color-ok)]" : "bg-[var(--color-brand)]"}`} style={{ width: `${pct}%` }} /></div>
                <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                  {p.mustTotal > 0 && <span className={p.ready ? "text-[var(--color-ok)]" : "text-[var(--color-muted)]"}>必过 {p.mustDone}/{p.mustTotal}</span>}
                  {p.dueAt && <span className={late ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"}>· <Clock className="inline size-3" /> {fmtDate(p.dueAt)}{late ? " 超期" : p.daysLeft != null && p.status !== "done" ? ` 剩${p.daysLeft}天` : ""}</span>}
                  {p.leadRisk.length > 0 && <span className="text-[var(--color-danger)]">· <Hourglass className="inline size-3" />周期不够</span>}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-[var(--color-muted)]">{GATE_LABEL[p.gate.decision]}{p.gate.proposal && p.gate.decision === "pending" ? " · 有建议" : ""}</span>
                  {p.status !== "cancelled" && <button onClick={() => onGate(p)} className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-brand)] hover:bg-[var(--color-brand-soft)]">评审</button>}
                </div>
              </div>
              {i < phases.length - 1 && <div className="flex w-4 items-center"><div className="h-px w-full bg-[var(--color-line)]" /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GateDialog({ phase, onClose, onDone }: { phase: Phase; onClose: () => void; onDone: () => void }) {
  const [decision, setDecision] = useState<"go" | "hold" | "kill">(phase.ready ? "go" : "hold");
  const [note, setNote] = useState(phase.gate.note || "");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (decision === "go" && !phase.ready && !note.trim()) return toast.error("必过项没有完成就放行，请写明理由（例如：备案在办、先内测）");
    setBusy(true);
    const r = await fetch("/api/ui/board", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "gate", id: phase.id, decision, note }) }).then((x) => x.json());
    setBusy(false);
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("评审结论已记录，并存入「决定」"); onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>阶段评审：{phase.name}</DialogTitle>
          <DialogDescription>阶段门是决策会：放行、暂缓返工，或终止。结论会写入「决定」，可追溯。</DialogDescription>
        </DialogHeader>
        <div className={`rounded-lg p-3 text-[13px] ${phase.ready ? "bg-[var(--color-ok)]/10" : "bg-[var(--color-warn)]/10"}`}>
          {phase.ready ? <p className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-[var(--color-ok)]" />必过项 {phase.mustDone}/{phase.mustTotal} 全部完成</p>
            : <>
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="size-4 text-[var(--color-warn)]" />还有 {phase.gaps.length} 个必过项未完成</p>
                <ul className="mt-1.5 list-disc pl-5 text-[12px] leading-5">{phase.gaps.slice(0, 8).map((g) => <li key={g.id}>{g.title}{g.waitingOn.length ? `（等：${g.waitingOn.join("、")}）` : ""}</li>)}</ul>
              </>}
        </div>
        {phase.gate.proposal && <div className="rounded-lg border border-[var(--color-line)] p-3 text-[12px]"><p className="mb-1 flex items-center gap-1 font-medium"><GitPullRequestArrow className="size-3.5" />agent 的建议</p><p className="whitespace-pre-wrap text-[var(--color-muted)]">{phase.gate.proposal}</p></div>}
        <div className="flex gap-2">
          {([["go", "放行"], ["hold", "暂缓/返工"], ["kill", "终止"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setDecision(k)} className={`flex-1 rounded-lg border px-3 py-2 text-sm ${decision === k ? (k === "go" ? "border-[var(--color-ok)] bg-[var(--color-ok)]/10 font-medium" : k === "kill" ? "border-[var(--color-danger)] bg-[var(--color-danger)]/10 font-medium" : "border-[var(--color-warn)] bg-[var(--color-warn)]/10 font-medium") : "border-[var(--color-line)]"}`}>{l}</button>
          ))}
        </div>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="结论说明：依据、遗留项、谁跟进" />
        <DialogFooter><Button variant="ghost" onClick={onClose}>取消</Button><Button onClick={submit} disabled={busy}>记录结论</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UpdateDialog({ open, onOpenChange, board, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; board: Board; onDone: () => void }) {
  const [health, setHealth] = useState<string>(board.health.suggested);
  const [progress, setProgress] = useState("");
  const [blockers, setBlockers] = useState(board.attention.blocked.map((b) => `${b.title}：${b.reason}`).join("\n"));
  const [next, setNext] = useState("");
  async function submit() {
    if (!progress.trim() && !next.trim()) return toast.error("至少写一句进展或下一步");
    const r = await callTool("project_update_post", { project: board.project.id, health, progress_md: progress, blockers_md: blockers, next_md: next });
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("进展已发布"); onDone();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>发项目进展</DialogTitle><DialogDescription>三句话：做了什么、卡在哪、下一步。健康度以这次更新为准。系统建议：{HEALTH_LABEL[board.health.suggested]?.label}{board.health.reasons.length ? `（${board.health.reasons.join("；")}）` : ""}</DialogDescription></DialogHeader>
        <div className="flex gap-2">{(["on_track", "at_risk", "off_track"] as const).map((k) => <button key={k} onClick={() => setHealth(k)} className={`flex-1 rounded-lg border px-2 py-1.5 text-sm ${health === k ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] font-medium" : "border-[var(--color-line)]"}`}>{HEALTH_LABEL[k].label}</button>)}</div>
        <Textarea rows={2} value={progress} onChange={(e) => setProgress(e.target.value)} placeholder="进展：这段时间完成了什么" />
        <Textarea rows={2} value={blockers} onChange={(e) => setBlockers(e.target.value)} placeholder="阻塞：卡在哪、等谁" />
        <Textarea rows={2} value={next} onChange={(e) => setNext(e.target.value)} placeholder="下一步：接下来要做的三件事" />
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={submit}>发布</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyStructure({ board, onDone }: { board: Board; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function apply(key: string) {
    setBusy(key);
    const r = await callTool("template_apply", { project: board.project.id, template: key });
    setBusy(null);
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("已套用模板"); onDone();
  }
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-line)] p-6">
      <h3 className="text-base font-semibold">这个项目还没有阶段</h3>
      <p className="mt-1 text-sm text-[var(--color-muted)]">选一个模板，自动建好阶段、必过项和配套事项（备案、软著、账号、隐私协议…）以及它们之间的依赖。已有事项不受影响，之后可以随意增删。</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {(board.templates ?? []).map((t) => (
          <button key={t.key} onClick={() => apply(t.key)} disabled={busy !== null} className="rounded-xl border border-[var(--color-line)] p-3 text-left transition-colors hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-soft)]/30">
            <p className="text-sm font-medium">{t.name}{busy === t.key ? " · 应用中…" : ""}</p>
            <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">{t.description}</p>
            <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">阶段：{t.phases.join(" → ")} · {t.items} 个预置事项</p>
          </button>
        ))}
      </div>
    </div>
  );
}