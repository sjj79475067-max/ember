import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

beforeAll(async () => {
  process.env.DATABASE_URL = "file:" + path.join(mkdtempSync(path.join(tmpdir(), "ember-aff-")), "t.db");
  const { sqlite } = await import("@/lib/db");
  const dir = path.join(process.cwd(), "drizzle");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const chunk of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) if (chunk.trim()) sqlite.exec(chunk);
  }
});

const user = { type: "user" as const, name: "owner" };
const agent = { type: "agent" as const, name: "ag" };
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

describe("台账", () => {
  it("到期状态推导、重复编号去重、过期后果", async () => {
    const { saveAsset, listAssets } = await import("@/lib/services/assets");
    saveAsset({ kind: "domain", name: "主站域名", identifier: "example.cn", validUntil: now() + 10 * DAY }, user);
    saveAsset({ kind: "cert", name: "SSL", identifier: "*.example.cn", validUntil: now() - DAY }, user);
    saveAsset({ kind: "credential", name: "ICP 备案", identifier: "京ICP备2026000001号" }, user);
    expect(() => saveAsset({ kind: "domain", name: "又登记一次", identifier: "example.cn" }, agent)).toThrow(/已登记/);
    const rows = listAssets();
    expect(rows[0].state).toBe("expired");
    expect(rows.find((r) => r.kind === "domain")?.state).toBe("expiring");
    expect(rows.find((r) => r.kind === "domain")?.consequence).toMatch(/宽限期/);
    expect(rows.at(-1)?.state).toBe("active"); // 长期有效排最后
  });

  it("不存密码", async () => {
    const { saveAsset } = await import("@/lib/services/assets");
    expect(() => saveAsset({ kind: "account", name: "阿里云", notesMd: "密码：Abc12345!" }, agent)).toThrow(/不保存密码/);
    expect(() => saveAsset({ kind: "account", name: "OpenAI", notesMd: "key sk-abcdefghijklmnopqrstuvwx" }, agent)).toThrow(/不保存密码/);
    const ok = saveAsset({ kind: "account", name: "阿里云主账号", secretRef: "1Password：阿里云" }, agent);
    expect(ok.secretRef).toBe("1Password：阿里云");
  });

  it("资质事项办完登记到台账", async () => {
    const { createProject } = await import("@/lib/services/projects");
    const { addItems, updateItem } = await import("@/lib/services/items");
    const { assetFromItem } = await import("@/lib/services/assets");
    const p = createProject({ key: "TAST", name: "台账测试" }, user);
    const r = addItems(p.id, [{ title: "办理软件著作权登记", kind: "compliance" }], user);
    updateItem(r.ids[0], { status: "done", evidence: "拿到登记证书，证书号 软著登字第123456号" }, user);
    const a = assetFromItem(r.ids[0], { identifier: "软著登字第123456号" }, user);
    expect(a.kind).toBe("credential");
    expect(a.projectId).toBe(p.id);
    expect(a.name).toBe("软件著作权登记");
  });
});

describe("采购", () => {
  it("报价排序、超预算、下单要订单号、到货登记设备", async () => {
    const { savePurchase, addQuote } = await import("@/lib/services/purchases");
    const { listAssets } = await import("@/lib/services/assets");
    let p = savePurchase({ title: "27 寸 4K 显示器", specMd: "Type-C 90W 反向充电", caveatsMd: "要能开专票", budgetYuan: 2500 }, user);
    p = addQuote(p.id, { vendor: "京东自营", priceYuan: 2599, shippingYuan: 0 }, user);
    p = addQuote(p.id, { vendor: "拼多多百亿补贴", priceYuan: 2199, shippingYuan: 0, notes: "开票要等" }, user);
    expect(p.status).toBe("comparing");
    expect(p.cheapest?.vendor).toBe("拼多多百亿补贴");
    p = savePurchase({ id: p.id, chosenQuoteId: p.quotes.find((q) => q.vendor === "京东自营")!.id }, user);
    expect(p.overBudget).toBe(true);
    expect(() => savePurchase({ id: p.id, status: "ordered" }, agent)).toThrow(/订单号/);
    p = savePurchase({ id: p.id, status: "ordered", orderNo: "JD2026110500001" }, agent);
    expect(p.invoicePending).toBe(true);
    p = savePurchase({ id: p.id, status: "received", holder: "我", location: "书房", warrantyUntil: now() + 365 * DAY }, agent);
    expect(p.assetId).toBeTruthy();
    expect(listAssets({ kind: "device" }).some((a) => a.name === "27 寸 4K 显示器" && a.cost === 2599)).toBe(true);
    expect(() => savePurchase({ id: p.id, status: "approved" }, agent)).toThrow(/不能退回/);
  });

  it("采购的待办挂在采购下，不与其他事务的待办合并", async () => {
    const { savePurchase } = await import("@/lib/services/purchases");
    const { addOwnedItems } = await import("@/lib/services/owned");
    const { saveDeal } = await import("@/lib/services/crm");
    const a = savePurchase({ title: "采购 A" }, user);
    const d = saveDeal({ title: "合作 B", nextStep: "发方案", nextStepAt: now() + DAY }, user);
    const r1 = addOwnedItems("purchase", a.id, [{ title: "跟进商家发票" }], user);
    const r2 = addOwnedItems("deal", d.id, [{ title: "跟进商家发票" }], user);
    expect(r1.ids.length).toBe(1);
    expect(r2.ids.length).toBe(1);
  });
});

