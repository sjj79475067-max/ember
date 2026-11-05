import { db, s } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { rejectSecrets, toCents, toYuan, ownedItems, daysUntil, DAY } from "./affairs-common";

export const DEAL_STAGES = ["lead", "talking", "proposal", "negotiating", "won", "lost"] as const;
export const DEAL_LABEL: Record<string, string> = { lead: "线索", talking: "洽谈", proposal: "方案/报价", negotiating: "谈判", won: "已签", lost: "未成" };
export const ORG_KINDS = ["client", "vendor", "partner", "platform"] as const;

export function saveOrg(input: { id?: string; name?: string; kind?: string; website?: string; notesMd?: string }, actor: Actor) {
  rejectSecrets({ notes: input.notesMd });
  const at = nowSec();
  if (input.id) {
    const set: Record<string, unknown> = { updatedAt: at };
    for (const k of ["name", "kind", "website", "notesMd"] as const) if (input[k] !== undefined) set[k] = input[k];
    db.update(s.orgs).set(set).where(eq(s.orgs.id, input.id)).run();
    audit(actor, "org.update", "org", input.id, input);
    return db.select().from(s.orgs).where(eq(s.orgs.id, input.id)).get()!;
  }
  const name = input.name?.trim();
  if (!name) throw Object.assign(new Error("机构名称不能为空"), { status: 422 });
  const dup = db.select().from(s.orgs).all().find((o) => o.name === name);
  if (dup) return dup; // 同名机构直接复用，避免一家客户建出三条
  const id = newId("org");
  db.insert(s.orgs).values({ id, name, kind: input.kind ?? "client", website: input.website ?? "", notesMd: input.notesMd ?? "", createdAt: at, updatedAt: at }).run();
  audit(actor, "org.create", "org", id, { name });
  return db.select().from(s.orgs).where(eq(s.orgs.id, id)).get()!;
}

export function findOrg(nameOrId: string | undefined | null) {
  if (!nameOrId) return null;
  return db.select().from(s.orgs).where(eq(s.orgs.id, nameOrId)).get() ?? db.select().from(s.orgs).all().find((o) => o.name === nameOrId) ?? null;
}

export function saveContact(input: { id?: string; org?: string | null; name?: string; title?: string; phone?: string; wechat?: string; email?: string; notesMd?: string; contactEveryDays?: number | null; touched?: boolean }, actor: Actor) {
  rejectSecrets({ notes: input.notesMd });
  const at = nowSec();
  const org = input.org ? (findOrg(input.org) ?? saveOrg({ name: input.org }, actor)) : null;
  if (input.id) {
    const set: Record<string, unknown> = { updatedAt: at };
    for (const k of ["name", "title", "phone", "wechat", "email", "notesMd", "contactEveryDays"] as const) if (input[k] !== undefined) set[k] = input[k];
    if (input.org !== undefined) set.orgId = org?.id ?? null;
    if (input.touched) set.lastContactAt = at;
    db.update(s.contacts).set(set).where(eq(s.contacts.id, input.id)).run();
    audit(actor, "contact.update", "contact", input.id, { ...input });
    return db.select().from(s.contacts).where(eq(s.contacts.id, input.id)).get()!;
  }
  if (!input.name?.trim()) throw Object.assign(new Error("联系人姓名不能为空"), { status: 422 });
  const dup = db.select().from(s.contacts).all().find((c) => c.name === input.name!.trim() && (c.orgId ?? null) === (org?.id ?? null));
  if (dup) return dup;
  const id = newId("con");
  db.insert(s.contacts).values({
    id, orgId: org?.id ?? null, name: input.name.trim(), title: input.title ?? "", phone: input.phone ?? "", wechat: input.wechat ?? "",
    email: input.email ?? "", notesMd: input.notesMd ?? "", contactEveryDays: input.contactEveryDays ?? null, lastContactAt: input.touched ? at : null, createdAt: at, updatedAt: at,
  }).run();
  audit(actor, "contact.create", "contact", id, { name: input.name });
  return db.select().from(s.contacts).where(eq(s.contacts.id, id)).get()!;
}

export type DealInput = {
  id?: string; title?: string; org?: string | null; contactId?: string | null; stage?: string; amountYuan?: number | null; probability?: number | null;
  expectedCloseAt?: number | null; nextStep?: string; nextStepAt?: number | null; lostReason?: string; notesMd?: string; projectId?: string | null;
};

