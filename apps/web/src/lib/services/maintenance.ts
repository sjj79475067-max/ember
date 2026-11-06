import { db, s } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { createProject, getProject } from "./projects";
import { addItems, addProgress, similar, updateItem } from "./items";
import { createDecision } from "./notes";
import { saveRequirement } from "./requirements";

/**
 * Ember 自己的维护账本（项目代号 EMBER）：
 * - 问题：任何 agent / 你在飞书里反馈的「乱了、记不了、规则不对」。同一个问题再报一次只累计次数和例子，不另起一条。
 * - 决定：已经定下来的做法（为什么这么做、不要推翻重做）。改主意就新记一条并注明取代哪条。
 * - 需求：要的功能、状态、对应事项。
 * 维护 Ember 的 agent 开工先调 maintainer_brief，拿到的就是这份唯一的外部记忆。
 */

export const EMBER_KEY = "EMBER";
export const FEEDBACK_KINDS = { bug: "出错", confusion: "乱了", gap: "记不了", rule: "规则不对", idea: "想法" } as const;
export type FeedbackKind = keyof typeof FEEDBACK_KINDS;

const system: Actor = { type: "user", name: "system" };

export function emberProject() {
  const p = getProject(EMBER_KEY);
  if (p) return p;
  const created = createProject({ key: EMBER_KEY, name: "Ember 维护", kind: "it", summaryMd: "Ember 自己的问题、决定和需求。维护 Ember 的 agent 开工先调 maintainer_brief。" }, system);
  seedBaseline(created.id);
  return created;
}

/**
 * 反馈一个问题。相似的未解决问题已存在 → 记到原条目上（次数 +1、附例子），不新建；
 * 同一问题被反馈 3 次自动升为 P0。
 */
export function reportFeedback(input: { kind: FeedbackKind; title: string; detail?: string; example?: string; where?: string }, actor: Actor) {
  const p = emberProject();
  const kind = (input.kind in FEEDBACK_KINDS ? input.kind : "bug") as FeedbackKind;
  const title = input.title.trim().slice(0, 100);
  if (!title) throw Object.assign(new Error("写一句是什么问题"), { status: 422 });
  const line = [input.where && `在：${input.where}`, input.example && `例子：${input.example.slice(0, 500)}`, input.detail?.slice(0, 1000)].filter(Boolean).join("\n");
  const open = db.select().from(s.items).where(and(eq(s.items.projectId, p.id), sql`${s.items.status} in ('todo','doing','blocked','changed')`)).all();
  const strip = (t: string) => t.replace(/^\[[^\]]+\]\s*/, "");
  const same = open.find((i) => similar(strip(i.title), title));
  if (same) {
    const times = (same.detailMd.match(/【/g) ?? []).length + 2; // 首次 + 每次进展
    addProgress(same.id, `又一次（${actor.type === "agent" ? `agent ${actor.name}` : actor.name}）：${title}${line ? `\n${line}` : ""}`, actor);
    if (times >= 3 && same.priority !== "P0") updateItem(same.id, { priority: "P0" }, system);
    audit(actor, "feedback.merge", "item", same.id, { kind });
    return { id: same.id, merged: true, times };
  }
  const r = addItems(p.id, [{
    title: `[${FEEDBACK_KINDS[kind]}] ${title}`, detailMd: `反馈人：${actor.type === "agent" ? `agent ${actor.name}` : actor.name}${line ? `\n${line}` : ""}`,
    kind: kind === "gap" || kind === "idea" ? "feature" : "risk", priority: kind === "bug" ? "P1" : "P2", sourceType: actor.type === "agent" ? "agent" : "manual",
  }], actor);
  audit(actor, "feedback.create", "item", r.byIndex[0] ?? "", { kind });
  return { id: r.byIndex[0]!, merged: false, times: 1 };
}

/** 维护者开工包：没解决的问题（按次数）、已定的决定（不要推翻）、需求状态、手册位置 */
export function maintainerBrief() {
  const p = emberProject();
  const items = db.select().from(s.items).where(eq(s.items.projectId, p.id)).all();
  const open = items.filter((i) => ["todo", "doing", "blocked", "changed"].includes(i.status))
    .map((i) => ({ id: i.id, title: i.title, priority: i.priority, status: i.status, times: (i.detailMd.match(/【/g) ?? []).length + 1, detail: i.detailMd.slice(-600), updatedAt: i.updatedAt }))
    .sort((a, b) => a.priority.localeCompare(b.priority) || b.times - a.times);
  const recentlyFixed = items.filter((i) => i.status === "done" && (i.completedAt ?? 0) > nowSec() - 30 * 86400).map((i) => ({ title: i.title, evidence: i.evidence.slice(0, 200) }));
  const decisions = db.select().from(s.decisions).where(eq(s.decisions.projectId, p.id)).all()
    .filter((d) => d.status !== "superseded").sort((a, b) => b.createdAt - a.createdAt)
    .map((d) => ({ id: d.id, title: d.title, why: d.rationaleMd, impact: d.impact }));
  const reqs = db.select().from(s.requirements).where(eq(s.requirements.projectId, p.id)).all()
    .map((r) => ({ code: r.code, title: r.title, status: r.status }));
  return {
    project: { id: p.id, key: p.key },
    open_issues: open, recently_fixed: recentlyFixed, decisions, requirements: reqs,
    manual: "仓库 docs/MAINTAINER.md（架构、红线、部署、测试）；功能细则 docs/SPEC*.md。",
    how: [
      "1. 先看 decisions：这里是已经定下来的做法，不要推翻重做；确实要改，先问用户，改完用 decision_record 记新决定并在 impact 里写「取代：原决定标题」。",
      "2. 再看 open_issues：按优先级和次数处理。修好后 checklist_update status=done，evidence 写改了什么、怎么验证的、哪个提交。",
      "3. 用户提的新要求先 requirement_save(project='EMBER') 记下来，再动手。",
      "4. 改完同步更新 docs/MAINTAINER.md 里受影响的部分。",
    ],
  };
}