describe("合作与联系人", () => {
  it("没成必须写原因；同名机构复用；联系周期提醒", async () => {
    const { saveDeal, saveContact, listContacts, listOrgs } = await import("@/lib/services/crm");
    const d = saveDeal({ title: "某银行小程序外包", org: "某银行", stage: "talking", amountYuan: 120000, nextStep: "发报价", nextStepAt: now() + 2 * DAY }, agent);
    expect(d.amount).toBe(120000);
    expect(() => saveDeal({ id: d.id, stage: "lost" }, agent)).toThrow(/原因/);
    saveDeal({ title: "某银行二期", org: "某银行" }, agent);
    expect(listOrgs().filter((o) => o.name === "某银行").length).toBe(1);
    const c = saveContact({ org: "某银行", name: "王经理", contactEveryDays: 14 }, user);
    const { db, s } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    db.update(s.contacts).set({ lastContactAt: now() - 20 * DAY }).where(eq(s.contacts.id, c.id)).run();
    expect(listContacts().find((x) => x.id === c.id)?.overdueContact).toBe(true);
  });
});

describe("行程", () => {
  it("默认生成行前/行后准备，改出发日平移未完成项", async () => {
    const { saveTrip } = await import("@/lib/services/trips");
    const start = now() + 10 * DAY;
    const t = saveTrip({ title: "去上海见客户", city: "上海", startAt: start, endAt: start + 2 * DAY }, user);
    expect(t.prep.length).toBe(6);
    const ticket = t.prep.find((p) => p.title.includes("订往返交通"))!;
    expect(ticket.dueAt).toBe(start - 7 * DAY);
    const moved = saveTrip({ id: t.id, startAt: start + 3 * DAY }, user);
    expect(moved.prep.find((p) => p.id === ticket.id)!.dueAt).toBe(start - 4 * DAY);
  });
});

describe("重复事项与公司日历", () => {
  it("规则计算", async () => {
    const { nextOccurrence } = await import("@/lib/services/recur");
    const at = (y: number, m: number, d: number) => Math.floor(new Date(y, m - 1, d, 12).getTime() / 1000);
    const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
    expect(day(nextOccurrence("monthly:15", at(2026, 11, 20))!)).toBe("2026-12-15");
    expect(day(nextOccurrence("quarterly:15", at(2026, 11, 5))!)).toBe("2027-01-15");
    expect(day(nextOccurrence("quarterly:15", at(2026, 1, 3))!)).toBe("2026-01-15");
    expect(day(nextOccurrence("yearly:05-31", at(2026, 6, 1))!)).toBe("2027-05-31");
    expect(new Date(nextOccurrence("monthly:31", at(2027, 2, 1))! * 1000).getDate()).toBe(28); // 月末兜底
  });

  it("公司模板：带截止日；完成一期生成下一期且不重复生成", async () => {
    const { createProject } = await import("@/lib/services/projects");
    const { applyTemplate } = await import("@/lib/services/templates");
    const { updateItem } = await import("@/lib/services/items");
    const { db, s } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const p = createProject({ key: "TCO", name: "公司" }, user);
    const r = applyTemplate(p.id, "company_cn", user);
    expect(r.items).toBeGreaterThanOrEqual(7);
    const items = db.select().from(s.items).where(eq(s.items.projectId, p.id)).all();
    expect(items.every((i) => i.dueAt && i.recurRule)).toBe(true);
    const vat = items.find((i) => i.title.includes("增值税"))!;
    const u = updateItem(vat.id, { status: "done", evidence: "申报成功，申报表截图已归档" }, user);
    expect(u.nextRecur?.dueAt).toBeGreaterThan(vat.dueAt!);
    updateItem(vat.id, { status: "todo" }, user);
    const again = updateItem(vat.id, { status: "done", evidence: "申报成功，回执号 99887766" }, user);
    expect(again.nextRecur?.id).toBe(u.nextRecur?.id);
  });
});

describe("日历", () => {
  it("合并所有带日期的东西，并输出合法 ICS", async () => {
    const { agenda, renderIcs, mintFeed, feedByToken, revokeFeed } = await import("@/lib/services/calendar");
    const ev = agenda(now() - 30 * DAY, now() + 400 * DAY);
    const kinds = new Set(ev.map((e) => e.kind));
    for (const k of ["item", "asset", "deal", "trip"]) expect(kinds.has(k as never)).toBe(true);
    const ics = renderIcs("http://localhost:3000");
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.includes("END:VCALENDAR")).toBe(true);
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const f = mintFeed("iPhone", user);
    expect(feedByToken(f.raw)).toBeTruthy();
    revokeFeed(f.id, user);
    expect(feedByToken(f.raw)).toBeNull();
  });
});