"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ExternalLink, Trophy, Clock, MapPin, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { callTool } from "@/lib/ui-api";
import { fmtDate } from "@/lib/utils";
import { toast } from "sonner";
import type { AffairsData } from "./affairs-client";

const sel = "h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm";
const ts = (v: string) => (v ? Math.floor(new Date(v + "T18:00:00").getTime() / 1000) : null);
const yuan = (n: number | null | undefined) => (n == null ? "—" : `¥${n.toLocaleString("zh-CN")}`);

const P_COLS: Array<[string, string]> = [["idea", "想买"], ["comparing", "比价中"], ["approved", "决定买"], ["ordered", "已下单"], ["received", "已到货"], ["in_use", "在用"]];

export function PurchasesTab({ data }: { data: AffairsData }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: "", spec_md: "", caveats_md: "", budget_yuan: "", needed_by: "", project: "" });
  const cur = data.purchases.find((p) => p.id === openId);
  async function create() {
    if (!f.title.trim()) return toast.error("写清要买什么");
    const r = await callTool("purchase_save", { title: f.title, spec_md: f.spec_md, caveats_md: f.caveats_md, budget_yuan: f.budget_yuan ? Number(f.budget_yuan) : null, needed_by: ts(f.needed_by), project: f.project || undefined });
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("已记下"); setAdding(false); setF({ title: "", spec_md: "", caveats_md: "", budget_yuan: "", needed_by: "", project: "" }); router.refresh();
  }
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] text-[var(--color-muted)]">想买 → 比价 → 决定 → 下单（填订单号）→ 到货（自动登记设备与保修）→ 在用。别忘了发票。</p>
        <Button size="sm" onClick={() => setAdding(true)}><Plus /> 要买的东西</Button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {P_COLS.map(([k, l]) => {
          const list = data.purchases.filter((p) => p.status === k);
          return (
            <div key={k} className="w-60 shrink-0 rounded-xl border border-[var(--color-line)] bg-[var(--color-line)]/15 p-2">
              <div className="mb-2 flex justify-between px-1 text-[13px] font-semibold"><span>{l}</span><span className="text-[11px] font-normal text-[var(--color-muted)]">{list.length}</span></div>
              <div className="flex flex-col gap-2">
                {list.map((p) => (
                  <button key={p.id} onClick={() => setOpenId(p.id)} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] p-2.5 text-left text-[13px] shadow-sm hover:border-[var(--color-brand)]">
                    <p className="font-medium">{p.title}</p>
                    <div className="mt-1 flex flex-wrap gap-1 text-[10.5px] text-[var(--color-muted)]">
                      {p.budget != null && <span>预算 {yuan(p.budget)}</span>}
                      {p.cheapest && <span>· 最低 {yuan(p.cheapest.total)}（{p.quotes.length} 家）</span>}
                      {p.neededBy && <span className={p.late ? "text-[var(--color-danger)]" : ""}>· {fmtDate(p.neededBy)} 前要</span>}
                      {p.overBudget && <span className="text-[var(--color-danger)]">· 超预算</span>}
                      {p.invoicePending && <span className="text-[var(--color-warn)]">· 待开票</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>要买什么</DialogTitle><DialogDescription>把型号要求和注意事项写清楚，比价和下单时就不会买错。</DialogDescription></DialogHeader>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="如：27 寸 4K 显示器" />
          <Textarea rows={2} value={f.spec_md} onChange={(e) => setF({ ...f, spec_md: e.target.value })} placeholder="型号/规格要求：如 Type-C 90W 反向充电、IPS、支持 KVM" />
          <Textarea rows={2} value={f.caveats_md} onChange={(e) => setF({ ...f, caveats_md: e.target.value })} placeholder="注意事项：接口兼容、电压、尺寸、要专票、发票抬头…" />
          <div className="grid grid-cols-3 gap-2">
            <Input type="number" value={f.budget_yuan} onChange={(e) => setF({ ...f, budget_yuan: e.target.value })} placeholder="预算（元）" />
            <Input type="date" value={f.needed_by} onChange={(e) => setF({ ...f, needed_by: e.target.value })} />
            <select className={sel} value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}><option value="">公司用</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setAdding(false)}>取消</Button><Button onClick={create}>记下</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {cur && <PurchaseDetail p={cur} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function PurchaseDetail({ p, onClose }: { p: Record<string, any>; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState({ vendor: "", url: "", model: "", price: "", shipping: "", notes: "" });
  const [orderNo, setOrderNo] = useState(p.orderNo ?? "");
  const [rec, setRec] = useState({ holder: p.holder ?? "", location: p.location ?? "", warranty: p.warrantyUntil ? new Date(p.warrantyUntil * 1000).toISOString().slice(0, 10) : "" });
  async function act(body: Record<string, unknown>, ok: string) {
    const r = await callTool("purchase_save", { id: p.id, ...body });
    if (!r.ok) { toast.error(r.error ?? "失败"); return false; }
    toast.success(ok); router.refresh(); return true;
  }
  async function addQ() {
    if (!q.vendor || !q.price) return toast.error("商家和价格必填");
    if (await act({ add_quote: { vendor: q.vendor, url: q.url || undefined, model: q.model || undefined, price_yuan: Number(q.price), shipping_yuan: q.shipping ? Number(q.shipping) : 0, notes: q.notes || undefined } }, "已加报价")) setQ({ vendor: "", url: "", model: "", price: "", shipping: "", notes: "" });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{p.title}</DialogTitle><DialogDescription>{p.label}{p.budget != null ? ` · 预算 ${yuan(p.budget)}` : ""}{p.neededBy ? ` · ${fmtDate(p.neededBy)} 前要` : ""}</DialogDescription></DialogHeader>
        {(p.specMd || p.caveatsMd) && <div className="grid gap-2 text-[12px] sm:grid-cols-2">{p.specMd && <div className="rounded-lg bg-[var(--color-line)]/30 p-2"><p className="mb-0.5 font-medium">规格要求</p><p className="whitespace-pre-wrap text-[var(--color-muted)]">{p.specMd}</p></div>}{p.caveatsMd && <div className="rounded-lg bg-[var(--color-warn)]/10 p-2"><p className="mb-0.5 font-medium">注意事项</p><p className="whitespace-pre-wrap">{p.caveatsMd}</p></div>}</div>}
        <div>
          <p className="mb-1.5 text-xs font-semibold text-[var(--color-muted)]">比价（按到手价排序）</p>
          {p.quotes.length === 0 ? <p className="text-[12px] text-[var(--color-muted)]">还没有报价</p> : (
            <div className="overflow-hidden rounded-lg border border-[var(--color-line)]">
              {p.quotes.map((x: Record<string, any>, i: number) => (
                <div key={x.id} className={`flex items-center gap-2 border-b border-[var(--color-line)] p-2 text-[12px] last:border-0 ${p.chosenQuoteId === x.id ? "bg-[var(--color-brand-soft)]/50" : ""}`}>
                  {i === 0 && <Trophy className="size-3.5 shrink-0 text-[var(--color-ok)]" />}
                  <span className="min-w-0 flex-1"><b>{x.vendor}</b>{x.model ? ` · ${x.model}` : ""}{x.notes ? <span className="text-[var(--color-muted)]"> · {x.notes}</span> : null}</span>
                  <span className="tabular-nums">{yuan(x.total)}{x.shipping ? <span className="text-[var(--color-muted)]">（含运费 {x.shipping}）</span> : null}</span>
                  {x.url && <a href={x.url} target="_blank" rel="noreferrer" className="text-[var(--color-muted)]"><ExternalLink className="size-3.5" /></a>}
                  {p.chosenQuoteId === x.id ? <Badge tone="brand">已选</Badge> : <button onClick={() => act({ chosen_quote_id: x.id, status: ["idea", "comparing"].includes(p.status) ? "approved" : undefined }, "已选定")} className="text-[11px] text-[var(--color-brand)] hover:underline">选这家</button>}
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            <Input className="col-span-2 h-8 text-[12px]" value={q.vendor} onChange={(e) => setQ({ ...q, vendor: e.target.value })} placeholder="商家/渠道" />
            <Input className="col-span-2 h-8 text-[12px]" value={q.model} onChange={(e) => setQ({ ...q, model: e.target.value })} placeholder="具体型号" />
            <Input className="h-8 text-[12px]" type="number" value={q.price} onChange={(e) => setQ({ ...q, price: e.target.value })} placeholder="价格" />
            <Input className="h-8 text-[12px]" type="number" value={q.shipping} onChange={(e) => setQ({ ...q, shipping: e.target.value })} placeholder="运费" />
            <Input className="col-span-3 h-8 text-[12px]" value={q.url} onChange={(e) => setQ({ ...q, url: e.target.value })} placeholder="链接" />
            <Input className="col-span-2 h-8 text-[12px]" value={q.notes} onChange={(e) => setQ({ ...q, notes: e.target.value })} placeholder="备注（发货、开票…）" />
            <Button size="sm" variant="outline" onClick={addQ}><Plus /></Button>
          </div>
        </div>
        <div className="grid gap-2 rounded-lg border border-[var(--color-line)] p-2.5 sm:grid-cols-2">
          <div className="flex items-end gap-1.5"><Input className="h-8 text-[12px]" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="订单号" /><Button size="sm" variant="outline" onClick={() => act({ status: "ordered", order_no: orderNo }, "已标记下单")} disabled={["ordered", "received", "in_use"].includes(p.status)}>已下单</Button></div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]"><span className="text-[var(--color-muted)]">发票</span>{(["requested", "received", "not_needed"] as const).map((k) => <button key={k} onClick={() => act({ invoice_status: k }, "已更新")} className={`rounded-md border px-2 py-0.5 ${p.invoiceStatus === k ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]" : "border-[var(--color-line)]"}`}>{{ requested: "已申请", received: "已拿到", not_needed: "不需要" }[k]}</button>)}</div>
          <Input className="h-8 text-[12px]" value={rec.holder} onChange={(e) => setRec({ ...rec, holder: e.target.value })} placeholder="谁在用" />
          <Input className="h-8 text-[12px]" value={rec.location} onChange={(e) => setRec({ ...rec, location: e.target.value })} placeholder="放在哪" />
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--color-muted)]">保修到<Input type="date" className="h-8 text-[12px]" value={rec.warranty} onChange={(e) => setRec({ ...rec, warranty: e.target.value })} /></label>
          <Button size="sm" onClick={() => act({ status: p.status === "received" ? "in_use" : "received", holder: rec.holder, location: rec.location, warranty_until: ts(rec.warranty) }, "已到货，设备已登记")} disabled={!["ordered", "received"].includes(p.status)}>{p.status === "received" ? "开始使用" : "已到货"}</Button>
        </div>
        {p.items.length > 0 && <div><p className="mb-1 text-xs font-semibold text-[var(--color-muted)]">相关待办</p><ul className="text-[12px]">{p.items.map((i: Record<string, any>) => <li key={i.id} className={i.status === "done" ? "text-[var(--color-muted)] line-through" : ""}>· {i.title}</li>)}</ul></div>}
        <DialogFooter><Button variant="ghost" onClick={onClose}>关闭</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const D_COLS: Array<[string, string]> = [["lead", "线索"], ["talking", "洽谈"], ["proposal", "方案/报价"], ["negotiating", "谈判"], ["won", "已签"], ["lost", "未成"]];

export function DealsTab({ data }: { data: AffairsData }) {
  const router = useRouter();
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  function start(d?: Record<string, any>) {
    setEdit(d ?? {});
    setF({ title: d?.title ?? "", org: d?.org?.name ?? "", contact: d?.contact?.name ?? "", phone: d?.contact?.phone ?? "", stage: d?.stage ?? "lead", amount: d?.amount != null ? String(d.amount) : "", next_step: d?.nextStep ?? "", next_at: d?.nextStepAt ? new Date(d.nextStepAt * 1000).toISOString().slice(0, 10) : "", lost_reason: d?.lostReason ?? "", notes: d?.notesMd ?? "" });
  }
  async function save() {
    const r = await callTool("deal_save", {
      id: edit?.id, title: f.title || undefined, org: f.org || undefined, stage: f.stage, amount_yuan: f.amount ? Number(f.amount) : null,
      next_step: f.next_step, next_step_at: ts(f.next_at), lost_reason: f.lost_reason || undefined, notes_md: f.notes,
      contact: f.contact ? { name: f.contact, phone: f.phone || undefined } : undefined,
    });
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("已保存"); setEdit(null); router.refresh();
  }
  const pipeline = data.deals.filter((d) => !["won", "lost"].includes(d.stage)).reduce((a, d) => a + (d.amount ?? 0) * ((d.probability ?? 50) / 100), 0);
  const follow = data.contacts.filter((c) => c.overdueContact);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[var(--color-muted)]">在谈的合作都要有「下一步 + 时间」。加权在谈金额约 {yuan(Math.round(pipeline))}。</p>
        <Button size="sm" onClick={() => start()}><Plus /> 新合作</Button>
      </div>
      {follow.length > 0 && <div className="mb-3 rounded-xl border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 p-2.5 text-[12px]"><Users className="mr-1 inline size-3.5" />很久没联系：{follow.map((c) => `${c.name}${c.orgName ? `（${c.orgName}）` : ""} ${c.daysSince ?? "?"} 天`).join("、")}</div>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {D_COLS.map(([k, l]) => {
          const list = data.deals.filter((d) => d.stage === k);
          return (
            <div key={k} className={`w-56 shrink-0 rounded-xl border border-[var(--color-line)] p-2 ${k === "lost" ? "opacity-60" : "bg-[var(--color-line)]/15"}`}>
              <div className="mb-2 flex justify-between px-1 text-[13px] font-semibold"><span>{l}</span><span className="text-[11px] font-normal text-[var(--color-muted)]">{list.length}</span></div>
              <div className="flex flex-col gap-2">
                {list.map((d) => (
                  <button key={d.id} onClick={() => start(d)} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] p-2.5 text-left text-[13px] shadow-sm hover:border-[var(--color-brand)]">
                    <p className="font-medium">{d.title}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{[d.org?.name, d.contact?.name, d.amount != null && yuan(d.amount)].filter(Boolean).join(" · ")}</p>
                    {!["won", "lost"].includes(d.stage) && (d.nextStep
                      ? <p className={`mt-1 text-[11px] ${d.nextOverdue ? "text-[var(--color-danger)]" : "text-[var(--color-brand)]"}`}><Clock className="inline size-3" /> {d.nextStepAt ? fmtDate(d.nextStepAt) : ""} {d.nextStep}</p>
                      : <p className="mt-1 text-[11px] text-[var(--color-warn)]">没写下一步</p>)}
                    {d.stage === "lost" && d.lostReason && <p className="mt-1 text-[11px] text-[var(--color-muted)]">原因：{d.lostReason}</p>}
                    {d.prepOpen > 0 && <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">待准备 {d.prepOpen} 项</p>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{edit?.id ? "合作" : "新合作"}</DialogTitle><DialogDescription>没谈成也要写原因；在谈的合作必须有下一步。</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Input className="col-span-2" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="合作内容，如：某银行小程序外包" />
            <Input value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })} placeholder="客户/机构" />
            <select className={sel} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{D_COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <Input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="对接人" />
            <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="电话/微信" />
            <Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="金额（元）" />
            <Input type="date" value={f.next_at} onChange={(e) => setF({ ...f, next_at: e.target.value })} />
            <Input className="col-span-2" value={f.next_step} onChange={(e) => setF({ ...f, next_step: e.target.value })} placeholder="下一步：如 周三前发报价" />
            {f.stage === "lost" && <Input className="col-span-2" value={f.lost_reason} onChange={(e) => setF({ ...f, lost_reason: e.target.value })} placeholder="没谈成的原因" />}
            <Textarea className="col-span-2" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="合作细节、对方关注点" />
          </div>
          {edit?.prep?.length > 0 && <div className="text-[12px]"><p className="mb-1 font-semibold text-[var(--color-muted)]">要准备的</p>{edit!.prep.map((i: Record<string, any>) => <p key={i.id} className={i.status === "done" ? "text-[var(--color-muted)] line-through" : ""}>· {i.title}</p>)}</div>}
          <DialogFooter><Button variant="ghost" onClick={() => setEdit(null)}>取消</Button><Button onClick={save}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TripsTab({ data }: { data: AffairsData }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: "", city: "", start: "", end: "", purpose: "", deal: "" });
  async function create() {
    if (!f.title || !f.start) return toast.error("标题和出发日期必填");
    const r = await callTool("trip_save", { title: f.title, city: f.city, purpose: f.purpose, start_at: Math.floor(new Date(f.start + "T09:00:00").getTime() / 1000), end_at: f.end ? Math.floor(new Date(f.end + "T20:00:00").getTime() / 1000) : undefined, deal_id: f.deal || undefined });
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("行程已记录，出行准备清单已生成"); setAdding(false); router.refresh();
  }
  const groups = [["upcoming", "即将出发"], ["ongoing", "进行中"], ["past", "已结束"]] as const;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] text-[var(--color-muted)]">新建行程会自动生成：订票、订酒店、确认会面、准备资料、票据报销、纪要归档。</p>
        <Button size="sm" onClick={() => setAdding(true)}><Plus /> 新行程</Button>
      </div>
      {data.trips.length === 0 && <p className="rounded-xl border border-dashed border-[var(--color-line)] p-8 text-center text-sm text-[var(--color-muted)]">还没有行程。</p>}
      {groups.map(([k, l]) => {
        const list = data.trips.filter((t) => t.phase === k);
        if (!list.length) return null;
        return (
          <div key={k} className="mb-4">
            <p className="mb-2 text-sm font-semibold text-[var(--color-muted)]">{l}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {list.map((t) => (
                <Card key={t.id}><CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium">{t.title}</p>{k === "upcoming" && <Badge tone={t.daysToStart <= 3 ? "warn" : "default"}>{t.daysToStart} 天后</Badge>}</div>
                  <p className="mt-0.5 text-[12px] text-[var(--color-muted)]"><MapPin className="inline size-3" /> {t.city || "—"} · {fmtDate(t.startAt)} – {fmtDate(t.endAt)}{t.purpose ? ` · ${t.purpose}` : ""}</p>
                  {t.legs.length > 0 && <p className="mt-1 text-[11px] text-[var(--color-muted)]">{t.legs.map((g: Record<string, any>) => `${g.type ?? ""} ${g.no ?? ""} ${g.from ?? ""}→${g.to ?? ""}`).join("；")}</p>}
                  <div className="mt-2 flex flex-col gap-0.5">{t.prep.map((i: Record<string, any>) => <p key={i.id} className={`text-[12px] ${i.status === "done" ? "text-[var(--color-muted)] line-through" : i.dueAt && i.dueAt < Date.now() / 1000 ? "text-[var(--color-danger)]" : ""}`}>· {i.title.replace(/^.*?：/, "")}{i.dueAt && i.status !== "done" ? <span className="text-[var(--color-muted)]">（{fmtDate(i.dueAt)}）</span> : null}</p>)}</div>
                </CardContent></Card>
              ))}
            </div>
          </div>
        );
      })}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>新行程</DialogTitle></DialogHeader>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="如：去上海见某银行" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="城市" />
            <select className={sel} value={f.deal} onChange={(e) => setF({ ...f, deal: e.target.value })}><option value="">不关联合作</option>{data.deals.filter((d) => !["won", "lost"].includes(d.stage)).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">出发<Input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">返回<Input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
          </div>
          <Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="目的" />
          <DialogFooter><Button variant="ghost" onClick={() => setAdding(false)}>取消</Button><Button onClick={create}>记录</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}