/** 基线：这段时间已经定下来的事。只在首次建 EMBER 项目时写入一次。 */
function seedBaseline(projectId: string) {
  const D: Array<[string, string, string]> = [
    ["agent 只能提议，关键决定只有用户能做", "条例生效、阶段放行、需求放弃、随手记落库都必须用户在网页/飞书确认。agent 写的条例是待批准，写的复盘是草稿。", "不要给 agent 加绕过确认的口子"],
    ["同一件事的进展记在原事项上，不另起一条（防流水账）", "checklist_progress 记进展；相似标题自动合并；完成证据像进度则标待核实；需求变了用 checklist_supersede 升版本。", "新功能凡是会产生记录的，都要先考虑去重/合并"],
    ["导入的会议默认只归档，不自动拆清单", "用户导会议主要为了留档，清单由用户自己整理或让 agent 按需整理。", "不要改回默认抽取"],
    ["P0 不自动进「今日」，今天做什么由用户挑", "模板里大量 P0 合规项会把今日淹没（曾出现 18 条）。只放逾期、今天到期、计划的、自己在做的。", ""],
    ["不做燃尽图/速度图等团队类开发图表", "一人公司没有冲刺和故事点。现有完成环、阶段条、能否发版、甘特、依赖图已够用；以后范围膨胀明显再考虑阶段燃起图。", ""],
    ["Ember 不存任何密码和密钥原文", "台账只记 secret_ref（保存位置）；写入时检测到疑似密码/Key 直接拒绝。飞书 Secret、AI Key 加密存库。", ""],
    ["员工管理、教务、填报用飞书自带（任务/多维表格/知识库），不在 Ember 里重做", "Ember 只支持单用户；需要时只做「把一句话转成飞书任务并记进在等别人」的桥。", "未经用户确认不要开始多用户/员工功能"],
    ["飞书只当入口和通知，规则和账本在 Ember", "数据只放一处，避免两边各一份。飞书机器人只认绑定的本人；同一个机器人只让正式实例连。", "开发实例（3100）不要启用飞书"],
    ["字段策略：核心字段固定，AI 可补充附加信息", "项目、类型、截止、状态、在等谁等参与计算的字段固定；AI 看出的其他信息放附加信息供核对。常用的再升级为正式字段。不让 AI 改库结构。", ""],
    ["开发与测试只用 3100 端口的独立实例", "绝不对正式实例（3000、数据卷 ember_ember-data）跑测试、不用用户真实密码、不重置密码；每次部署前先 scripts/backup.sh。", "这是红线"],
  ];
  for (const [title, why, impact] of D) createDecision({ projectId, title, rationaleMd: why, impact }, system);
  const R: Array<[string, "accepted" | "done"]> = [
    ["项目看板：阶段、必过项、能否发版、甘特与依赖图", "done"],
    ["资质/账号/域名/证书/合同到期台账与分档提醒", "done"],
    ["采购比价、客户合作、行程、公司固定日历与手机日历订阅", "done"],
    ["秘书层：今日、在等别人与催办、自动顺延、需要你拍板、每周复盘", "done"],
    ["随手记：飞书/快捷指令/网页 → 草稿 → 本人确认后落库", "done"],
    ["到点提醒（如「明天八点半向我问安」）", "done"],
    ["问题汇集与维护账本：各 agent 反馈汇到一处，维护者有唯一的外部记忆", "done"],
    ["自动备份（每天一次，保留 30 份，另存一份到外部）", "accepted"],
    ["收款与回款跟踪", "accepted"],
    ["简报与到期提醒定时推到飞书", "accepted"],
    ["打印版与 Excel 导出", "accepted"],
    ["随手记/事项的「附加信息」（AI 自由补充、可核对）", "accepted"],
  ];
  for (const [title, status] of R) {
    const r = saveRequirement({ projectId, title, source: "与用户的开发对话", status: "accepted" }, system);
    if (status === "done") db.update(s.requirements).set({ status: "done", closeReason: "已上线" }).where(eq(s.requirements.id, r.id)).run();
  }
}
