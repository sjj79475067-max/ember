import { db, s } from "@/lib/db";
import { eq, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { listAssets } from "./assets";
import { DAY } from "./affairs-common";

export type CalEvent = {
  id: string; kind: "item" | "milestone" | "asset" | "purchase" | "deal" | "trip"; title: string;
  start: number; end?: number; allDay: boolean; href: string; projectId?: string | null; tone: "default" | "warn" | "danger" | "ok" | "brand"; note?: string;
};

/** 所有带日期的东西合到一张日历：事项截止、阶段节点、台账到期、采购需到货、合作下一步、行程 */
export function agenda(from: number, to: number): CalEvent[] {
  const t = nowSec();
  const out: CalEvent[] = [];
  const projects = new Map(db.select().from(s.projects).all().map((p) => [p.id, p]));
  for (const i of db.select().from(s.items).all()) {
    if (!i.dueAt || i.dueAt < from || i.dueAt > to || i.status === "dropped" || i.parkingLot != null) continue;
    if (projects.get(i.projectId)?.status === "archived") continue;
    const late = i.dueAt < t && i.status !== "done";
    out.push({ id: `item:${i.id}`, kind: "item", title: i.title, start: i.dueAt, allDay: true, href: `/p/${i.projectId}?tab=checklist`, projectId: i.projectId, tone: i.status === "done" ? "ok" : late ? "danger" : i.priority === "P0" ? "warn" : "default", note: projects.get(i.projectId)?.name });
  }
  for (const m of db.select().from(s.milestones).all()) {
    if (!m.dueAt || m.dueAt < from || m.dueAt > to || m.status === "cancelled") continue;
    out.push({ id: `ms:${m.id}`, kind: "milestone", title: `阶段「${m.name}」截止`, start: m.dueAt, allDay: true, href: `/p/${m.projectId}`, projectId: m.projectId, tone: m.status === "done" ? "ok" : "brand", note: projects.get(m.projectId)?.name });
  }
  for (const a of listAssets()) {
    if (!a.validUntil || a.validUntil < from || a.validUntil > to || a.status === "revoked") continue;
    out.push({ id: `asset:${a.id}`, kind: "asset", title: `${a.name} 到期`, start: a.validUntil, allDay: true, href: `/affairs?tab=assets`, projectId: a.projectId, tone: a.state === "expired" ? "danger" : "warn", note: a.consequence });
  }
  for (const p of db.select().from(s.purchases).all()) {
    if (!p.neededBy || p.neededBy < from || p.neededBy > to || ["received", "in_use", "returned", "retired"].includes(p.status)) continue;
    out.push({ id: `pur:${p.id}`, kind: "purchase", title: `需到货：${p.title}`, start: p.neededBy, allDay: true, href: `/affairs?tab=purchases`, projectId: p.projectId, tone: p.neededBy < t ? "danger" : "default" });
  }
  for (const d of db.select().from(s.deals).all()) {
    if (!d.nextStepAt || d.nextStepAt < from || d.nextStepAt > to || ["won", "lost"].includes(d.stage)) continue;
    out.push({ id: `deal:${d.id}`, kind: "deal", title: `${d.title}：${d.nextStep || "下一步"}`, start: d.nextStepAt, allDay: false, href: `/affairs?tab=deals`, tone: d.nextStepAt < t ? "danger" : "brand" });
  }
  for (const tr of db.select().from(s.trips).all()) {
    if (tr.endAt < from || tr.startAt > to) continue;
    out.push({ id: `trip:${tr.id}`, kind: "trip", title: `出行：${tr.title}${tr.city ? `（${tr.city}）` : ""}`, start: tr.startAt, end: tr.endAt, allDay: false, href: `/affairs?tab=trips`, projectId: tr.projectId, tone: "brand" });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------- ICS 订阅 ----------
export function mintFeed(name: string, actor: Actor) {
  const raw = `cal_${randomBytes(20).toString("base64url")}`;
  const id = newId("cal");
  db.insert(s.calendarFeeds).values({ id, name: name.slice(0, 40) || "手机日历", tokenHash: createHash("sha256").update(raw).digest("hex"), prefix: raw.slice(0, 10), createdAt: nowSec() }).run();
  audit(actor, "calendar.mint", "calendar", id, { name });
  return { id, raw };
}

export function revokeFeed(id: string, actor: Actor) {
  db.update(s.calendarFeeds).set({ revokedAt: nowSec() }).where(eq(s.calendarFeeds.id, id)).run();
  audit(actor, "calendar.revoke", "calendar", id, {});
  return { ok: true };
}

export function listFeeds() {
  return db.select().from(s.calendarFeeds).where(isNull(s.calendarFeeds.revokedAt)).all().map((f) => ({ id: f.id, name: f.name, prefix: f.prefix, lastUsedAt: f.lastUsedAt, createdAt: f.createdAt }));
}

export function feedByToken(raw: string) {
  const hash = createHash("sha256").update(raw).digest("hex");
  const f = db.select().from(s.calendarFeeds).where(eq(s.calendarFeeds.tokenHash, hash)).get();
  if (!f || f.revokedAt) return null;
  db.update(s.calendarFeeds).set({ lastUsedAt: nowSec() }).where(eq(s.calendarFeeds.id, f.id)).run();
  return f;
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const ymd = (ts: number) => { const d = new Date(ts * 1000); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };
const utc = (ts: number) => new Date(ts * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** RFC 5545：行长超过 75 字节要折行 */
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 73) { out.push(cur); cur = " " + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function renderIcs(base: string) {
  const now = nowSec();
  const evs = agenda(now - 30 * DAY, now + 400 * DAY);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ember//事务中心//ZH", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Ember 事务", "X-WR-TIMEZONE:Asia/Shanghai", "REFRESH-INTERVAL;VALUE=DURATION:PT1H"];
  for (const e of evs) {
    lines.push("BEGIN:VEVENT", `UID:${e.id}@ember`, `DTSTAMP:${utc(now)}`);
    if (e.allDay) { lines.push(`DTSTART;VALUE=DATE:${ymd(e.start)}`, `DTEND;VALUE=DATE:${ymd(e.start + DAY)}`); }
    else { lines.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end ?? e.start + 3600)}`); }
    lines.push(`SUMMARY:${esc(e.title)}`, `URL:${base}${e.href}`);
    if (e.note) lines.push(`DESCRIPTION:${esc(e.note)}`);
    // 截止类事件提前一天提醒
    if (e.kind !== "trip") lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, "TRIGGER:-P1D", "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}