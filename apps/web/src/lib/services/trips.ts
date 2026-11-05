import { db, s } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { rejectSecrets, ownedItems, companyProjectId, DAY } from "./affairs-common";
import { addItems } from "./items";

export type Leg = { type?: string; no?: string; from?: string; to?: string; departAt?: number; arriveAt?: number; orderNo?: string; note?: string };
export type Lodging = { name?: string; address?: string; checkIn?: number; checkOut?: number; orderNo?: string };

export type TripInput = {
  id?: string; title?: string; purpose?: string; city?: string; startAt?: number; endAt?: number; dealId?: string | null; projectId?: string | null;
  legs?: Leg[]; lodging?: Lodging[]; attendees?: string; notesMd?: string; withPrep?: boolean;
};

/** 出行准备默认清单（行前 + 行后），挂在行程下，按出发日倒排截止 */
const PREP: Array<{ title: string; offsetDays: number; after?: boolean }> = [
  { title: "订往返交通", offsetDays: -7 },
  { title: "订住宿", offsetDays: -5 },
  { title: "确认会面时间地点与对接人", offsetDays: -2 },
  { title: "准备资料（方案、报价、合同、名片、样品）", offsetDays: -1 },
  { title: "整理票据并报销", offsetDays: 3, after: true },
  { title: "会面纪要归档、下一步写进合作", offsetDays: 1, after: true },
];

export function tripView(t: typeof s.trips.$inferSelect) {
  const now = nowSec();
  const prep = ownedItems("trip", t.id).map((i) => ({ id: i.id, title: i.title, status: i.status, dueAt: i.dueAt }));
  return {
    ...t, legs: JSON.parse(t.legsJson || "[]") as Leg[], lodging: JSON.parse(t.lodgingJson || "[]") as Lodging[],
    prep, prepOpen: prep.filter((p) => !["done", "dropped"].includes(p.status)).length,
    phase: now < t.startAt ? "upcoming" : now <= t.endAt ? "ongoing" : "past",
    daysToStart: Math.ceil((t.startAt - now) / DAY),
  };
}

export function listTrips(opts: { upcoming?: boolean } = {}) {
  let rows = db.select().from(s.trips).orderBy(asc(s.trips.startAt)).all();
  if (opts.upcoming) rows = rows.filter((r) => r.endAt >= nowSec() - 7 * DAY);
  return rows.map(tripView);
}

export function saveTrip(input: TripInput, actor: Actor) {
  rejectSecrets({ title: input.title, notes: input.notesMd, legs: JSON.stringify(input.legs ?? []), lodging: JSON.stringify(input.lodging ?? []) });
  const at = nowSec();
  if (input.startAt && input.endAt && input.endAt < input.startAt) throw Object.assign(new Error("返回时间早于出发时间"), { status: 422 });
  if (!input.id) {
    if (!input.title?.trim() || !input.startAt) throw Object.assign(new Error("行程至少要有标题和出发时间"), { status: 422 });
    const id = newId("trip");
    const endAt = input.endAt ?? input.startAt + DAY;
    db.insert(s.trips).values({
      id, title: input.title.trim().slice(0, 120), purpose: input.purpose ?? "", city: input.city ?? "", startAt: input.startAt, endAt,
      dealId: input.dealId ?? null, projectId: input.projectId ?? null, legsJson: JSON.stringify(input.legs ?? []), lodgingJson: JSON.stringify(input.lodging ?? []),
      attendees: input.attendees ?? "", notesMd: input.notesMd ?? "", createdAt: at, updatedAt: at,
    }).run();
    if (input.withPrep !== false) {
      const pid = input.projectId ?? companyProjectId();
      const res = addItems(pid, PREP.map((p) => ({
        title: `${input.title!.trim().slice(0, 30)}：${p.title}`, kind: "task", dueAt: (p.after ? endAt : input.startAt!) + p.offsetDays * DAY, sourceType: "manual" as const, sourceRef: `trip:${id}`,
      })), actor);
      for (const iid of res.ids) db.update(s.items).set({ ownerType: "trip", ownerId: id }).where(eq(s.items.id, iid)).run();
    }
    audit(actor, "trip.create", "trip", id, { title: input.title });
    return tripView(db.select().from(s.trips).where(eq(s.trips.id, id)).get()!);
  }
  const cur = db.select().from(s.trips).where(eq(s.trips.id, input.id)).get();
  if (!cur) throw Object.assign(new Error("行程不存在"), { status: 404 });
  const set: Record<string, unknown> = { updatedAt: at };
  for (const k of ["title", "purpose", "city", "startAt", "endAt", "dealId", "projectId", "attendees", "notesMd"] as const) if (input[k] !== undefined) set[k] = input[k];
  if (input.legs) set.legsJson = JSON.stringify(input.legs);
  if (input.lodging) set.lodgingJson = JSON.stringify(input.lodging);
  db.update(s.trips).set(set).where(eq(s.trips.id, cur.id)).run();
  // 改了出发日：行前准备的截止日跟着平移（只动没完成的）
  if (input.startAt && input.startAt !== cur.startAt) {
    const shift = input.startAt - cur.startAt;
    for (const it of ownedItems("trip", cur.id)) {
      if (it.dueAt && !["done", "dropped"].includes(it.status)) db.update(s.items).set({ dueAt: it.dueAt + shift, updatedAt: at }).where(eq(s.items.id, it.id)).run();
    }
  }
  audit(actor, "trip.update", "trip", cur.id, input);
  return tripView(db.select().from(s.trips).where(eq(s.trips.id, cur.id)).get()!);
}