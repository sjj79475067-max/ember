"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, ShoppingCart, Handshake, Plane, CalendarDays, Plus, ChevronLeft, ChevronRight, Copy, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { callTool } from "@/lib/ui-api";
import { fmtDate } from "@/lib/utils";
import { toast } from "sonner";
import { PurchasesTab, DealsTab, TripsTab } from "./affairs-tabs";

export type AffairsData = {
  assets: Array<{ id: string; kind: string; name: string; identifier: string; authority: string; owner: string; projectId: string | null; validUntil: number | null; daysLeft: number | null; state: string; consequence: string; renewRule: string; secretRef: string; remindDays: string; notesMd: string; cost: number | null }>;
  purchases: Array<Record<string, any>>; deals: Array<Record<string, any>>; contacts: Array<Record<string, any>>; trips: Array<Record<string, any>>;
  events: Array<{ id: string; kind: string; title: string; start: number; end?: number; allDay: boolean; href: string; tone: string; note?: string }>;
  feeds: Array<{ id: string; name: string; prefix: string; lastUsedAt: number | null; createdAt: number }>;
  month: { y: number; m: number }; base: string; projects: Array<{ id: string; key: string; name: string }>;
};

const TABS = [
  { id: "calendar", label: "日历", icon: CalendarDays },
  { id: "assets", label: "资质与账号", icon: KeyRound },
  { id: "purchases", label: "采购", icon: ShoppingCart },
  { id: "deals", label: "客户合作", icon: Handshake },
  { id: "trips", label: "行程", icon: Plane },
] as const;

export const ASSET_LABEL: Record<string, string> = { credential: "资质证照", account: "账号", domain: "域名", cert: "证书", contract: "合同", subscription: "订阅", device: "设备" };

export function AffairsClient({ data, initialTab }: { data: AffairsData; initialTab?: string }) {
  const [tab, setTabState] = useState<string>(TABS.some((t) => t.id === initialTab) ? initialTab! : "calendar");
  const setTab = (t: string) => { setTabState(t); const u = new URL(window.location.href); u.searchParams.set("tab", t); window.history.replaceState(null, "", u.toString()); };
  const expiring = data.assets.filter((a) => a.state === "expiring" || a.state === "expired").length;
  const dealsDue = data.deals.filter((d) => d.nextOverdue).length;
  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">事务</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">公司层面的事：资质账号到期、采购、客户合作、行程，以及所有带日期的东西汇总的日历。</p>
      </header>
      <div className="no-scrollbar mb-4 flex gap-1 overflow-x-auto border-b border-[var(--color-line)]">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${tab === t.id ? "border-[var(--color-brand)] font-medium text-[var(--color-brand)]" : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}>
            <t.icon className="size-4" />{t.label}
            {t.id === "assets" && expiring > 0 && <span className="rounded-full bg-[var(--color-danger)] px-1.5 text-[10px] leading-4 text-white">{expiring}</span>}
            {t.id === "deals" && dealsDue > 0 && <span className="rounded-full bg-[var(--color-warn)] px-1.5 text-[10px] leading-4 text-white">{dealsDue}</span>}
          </button>
        ))}
      </div>
      {tab === "calendar" && <CalendarTab data={data} />}
      {tab === "assets" && <AssetsTab data={data} />}
      {tab === "purchases" && <PurchasesTab data={data} />}
      {tab === "deals" && <DealsTab data={data} />}
      {tab === "trips" && <TripsTab data={data} />}
    </div>
  );
}

const TONE_CLS: Record<string, string> = {
  danger: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]", warn: "bg-[var(--color-warn)]/15 text-[var(--color-warn)]",
  ok: "bg-[var(--color-ok)]/15 text-[var(--color-ok)] line-through", brand: "bg-[var(--color-brand-soft)] text-[var(--color-brand)]", default: "bg-[var(--color-line)]/50",
};

