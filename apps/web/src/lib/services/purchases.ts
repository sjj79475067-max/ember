import { db, s } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { rejectSecrets, toCents, toYuan, ownedItems } from "./affairs-common";
import { saveAsset } from "./assets";

export const PURCHASE_STATUS = ["idea", "comparing", "approved", "ordered", "received", "in_use", "returned", "retired"] as const;
export const PURCHASE_LABEL: Record<string, string> = { idea: "想买", comparing: "比价中", approved: "决定买", ordered: "已下单", received: "已到货", in_use: "在用", returned: "已退货", retired: "已报废" };
// 允许的推进：可以往前跳（比如直接下单），但到货/在用之后不能回到下单前
const ORDER = PURCHASE_STATUS.reduce((m, k, i) => ({ ...m, [k]: i }), {} as Record<string, number>);

export type PurchaseInput = {
  id?: string; title?: string; specMd?: string; caveatsMd?: string; status?: string; budgetYuan?: number | null; qty?: number;
  neededBy?: number | null; projectId?: string | null; chosenQuoteId?: string | null; orderNo?: string; holder?: string; location?: string;
  warrantyUntil?: number | null; invoiceStatus?: string; registerDevice?: boolean;
};

export function purchaseView(p: typeof s.purchases.$inferSelect) {
  const quotes = db.select().from(s.quotes).where(eq(s.quotes.purchaseId, p.id)).all()
    .map((q) => ({ ...q, price: toYuan(q.price)!, shipping: toYuan(q.shipping)!, total: toYuan(q.price + q.shipping)! }))
    .sort((a, b) => a.total - b.total);
  const items = ownedItems("purchase", p.id).map((i) => ({ id: i.id, title: i.title, status: i.status, dueAt: i.dueAt }));
  const chosen = quotes.find((q) => q.id === p.chosenQuoteId) ?? null;
  const t = nowSec();
  return {
    ...p, budget: toYuan(p.budget), label: PURCHASE_LABEL[p.status] ?? p.status, quotes, items, chosen,
    cheapest: quotes[0] ?? null,
    overBudget: !!(p.budget && chosen && toCents(chosen.total)! > p.budget),
    late: !!(p.neededBy && p.neededBy < t && ORDER[p.status] < ORDER.received),
    invoicePending: ["ordered", "received", "in_use"].includes(p.status) && !["received", "not_needed"].includes(p.invoiceStatus),
  };
}

export function listPurchases(opts: { status?: string; projectId?: string; open?: boolean } = {}) {
  let rows = db.select().from(s.purchases).orderBy(desc(s.purchases.updatedAt)).all();
  if (opts.status) rows = rows.filter((r) => r.status === opts.status);
  if (opts.projectId) rows = rows.filter((r) => r.projectId === opts.projectId);
  if (opts.open) rows = rows.filter((r) => ORDER[r.status] < ORDER.in_use);
  return rows.map(purchaseView);
}

