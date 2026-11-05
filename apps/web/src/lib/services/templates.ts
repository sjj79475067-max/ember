import { db, s } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { TEMPLATES, getTemplate } from "./template-defs";
import { addDep } from "./deps";
import { nextOccurrence } from "./recur";

export function listTemplates() {
  return TEMPLATES.map((t) => ({
    key: t.key, name: t.name, description: t.description,
    phases: t.phases.map((p) => p.name), items: t.items.length,
    compliance: t.items.filter((i) => ["compliance", "account"].includes(i.kind)).map((i) => i.title),
  }));
}

/**
 * 应用模板（幂等）：已存在的同名阶段复用，已由同一模板建过的事项（templateKey 相同）跳过。
 * 可以在已有项目上补用模板 —— 只补缺的，不动用户已经改过的内容。
 */
export function applyTemplate(projectId: string, key: string, actor: Actor) {
  const tpl = getTemplate(key);
  if (!tpl) throw Object.assign(new Error(`没有模板「${key}」。可选：${TEMPLATES.map((t) => t.key).join(", ")}`), { status: 404 });
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) throw Object.assign(new Error("项目不存在"), { status: 404 });
  if (project.isInbox === 1) throw Object.assign(new Error("收件箱不能套用模板"), { status: 422 });
  const t = nowSec();
  const created = { milestones: 0, items: 0, deps: 0, skipped: 0 };
  const msByName = new Map<string, string>();
  const keyToItem = new Map<string, string>();

  db.transaction(() => {
    const existingMs = db.select().from(s.milestones).where(eq(s.milestones.projectId, projectId)).all();
    let pos = existingMs.reduce((m, x) => Math.max(m, x.position), -1);
    tpl.phases.forEach((ph, idx) => {
      const found = existingMs.find((m) => m.name === ph.name);
      if (found) { msByName.set(ph.name, found.id); return; }
      const id = newId("ms");
      pos += 1;
      db.insert(s.milestones).values({
        id, projectId, name: ph.name, kind: ph.kind ?? "phase", goal: ph.goal, position: pos,
        status: existingMs.length === 0 && idx === 0 ? "active" : "planned", templateKey: `${key}:${ph.name}`,
        createdAt: t, updatedAt: t,
      }).run();
      msByName.set(ph.name, id);
      created.milestones++;
    });

    const existingItems = db.select().from(s.items).where(eq(s.items.projectId, projectId)).all();
    for (const it of existingItems) if (it.templateKey) keyToItem.set(it.templateKey.split(":").pop()!, it.id);
    let maxPos = db.select({ m: sql<number>`coalesce(max(${s.items.position}),0)` }).from(s.items).where(eq(s.items.projectId, projectId)).get()?.m ?? 0;
    for (const it of tpl.items) {
      if (keyToItem.has(it.key)) { created.skipped++; continue; }
      const id = newId("itm");
      maxPos += 1;
      db.insert(s.items).values({
        id, projectId, title: it.title, detailMd: it.detail ?? "", doneDefinition: it.doneDefinition ?? "",
        kind: it.kind, milestoneId: it.phase ? msByName.get(it.phase) ?? null : null, mustMeet: it.mustMeet ? 1 : 0,
        leadTimeDays: it.leadTimeDays ?? null, priority: it.priority ?? "P1", templateKey: `${key}:${it.key}`,
        recurRule: it.recur ?? "", dueAt: it.recur ? nextOccurrence(it.recur, t - 1) : null,
        sourceType: "manual", sourceRef: `template:${key}`, position: maxPos, createdAt: t, updatedAt: t,
      }).run();
      db.insert(s.itemEvents).values({ id: newId("evt"), itemId: id, actorType: actor.type, actorName: actor.name, action: "create", toStatus: "todo", note: `来自模板「${tpl.name}」`, createdAt: t }).run();
      keyToItem.set(it.key, id);
      created.items++;
    }
  });

  // 依赖在事务外逐条加（addDep 内含环检测与查重）
  for (const it of tpl.items) {
    for (const d of it.deps ?? []) {
      const a = keyToItem.get(d), b = keyToItem.get(it.key);
      if (!a || !b) continue;
      const before = db.select().from(s.itemDeps).where(and(eq(s.itemDeps.blockerId, a), eq(s.itemDeps.blockedId, b))).get();
      if (before) continue;
      try { addDep(a, b, actor); created.deps++; } catch { /* 用户手动调整过导致成环时跳过 */ }
    }
  }
  if (!project.template) db.update(s.projects).set({ template: key, updatedAt: t }).where(eq(s.projects.id, projectId)).run();
  audit(actor, "template.apply", "project", projectId, { key, ...created });
  return { template: key, name: tpl.name, ...created };
}