/** 月视图：7×6 网格，所有带日期的事情放在一起；点日期看当天明细 */
function CalendarTab({ data }: { data: AffairsData }) {
  const router = useRouter();
  const { y, m } = data.month;
  const first = new Date(y, m - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // 周一开头
  const gridStart = new Date(y, m - 1, 1 - startOffset);
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const byDay = new Map<string, AffairsData["events"]>();
  for (const e of data.events) {
    const s0 = new Date(e.start * 1000);
    const endD = e.end ? new Date(e.end * 1000) : s0;
    for (let d = new Date(s0.getFullYear(), s0.getMonth(), s0.getDate()); d <= endD; d.setDate(d.getDate() + 1)) {
      const k = key(d);
      byDay.set(k, [...(byDay.get(k) ?? []), e]);
      if (!e.end) break;
    }
  }
  const today = key(new Date());
  const [sel, setSel] = useState<string>(today);
  const go = (delta: number) => { const d = new Date(y, m - 1 + delta, 1); router.push(`/affairs?tab=calendar&m=${d.getFullYear()}-${d.getMonth() + 1}`); };
  const selEvents = byDay.get(sel) ?? [];
  const upcoming = data.events.filter((e) => e.start >= Date.now() / 1000 - 86400).slice(0, 12);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <Card><CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <button onClick={() => go(-1)} title="上个月" aria-label="上个月" className="rounded-md p-1.5 hover:bg-[var(--color-line)]/40"><ChevronLeft className="size-4" /></button>
          <p className="text-sm font-semibold">{y} 年 {m} 月</p>
          <button onClick={() => go(1)} title="下个月" aria-label="下个月" className="rounded-md p-1.5 hover:bg-[var(--color-line)]/40"><ChevronRight className="size-4" /></button>
        </div>
        <div className="keep-cols grid grid-cols-7 text-center text-[11px] text-[var(--color-muted)]">{["一", "二", "三", "四", "五", "六", "日"].map((d) => <div key={d} className="py-1">{d}</div>)}</div>
        <div className="keep-cols grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-[var(--color-line)]">
          {days.map((d) => {
            const k = key(d);
            const evs = byDay.get(k) ?? [];
            const inMonth = d.getMonth() === m - 1;
            return (
              <button key={k} onClick={() => setSel(k)} className={`flex min-h-14 min-w-0 flex-col items-stretch gap-0.5 bg-[var(--color-card)] p-0.5 text-left sm:min-h-24 sm:p-1 ${inMonth ? "" : "opacity-40"} ${sel === k ? "ring-2 ring-inset ring-[var(--color-brand)]" : ""}`}>
                <span className={`text-[11px] ${k === today ? "grid size-5 place-items-center rounded-full bg-[var(--color-brand)] font-semibold text-white" : "text-[var(--color-muted)]"}`}>{d.getDate()}</span>
                {evs.slice(0, 3).map((e) => <span key={e.id} className={`hidden truncate rounded px-1 text-[10px] leading-4 sm:block ${TONE_CLS[e.tone] ?? TONE_CLS.default}`}>{e.title}</span>)}
                {evs.length > 0 && <span className="flex gap-0.5 sm:hidden">{evs.slice(0, 4).map((e) => <span key={e.id} className={`size-1.5 rounded-full ${e.tone === "danger" ? "bg-[var(--color-danger)]" : e.tone === "warn" ? "bg-[var(--color-warn)]" : e.tone === "ok" ? "bg-[var(--color-ok)]" : "bg-[var(--color-brand)]"}`} />)}</span>}
                {evs.length > 3 && <span className="hidden text-[10px] text-[var(--color-muted)] sm:block">+{evs.length - 3}</span>}
              </button>
            );
          })}
        </div>
      </CardContent></Card>
      <div className="flex flex-col gap-4">
        <Card><CardContent className="p-3">
          <p className="mb-2 text-sm font-semibold">{sel === today ? "今天" : sel.split("-").slice(1).map((x, i) => (i === 0 ? Number(x) + 1 : x)).join("/")}</p>
          {selEvents.length === 0 ? <p className="text-[12px] text-[var(--color-muted)]">没有安排</p> : (
            <ul className="flex flex-col gap-1.5">{selEvents.map((e) => <li key={e.id}><Link href={e.href} className="block rounded-lg border border-[var(--color-line)] p-2 text-[12px] hover:bg-[var(--color-brand-soft)]/30"><p className="font-medium">{e.title}</p>{e.note && <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--color-muted)]">{e.note}</p>}</Link></li>)}</ul>
          )}
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="mb-2 text-sm font-semibold">接下来</p>
          <ul className="flex flex-col gap-1">{upcoming.map((e) => <li key={e.id} className="flex items-center gap-2 text-[12px]"><span className="w-10 shrink-0 tabular-nums text-[var(--color-muted)]">{new Date(e.start * 1000).getMonth() + 1}/{new Date(e.start * 1000).getDate()}</span><Link href={e.href} className="truncate hover:underline">{e.title}</Link></li>)}</ul>
        </CardContent></Card>
        <FeedCard data={data} />
      </div>
    </div>
  );
}

function FeedCard({ data }: { data: AffairsData }) {
  const router = useRouter();
  const [fresh, setFresh] = useState<string | null>(null);
  async function mint() {
    const r = await fetch("/api/ui/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "手机日历" }) }).then((x) => x.json());
    if (!r.ok) return toast.error(r.error ?? "失败");
    setFresh(`${data.base}/api/calendar/${r.token}.ics`); router.refresh();
  }
  async function revoke(id: string) {
    await fetch("/api/ui/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "revoke", id }) });
    toast.success("已吊销"); router.refresh();
  }
  return (
    <Card><CardContent className="p-3">
      <p className="text-sm font-semibold">订阅到手机日历</p>
      <p className="mt-1 text-[11px] leading-5 text-[var(--color-muted)]">iPhone：设置 → 日历 → 账户 → 添加订阅日历，粘贴链接。截止日、到期、行程都会出现在系统日历里，提前一天提醒。手机需要能访问到本机地址。</p>
      {fresh && <div className="mt-2 flex items-center gap-1 rounded-md bg-[var(--color-line)]/40 p-1.5"><code className="min-w-0 flex-1 truncate text-[11px]">{fresh}</code><button title="复制链接" aria-label="复制链接" onClick={() => { navigator.clipboard.writeText(fresh); toast.success("已复制"); }}><Copy className="size-3.5" /></button></div>}
      {fresh && <p className="mt-1 text-[11px] text-[var(--color-warn)]">链接只显示这一次，复制保存好。</p>}
      <div className="mt-2 flex flex-col gap-1">{data.feeds.map((f) => <div key={f.id} className="flex items-center justify-between text-[12px]"><span>{f.name} · {f.prefix}…{f.lastUsedAt ? ` · ${fmtDate(f.lastUsedAt)} 用过` : ""}</span><button onClick={() => revoke(f.id)} title="吊销这个订阅链接" aria-label="吊销这个订阅链接" className="text-[var(--color-muted)] hover:text-[var(--color-danger)]"><Trash2 className="size-3.5" /></button></div>)}</div>
      <Button size="sm" variant="outline" className="mt-2" onClick={mint}><Plus /> 生成订阅链接</Button>
    </CardContent></Card>
  );
}

function AssetsTab({ data }: { data: AffairsData }) {
  const router = useRouter();
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState<null | Partial<AffairsData["assets"][number]>>(null);
  const rows = data.assets.filter((a) => !kind || a.kind === kind);
  const toDate = (t: number | null | undefined) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : "");
  const [f, setF] = useState<Record<string, string>>({});
  function start(a?: AffairsData["assets"][number]) {
    setOpen(a ?? {});
    setF({ kind: a?.kind ?? "account", name: a?.name ?? "", identifier: a?.identifier ?? "", authority: a?.authority ?? "", owner: a?.owner ?? "", valid_until: toDate(a?.validUntil), renew_rule: a?.renewRule ?? "", remind_days: a?.remindDays ?? "30,14,7", secret_ref: a?.secretRef ?? "", notes_md: a?.notesMd ?? "", project: a?.projectId ?? "" });
  }
  async function save() {
    if (!f.name?.trim()) return toast.error("写上名称");
    const r = await callTool("asset_save", {
      id: open?.id, kind: f.kind, name: f.name, identifier: f.identifier, authority: f.authority, owner: f.owner,
      valid_until: f.valid_until ? Math.floor(new Date(f.valid_until + "T18:00:00").getTime() / 1000) : null,
      renew_rule: f.renew_rule, remind_days: f.remind_days, secret_ref: f.secret_ref, notes_md: f.notes_md, project: f.project || undefined,
    });
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("已保存"); setOpen(null); router.refresh();
  }
  const sel = "h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm";
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 text-xs">
          <button onClick={() => setKind("")} className={`rounded-md px-2.5 py-1 ${!kind ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]" : "text-[var(--color-muted)]"}`}>全部 {data.assets.length}</button>
          {Object.entries(ASSET_LABEL).map(([k, l]) => { const n = data.assets.filter((a) => a.kind === k).length; return n ? <button key={k} onClick={() => setKind(k)} className={`rounded-md px-2.5 py-1 ${kind === k ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]" : "text-[var(--color-muted)]"}`}>{l} {n}</button> : null; })}
        </div>
        <Button size="sm" onClick={() => start()}><Plus /> 登记</Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]">
        {rows.length === 0 && <p className="p-8 text-center text-sm text-[var(--color-muted)]">还没有台账。备案号、软著、开发者账号、商户号、域名、证书、合同、设备都可以登记，到期前自动提醒。</p>}
        {rows.map((a) => (
          <button key={a.id} onClick={() => start(a)} className="flex w-full items-start gap-3 border-b border-[var(--color-line)] p-3 text-left last:border-0 hover:bg-[var(--color-brand-soft)]/20">
            <Badge className="mt-0.5 shrink-0">{ASSET_LABEL[a.kind] ?? a.kind}</Badge>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{a.name}{a.identifier && <span className="ml-2 font-mono text-[12px] font-normal text-[var(--color-muted)]">{a.identifier}</span>}</p>
              <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{[a.authority, a.owner && `归属 ${a.owner}`, a.secretRef && `凭据在：${a.secretRef}`, data.projects.find((p) => p.id === a.projectId)?.name].filter(Boolean).join(" · ")}</p>
              {(a.state === "expiring" || a.state === "expired") && <p className="mt-1 text-[11px] text-[var(--color-danger)]">{a.consequence}</p>}
            </div>
            <div className="shrink-0 text-right">
              {a.validUntil ? <Badge tone={a.state === "expired" ? "danger" : a.state === "expiring" ? "warn" : "default"}>{a.state === "expired" ? `过期 ${-a.daysLeft!} 天` : `${fmtDate(a.validUntil)} · 剩 ${a.daysLeft} 天`}</Badge> : <Badge>长期</Badge>}
            </div>
          </button>
        ))}
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{open?.id ? "编辑台账" : "登记台账"}</DialogTitle><DialogDescription>不要填密码：在「凭据保存位置」写放在哪（如 1Password、钥匙串）。</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">类型</span><select className={sel} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(ASSET_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">关联项目</span><select className={sel} value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}><option value="">公司级</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <Input className="col-span-2" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="名称，如：华为开发者账号 / 主站域名" />
            <Input value={f.identifier} onChange={(e) => setF({ ...f, identifier: e.target.value })} placeholder="编号：备案号、AppID、域名…" className="font-mono" />
            <Input value={f.authority} onChange={(e) => setF({ ...f, authority: e.target.value })} placeholder="办理机构/平台" />
            <Input value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} placeholder="归属主体/人" />
            <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">到期日（空=长期）</span><Input type="date" value={f.valid_until} onChange={(e) => setF({ ...f, valid_until: e.target.value })} /></label>
            <Input value={f.remind_days} onChange={(e) => setF({ ...f, remind_days: e.target.value })} placeholder="提前提醒天数 30,14,7" />
            <Input value={f.secret_ref} onChange={(e) => setF({ ...f, secret_ref: e.target.value })} placeholder="凭据保存位置（不写密码）" />
            <Input className="col-span-2" value={f.renew_rule} onChange={(e) => setF({ ...f, renew_rule: e.target.value })} placeholder="怎么续：如 到期前 30 天在阿里云控制台续费" />
            <Textarea className="col-span-2" rows={2} value={f.notes_md} onChange={(e) => setF({ ...f, notes_md: e.target.value })} placeholder="备注" />
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(null)}>取消</Button><Button onClick={save}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}