export function savePurchase(input: PurchaseInput, actor: Actor) {
  rejectSecrets({ title: input.title, spec: input.specMd, caveats: input.caveatsMd });
  if (input.status && !(PURCHASE_STATUS as readonly string[]).includes(input.status)) throw Object.assign(new Error(`状态只能是：${PURCHASE_STATUS.join(", ")}`), { status: 422 });
  const at = nowSec();
  if (!input.id) {
    if (!input.title?.trim()) throw Object.assign(new Error("写清要买什么"), { status: 422 });
    const id = newId("pur");
    db.insert(s.purchases).values({
      id, title: input.title.trim().slice(0, 160), specMd: input.specMd ?? "", caveatsMd: input.caveatsMd ?? "", status: input.status ?? "idea",
      budget: toCents(input.budgetYuan), qty: input.qty ?? 1, neededBy: input.neededBy ?? null, projectId: input.projectId ?? null,
      holder: input.holder ?? "", location: input.location ?? "", invoiceStatus: input.invoiceStatus ?? "none", createdBy: actor.name, createdAt: at, updatedAt: at,
    }).run();
    audit(actor, "purchase.create", "purchase", id, { title: input.title });
    return purchaseView(db.select().from(s.purchases).where(eq(s.purchases.id, id)).get()!);
  }
  const cur = db.select().from(s.purchases).where(eq(s.purchases.id, input.id)).get();
  if (!cur) throw Object.assign(new Error("采购不存在"), { status: 404 });
  const set: Record<string, unknown> = { updatedAt: at };
  for (const k of ["title", "specMd", "caveatsMd", "qty", "neededBy", "projectId", "chosenQuoteId", "orderNo", "holder", "location", "warrantyUntil", "invoiceStatus"] as const) {
    if (input[k] !== undefined) set[k] = input[k];
  }
  if (input.budgetYuan !== undefined) set.budget = toCents(input.budgetYuan);
  if (input.chosenQuoteId) {
    const q = db.select().from(s.quotes).where(eq(s.quotes.id, input.chosenQuoteId)).get();
    if (!q || q.purchaseId !== cur.id) throw Object.assign(new Error("选中的报价不属于这条采购"), { status: 422 });
  }
  if (input.status && input.status !== cur.status) {
    const from = ORDER[cur.status], to = ORDER[input.status];
    if (from >= ORDER.received && to < ORDER.received) throw Object.assign(new Error("已到货的采购不能退回到下单前；退货请用 returned"), { status: 422 });
    if (input.status === "ordered" && !(input.orderNo ?? cur.orderNo)) throw Object.assign(new Error("标记已下单请填订单号（order_no），之后查物流、开发票都要用"), { status: 422 });
    set.status = input.status;
    if (input.status === "ordered") set.orderedAt = at;
    if (input.status === "received") set.receivedAt = at;
  }
  db.update(s.purchases).set(set).where(eq(s.purchases.id, cur.id)).run();
  // 到货后登记成设备台账（带保修到期提醒）
  const after = db.select().from(s.purchases).where(eq(s.purchases.id, cur.id)).get()!;
  if (["received", "in_use"].includes(after.status) && !after.assetId && (input.registerDevice ?? !!(after.warrantyUntil || after.holder))) {
    const chosen = after.chosenQuoteId ? db.select().from(s.quotes).where(eq(s.quotes.id, after.chosenQuoteId)).get() : null;
    const a = saveAsset({
      kind: "device", name: after.title, identifier: "", owner: after.holder, projectId: after.projectId, validUntil: after.warrantyUntil,
      notesMd: [after.specMd && `规格：${after.specMd}`, chosen && `购自 ${chosen.vendor}${chosen.model ? `（${chosen.model}）` : ""}，订单 ${after.orderNo}`, after.location && `放在：${after.location}`].filter(Boolean).join("\n"),
      costYuan: chosen ? toYuan(chosen.price + chosen.shipping) : null, remindDays: "30",
    }, actor);
    db.update(s.purchases).set({ assetId: a.id }).where(eq(s.purchases.id, cur.id)).run();
  }
  audit(actor, "purchase.update", "purchase", cur.id, input);
  return purchaseView(db.select().from(s.purchases).where(eq(s.purchases.id, cur.id)).get()!);
}

export function addQuote(purchaseId: string, q: { vendor: string; url?: string; model?: string; priceYuan: number; shippingYuan?: number; notes?: string }, actor: Actor) {
  const p = db.select().from(s.purchases).where(eq(s.purchases.id, purchaseId)).get();
  if (!p) throw Object.assign(new Error("采购不存在"), { status: 404 });
  if (!q.vendor?.trim()) throw Object.assign(new Error("写上商家/渠道"), { status: 422 });
  if (!(q.priceYuan >= 0)) throw Object.assign(new Error("价格不对"), { status: 422 });
  const id = newId("quo");
  db.insert(s.quotes).values({ id, purchaseId, vendor: q.vendor.trim(), url: q.url ?? "", model: q.model ?? "", price: toCents(q.priceYuan)!, shipping: toCents(q.shippingYuan ?? 0)!, notes: q.notes ?? "", capturedAt: nowSec() }).run();
  if (p.status === "idea") db.update(s.purchases).set({ status: "comparing", updatedAt: nowSec() }).where(eq(s.purchases.id, purchaseId)).run();
  audit(actor, "purchase.quote", "purchase", purchaseId, { vendor: q.vendor, price: q.priceYuan });
  return purchaseView(db.select().from(s.purchases).where(eq(s.purchases.id, purchaseId)).get()!);
}

export function removeQuote(quoteId: string, actor: Actor) {
  const q = db.select().from(s.quotes).where(eq(s.quotes.id, quoteId)).get();
  if (!q) return { ok: true };
  db.delete(s.quotes).where(eq(s.quotes.id, quoteId)).run();
  db.update(s.purchases).set({ chosenQuoteId: null }).where(eq(s.purchases.chosenQuoteId, quoteId)).run();
  audit(actor, "purchase.quote_remove", "purchase", q.purchaseId, { quoteId });
  return { ok: true };
}