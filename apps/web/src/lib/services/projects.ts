import { db, s } from "@/lib/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";

export type ProjectInput = {
  key: string; name: string; kind?: "it" | "admin" | "client" | "knowledge";
  status?: "active" | "paused" | "done" | "archived"; summaryMd?: string;
  dueAt?: number | null; localRoot?: string; githubRepo?: string; archiveNote?: string;
};

export function listProjects(opts: { status?: string; q?: string; includeArchived?: boolean; includeInbox?: boolean } = {}) {
  const rows = db.select().from(s.projects).orderBy(asc(s.projects.position), desc(s.projects.updatedAt)).all();
  const counts = db.select({
    projectId: s.items.projectId,
    total: sql<number>`count(*)`,
    done: sql<number>`sum(case when ${s.items.status}='done' then 1 else 0 end)`,
    blocked: sql<number>`sum(case when ${s.items.status}='blocked' then 1 else 0 end)`,
    overdue: sql<number>`sum(case when ${s.items.dueAt} is not null and ${s.items.dueAt} < ${nowSecSi()} and ${s.items.status} not in ('done','dropped') then 1 else 0 end)`,
    parked: sql<number>`sum(case when ${s.items.parkingLot} is not null then 1 else 0 end)`,
  }).from(s.items).groupBy(s.items.projectId).all();
  const cmap = new Map(counts.map((c) => [c.projectId, c]));
  let out = rows.map((p) => {
    const c = cmap.get(p.id);
    const parked = c?.parked ?? 0;
    return { ...p, progress: { total: (c?.total ?? 0) - parked, done: (c?.done ?? 0), blocked: c?.blocked ?? 0, overdue: c?.overdue ?? 0, parked } };
  });
  if (!opts.includeArchived) out = out.filter((p) => p.status !== "archived");
  if (!opts.includeInbox) out = out.filter((p) => p.isInbox !== 1);
  if (opts.status) out = out.filter((p) => p.status === opts.status);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    out = out.filter((p) => p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q));
  }
  return out;
}

const nowSecSi = () => Math.floor(Date.now() / 1000);

export const INBOX_KEY = "INBOX";

/** 收件箱：唯一的未归类项目。所有「不知道该放哪」的内容先落这里，再由人或 agent 分拣。 */
export function ensureInbox() {
  const cur = db.select().from(s.projects).where(eq(s.projects.isInbox, 1)).get();
  if (cur) return cur;
  const t = nowSec();
  const id = newId("prj");
  db.insert(s.projects).values({
    id, key: INBOX_KEY, name: "收件箱 · 待分拣", kind: "admin", status: "active", isInbox: 1,
    summaryMd: "未归类的事项、笔记、会议先放这里，由你或 agent 用 item_move / 导入时指定项目后分拣走。收件箱不计入项目进度。",
    createdAt: t, updatedAt: t,
  }).run();
  return db.select().from(s.projects).where(eq(s.projects.id, id)).get()!;
}

export function getInbox() {
  return db.select().from(s.projects).where(eq(s.projects.isInbox, 1)).get() ?? ensureInbox();
}

/** 按 id、key（不区分大小写）或别名（aliases，逗号分隔）解析项目 */
export function getProject(idOrKey: string) {
  const k = (idOrKey ?? "").trim();
  if (!k) return null;
  let p = db.select().from(s.projects).where(sql`${s.projects.id} = ${k}`).get();
  if (!p) p = db.select().from(s.projects).where(sql`lower(${s.projects.key}) = lower(${k})`).get();
  if (!p) {
    // 别名命中：只接受精确别名（含收件箱的中文名），避免模糊匹配串项目
    const all = db.select().from(s.projects).all();
    p = all.find((x) => (x.aliases ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean).includes(k.toLowerCase())
      || (x.isInbox === 1 && ["收件箱", "inbox", "未归类", "待分拣"].includes(k.toLowerCase())));
  }
  if (!p) return null;
  const ws = db.select().from(s.workstreams).where(eq(s.workstreams.projectId, p.id)).orderBy(asc(s.workstreams.position)).all();
  const items = db.select().from(s.items).where(eq(s.items.projectId, p.id)).orderBy(asc(s.items.position), asc(s.items.createdAt)).all();
  const files = db.select().from(s.fileRefs).where(eq(s.fileRefs.projectId, p.id)).all();
  const recentMeetings = db.select().from(s.meetings).where(eq(s.meetings.projectId, p.id)).orderBy(desc(s.meetings.heldAt)).limit(5).all();
  const recentDecisions = db.select().from(s.decisions).where(eq(s.decisions.projectId, p.id)).orderBy(desc(s.decisions.createdAt)).limit(5).all();
  const rules = db.select().from(s.policies).where(eq(s.policies.projectId, p.id)).all();
  return { ...p, workstreams: ws, items, files, meetings: recentMeetings, decisions: recentDecisions, policies: rules };
}

export function resolveProjectOrNull(idOrKey: string | null | undefined) {
  if (!idOrKey) return null;
  const p = getProject(idOrKey);
  if (!p) {
    const list = db.select({ key: s.projects.key, name: s.projects.name }).from(s.projects).all();
    throw Object.assign(new Error(`找不到项目「${idOrKey}」。不会把它写进别的项目。现有项目：${list.map((x) => `${x.key}(${x.name})`).join("、")}。若确实不知道归属，请传 project="${INBOX_KEY}" 或省略 project 让内容进收件箱。`), { status: 404 });
  }
  return p;
}

export function createProject(input: ProjectInput, actor: Actor, ip = "") {
  const dup = db.select().from(s.projects).where(eq(s.projects.key, input.key)).get();
  if (dup) throw Object.assign(new Error(`项目代号 ${input.key} 已存在`), { status: 409 });
  // 代号或别名与已有项目撞车：拒绝，避免 agent 把内容写进错误的项目
  const allKeys = db.select().from(s.projects).all().flatMap((x) => [x.key.toLowerCase(), ...(x.aliases ?? "").split(",").map((a) => a.trim().toLowerCase())]).filter(Boolean);
  if (allKeys.includes(input.key.toLowerCase())) throw Object.assign(new Error(`项目代号 ${input.key} 与现有项目/别名重复，换一个代号`), { status: 409 });
  const id = newId("prj");
  db.insert(s.projects).values({
    id, key: input.key, name: input.name, kind: input.kind ?? "admin", status: input.status ?? "active",
    summaryMd: input.summaryMd ?? "", dueAt: input.dueAt ?? null, localRoot: input.localRoot ?? "",
    githubRepo: input.githubRepo ?? "", archiveNote: input.archiveNote ?? "", createdAt: nowSec(), updatedAt: nowSec(),
  }).run();
  audit(actor, "project.create", "project", id, { key: input.key }, { ip });
  return getProject(id)!;
}

export function updateProject(idOrKey: string, patch: Partial<ProjectInput>, actor: Actor, ip = "") {
  const p = getProject(idOrKey);
  if (!p) throw Object.assign(new Error("项目不存在"), { status: 404 });
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  db.update(s.projects).set({ ...clean, updatedAt: nowSec() }).where(eq(s.projects.id, p.id)).run();
  audit(actor, "project.update", "project", p.id, clean, { ip });
  return getProject(p.id)!;
}
