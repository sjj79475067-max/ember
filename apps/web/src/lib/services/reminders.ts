import { db, s } from "@/lib/db";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";

type Upsum = { title: string; bodyMd: string; kind: "due" | "overdue" | "blocked" | "policy" | "stale_file" | "review" | "digest"; severity: "P0" | "P1" | "P2"; projectId?: string | null; targetType?: string; targetId?: string; dedupeKey: string };

function upsert(r: Upsum) {
  const existing = db.select().from(s.reminders).where(eq(s.reminders.dedupeKey, r.dedupeKey)).get();
  if (existing) {
    if (existing.status === "done") return;
    db.update(s.reminders).set({ title: r.title, bodyMd: r.bodyMd, severity: r.severity, updatedAt: nowSec() }).where(eq(s.reminders.id, existing.id)).run();
    return;
  }
  db.insert(s.reminders).values({
    id: newId("rem"), projectId: r.projectId ?? null, targetType: r.targetType ?? "item", targetId: r.targetId ?? "",
    kind: r.kind, severity: r.severity, title: r.title, bodyMd: r.bodyMd, dedupeKey: r.dedupeKey,
    status: "open", createdAt: nowSec(), updatedAt: nowSec(),
  }).run();
}

const DAY = 86400;

export function refreshReminders() {
  const t = nowSec();
  const openItems = db.select().from(s.items).where(sql`${s.items.status} in ('todo','doing','blocked','changed')`).all();
  for (const it of openItems) {
    const dueIn = it.dueAt ? it.dueAt - t : null;
    if (it.dueAt && dueIn! < 0) {
      upsert({ kind: "overdue", severity: "P0", title: `逾期：${it.title}`, bodyMd: `截止 ${iso(it.dueAt)}，当前状态 ${it.status}`, projectId: it.projectId, targetId: it.id, dedupeKey: `overdue:${it.id}:${ymd(t)}` });
    } else if (dueIn != null && dueIn <= 3 * DAY) {
      upsert({ kind: "due", severity: "P1", title: `即将到期：${it.title}`, bodyMd: `剩余 ${Math.ceil(dueIn / DAY)} 天（${iso(it.dueAt!)}）`, projectId: it.projectId, targetId: it.id, dedupeKey: `due:${it.id}:${ymd(t)}` });
    }
    if (it.status === "blocked") {
      upsert({ kind: "blocked", severity: "P1", title: `阻塞：${it.title}`, bodyMd: it.blockReason || "未说明原因，请补充", projectId: it.projectId, targetId: it.id, dedupeKey: `blocked:${it.id}` });
    }
  }
  // 资料陈旧
  const stale = db.select().from(s.fileRefs).where(or(eq(s.fileRefs.status, "missing"), sql`${s.fileRefs.lastVerifiedAt} is null or ${s.fileRefs.lastVerifiedAt} < ${t - 30 * DAY}`)).all();
  for (const f of stale) {
    upsert({ kind: "stale_file", severity: f.status === "missing" ? "P0" : "P2", title: `资料需核验：${f.label}`, bodyMd: `${f.machine ? f.machine + ":" : ""}${f.path || f.url}`, projectId: f.projectId, targetType: "file", targetId: f.id, dedupeKey: `stale:${f.id}:${ymdWeek(t)}` });
  }
  // 必读条例未读
  const expiring = listUnackedPolicies();
  for (const p of expiring) {
    upsert({ kind: "policy", severity: "P1", title: `条例待确认：${p.title}`, bodyMd: `版本 v${p.version}，请先阅读再操作`, projectId: p.projectId, targetType: "policy", targetId: p.id, dedupeKey: `policy:${p.id}:v${p.version}` });
  }
  return countOpen();
}

export function listUnackedPolicies() {
  const ps = db.select().from(s.policies).where(and(eq(s.policies.required, 1), eq(s.policies.active, 1))).all();
  const acks = db.select().from(s.policyAcks).all();
  return ps.filter((p) => !acks.some((a) => a.policyId === p.id && a.policyVersion === p.version));
}

export function countOpen() {
  return db.select({ n: sql<number>`count(*)` }).from(s.reminders).where(eq(s.reminders.status, "open")).get()?.n ?? 0;
}

export function pullReminders(opts: { projectId?: string; actorName?: string; includeAcked?: boolean; limit?: number } = {}) {
  refreshReminders();
  const conds = [inArray(s.reminders.status, opts.includeAcked ? ["open", "acked", "snoozed"] : ["open"])];
  if (opts.projectId) conds.push(or(eq(s.reminders.projectId, opts.projectId), sql`${s.reminders.projectId} is null`)!);
  if (!opts.includeAcked) conds.push(or(sql`${s.reminders.snoozedUntil} is null`, lte(s.reminders.snoozedUntil, nowSec()))!);
  const rows = db.select().from(s.reminders).where(and(...conds))
    .orderBy(sql`case ${s.reminders.severity} when 'P0' then 0 when 'P1' then 1 else 2 end`, sql`${s.reminders.createdAt} desc`)
    .limit(Math.min(opts.limit ?? 50, 200)).all();
  return rows;
}

export function ackReminders(ids: string[], actor: Actor, action: "ack" | "snooze" | "done" = "ack", snoozeHours = 24) {
  if (!ids.length) return 0;
  const set = action === "ack"
    ? { status: "acked" as const, ackedAt: nowSec(), ackedBy: actor.name, updatedAt: nowSec() }
    : action === "snooze"
      ? { status: "snoozed" as const, snoozedUntil: nowSec() + snoozeHours * 3600, ackedBy: actor.name, updatedAt: nowSec() }
      : { status: "done" as const, updatedAt: nowSec() };
  const res = db.update(s.reminders).set(set).where(inArray(s.reminders.id, ids)).run();
  return res.changes;
}

export function pendingSummary() {
  refreshReminders();
  const rows = db.select({ kind: s.reminders.kind, n: sql<number>`count(*)` }).from(s.reminders).where(eq(s.reminders.status, "open")).groupBy(s.reminders.kind).all();
  const total = rows.reduce((a, r) => a + r.n, 0);
  return { total, byKind: Object.fromEntries(rows.map((r) => [r.kind, r.n])) };
}

const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ");
const ymd = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const ymdWeek = (s: number) => { const d = new Date(s * 1000); const onejan = new Date(d.getFullYear(), 0, 1); const wk = Math.ceil(((+d - +onejan) / 86400000 + onejan.getDay() + 1) / 7); return `${d.getFullYear()}-w${wk}`; };
