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
  const openItems = db.select().from(s.items).where(sql`(${s.items.status} in ('todo','doing','blocked','changed')) and ${s.items.parkingLot} is null`).all();
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
  // 条例生命周期：待批准 / 将过期 / 该复核
  const allPolicies = db.select().from(s.policies).where(eq(s.policies.active, 1)).all();
  for (const p of allPolicies) {
    if (p.status === "pending") {
      upsert({ kind: "review", severity: "P1", title: `条例待批准：${p.title}`, bodyMd: `由 ${p.proposedBy || "agent"} 起草，${p.required ? "设为必读，" : ""}批准后才生效。到「条例」页审阅。`, projectId: p.projectId, targetType: "policy", targetId: p.id, dedupeKey: `policy-pending:${p.id}:v${p.version}` });
    }
    if (p.status === "active" && p.expiresAt && p.expiresAt > t && p.expiresAt - t <= 7 * DAY) {
      upsert({ kind: "review", severity: "P2", title: `条例即将过期：${p.title}`, bodyMd: `${iso(p.expiresAt)} 到期；到期后自动失效。如仍需要请续期。`, projectId: p.projectId, targetType: "policy", targetId: p.id, dedupeKey: `policy-expiring:${p.id}:${ymdWeek(t)}` });
    }
    if (p.status === "active" && p.reviewEveryDays) {
      const last = p.lastReviewedAt ?? p.approvedAt ?? p.updatedAt;
      if (t - last > p.reviewEveryDays * DAY) {
        upsert({ kind: "review", severity: "P2", title: `条例该复核了：${p.title}`, bodyMd: `已 ${Math.floor((t - last) / DAY)} 天未复核（周期 ${p.reviewEveryDays} 天）。确认仍然适用，或废止。`, projectId: p.projectId, targetType: "policy", targetId: p.id, dedupeKey: `policy-review:${p.id}:${ymdWeek(t)}` });
      }
    }
  }
  // 完成证据像进度：任务被标完成但证据没说清做到什么程度，提醒核实
  const suspicious = db.select().from(s.items).where(eq(s.items.needsReview, 1)).all();
  for (const it of suspicious) {
    upsert({ kind: "review", severity: "P1", title: `完成证据待核实：${it.title}`, bodyMd: `证据：「${it.evidence.slice(0, 120)}」。读起来像进度而不是完成结果：确认已做完则补写验收结论；没做完请改回进行中并记录进展。`, projectId: it.projectId, targetId: it.id, dedupeKey: `needs-review:${it.id}:v${it.version}` });
  }
  // 收件箱积压
  const inbox = db.select().from(s.projects).where(eq(s.projects.isInbox, 1)).get();
  if (inbox) {
    const parked = db.select({ n: sql<number>`count(*)` }).from(s.items).where(and(eq(s.items.projectId, inbox.id), sql`${s.items.status} in ('todo','doing','blocked','changed')`)).get()?.n ?? 0;
    if (parked > 0) upsert({ kind: "review", severity: "P2", title: `收件箱有 ${parked} 条待分拣`, bodyMd: "这些任务还没归属项目，不会出现在项目进度里。请分拣到对应项目，或交给 agent 处理。", projectId: inbox.id, targetType: "project", targetId: inbox.id, dedupeKey: `inbox:${ymd(t)}` });
  }
  return countOpen();
}

export function listUnackedPolicies() {
  const t = nowSec();
  const ps = db.select().from(s.policies).where(and(eq(s.policies.required, 1), eq(s.policies.active, 1), eq(s.policies.status, "active"))).all()
    .filter((p) => !p.expiresAt || p.expiresAt > t);
  const acks = db.select().from(s.policyAcks).all();
  return ps.filter((p) => !acks.some((a) => a.policyId === p.id && a.policyVersion === p.version && a.actorName === "*"));
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