export function dealView(d: typeof s.deals.$inferSelect) {
  const org = d.orgId ? db.select().from(s.orgs).where(eq(s.orgs.id, d.orgId)).get() : null;
  const contact = d.contactId ? db.select().from(s.contacts).where(eq(s.contacts.id, d.contactId)).get() : null;
  const prep = ownedItems("deal", d.id).map((i) => ({ id: i.id, title: i.title, status: i.status, dueAt: i.dueAt }));
  const t = nowSec();
  return {
    ...d, amount: toYuan(d.amount), label: DEAL_LABEL[d.stage] ?? d.stage, org: org ? { id: org.id, name: org.name } : null,
    contact: contact ? { id: contact.id, name: contact.name, title: contact.title, phone: contact.phone, wechat: contact.wechat } : null,
    prep, prepOpen: prep.filter((p) => !["done", "dropped"].includes(p.status)).length,
    nextOverdue: !!(d.nextStepAt && d.nextStepAt < t && !["won", "lost"].includes(d.stage)),
    noNextStep: !["won", "lost"].includes(d.stage) && !d.nextStep.trim(),
    daysToNext: daysUntil(d.nextStepAt, t),
  };
}

export function listDeals(opts: { stage?: string; open?: boolean } = {}) {
  let rows = db.select().from(s.deals).orderBy(desc(s.deals.updatedAt)).all();
  if (opts.stage) rows = rows.filter((r) => r.stage === opts.stage);
  if (opts.open) rows = rows.filter((r) => !["won", "lost"].includes(r.stage));
  return rows.map(dealView);
}

/** 合作推进的硬规则：没成必须写原因；推进中必须有下一步（销售管理里最常丢的就是「下一步」） */
export function saveDeal(input: DealInput, actor: Actor) {
  rejectSecrets({ title: input.title, notes: input.notesMd, next: input.nextStep });
  if (input.stage && !(DEAL_STAGES as readonly string[]).includes(input.stage)) throw Object.assign(new Error(`阶段只能是：${DEAL_STAGES.join(", ")}`), { status: 422 });
  if (input.probability != null && (input.probability < 0 || input.probability > 100)) throw Object.assign(new Error("成交把握 0–100"), { status: 422 });
  const at = nowSec();
  const org = input.org ? (findOrg(input.org) ?? saveOrg({ name: input.org }, actor)) : undefined;
  if (input.stage === "lost" && !(input.lostReason ?? "").trim()) throw Object.assign(new Error("没谈成也要写原因（lost_reason），下次才知道怎么改"), { status: 422 });
  if (!input.id) {
    if (!input.title?.trim()) throw Object.assign(new Error("写清这是什么合作"), { status: 422 });
    const id = newId("deal");
    db.insert(s.deals).values({
      id, title: input.title.trim().slice(0, 160), orgId: org?.id ?? null, contactId: input.contactId ?? null, stage: input.stage ?? "lead",
      amount: toCents(input.amountYuan), probability: input.probability ?? null, expectedCloseAt: input.expectedCloseAt ?? null,
      nextStep: input.nextStep ?? "", nextStepAt: input.nextStepAt ?? null, lostReason: input.lostReason ?? "", notesMd: input.notesMd ?? "",
      projectId: input.projectId ?? null, createdAt: at, updatedAt: at,
    }).run();
    audit(actor, "deal.create", "deal", id, { title: input.title });
    return dealView(db.select().from(s.deals).where(eq(s.deals.id, id)).get()!);
  }
  const cur = db.select().from(s.deals).where(eq(s.deals.id, input.id)).get();
  if (!cur) throw Object.assign(new Error("合作不存在"), { status: 404 });
  const set: Record<string, unknown> = { updatedAt: at };
  for (const k of ["title", "contactId", "stage", "probability", "expectedCloseAt", "nextStep", "nextStepAt", "lostReason", "notesMd", "projectId"] as const) if (input[k] !== undefined) set[k] = input[k];
  if (org !== undefined) set.orgId = org?.id ?? null;
  if (input.amountYuan !== undefined) set.amount = toCents(input.amountYuan);
  db.update(s.deals).set(set).where(eq(s.deals.id, cur.id)).run();
  // 联系人：推进合作视为一次联系
  if (cur.contactId && (input.nextStep !== undefined || input.stage !== undefined)) db.update(s.contacts).set({ lastContactAt: at }).where(eq(s.contacts.id, cur.contactId)).run();
  audit(actor, "deal.update", "deal", cur.id, input);
  return dealView(db.select().from(s.deals).where(eq(s.deals.id, cur.id)).get()!);
}

export function listContacts() {
  const t = nowSec();
  const orgs = new Map(db.select().from(s.orgs).all().map((o) => [o.id, o.name]));
  return db.select().from(s.contacts).all().map((c) => ({
    ...c, orgName: c.orgId ? orgs.get(c.orgId) ?? "" : "",
    overdueContact: !!(c.contactEveryDays && (t - (c.lastContactAt ?? c.createdAt)) > c.contactEveryDays * DAY),
    daysSince: c.lastContactAt ? Math.floor((t - c.lastContactAt) / DAY) : null,
  })).sort((a, b) => Number(b.overdueContact) - Number(a.overdueContact) || (b.lastContactAt ?? 0) - (a.lastContactAt ?? 0));
}

export function listOrgs() {
  return db.select().from(s.orgs).all();
}