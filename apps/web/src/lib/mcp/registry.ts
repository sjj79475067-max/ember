import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Ctx } from "@/lib/http/api";
import { listProjects, getProject, createProject, updateProject, resolveProjectOrNull, getInbox } from "@/lib/services/projects";
import { addItems, listItems, updateItem, claimItem, releaseItem, verifyChecklist, progressFor, moveItem, mergeItems, addProgress, supersedeItem, findDuplicates } from "@/lib/services/items";
import { moveFile } from "@/lib/services/files";
import { listMilestones, saveMilestone, getMilestone } from "@/lib/services/milestones";
import { listRequirements, saveRequirement, getRequirement } from "@/lib/services/requirements";
import { addDep, removeDep } from "@/lib/services/deps";
import { projectBoard, postProjectUpdate, ITEM_KINDS } from "@/lib/services/board";
import { listTemplates, applyTemplate } from "@/lib/services/templates";
import { listAssets, saveAsset, assetFromItem, ASSET_KINDS } from "@/lib/services/assets";
import { listPurchases, savePurchase, addQuote, PURCHASE_STATUS } from "@/lib/services/purchases";
import { listDeals, saveDeal, saveContact, listContacts, DEAL_STAGES } from "@/lib/services/crm";
import { listTrips, saveTrip } from "@/lib/services/trips";
import { agenda } from "@/lib/services/calendar";
import { secretaryOverview, planToday, weeklyMaterial, saveWeeklyReview, localYmd } from "@/lib/services/secretary";
import { addOwnedItems } from "@/lib/services/owned";
import { validRecur } from "@/lib/services/recur";
import { setProjectGroups, listGroups, ensureGroup, setItemGroup } from "@/lib/services/boards";
import { createMeeting, getMeeting, listMeetings, linkItemToMeeting, saveMeetingItemsSnapshot, previewMeetingItems } from "@/lib/services/meetings";
import { ingest } from "@/lib/services/ingest";
import { upsertNote, createDecision, listNotes, listDecisions } from "@/lib/services/notes";
import { registerFile, verifyFile, listFiles } from "@/lib/services/files";
import { pullReminders, ackReminders, pendingSummary } from "@/lib/services/reminders";
import { listPolicies, ackPolicy, upsertPolicy, policyGate, isLive, WRITE_TOOLS } from "@/lib/services/policies";
import { search } from "@/lib/services/search";
import { agentOnboard } from "@/lib/services/onboard";
import { openSession, closeSession, heartbeat, listSessions } from "@/lib/services/agents";
import { db, s } from "@/lib/db";
import { newId } from "@/lib/id";

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  input: z.ZodTypeAny;
  write?: boolean;
  handler: (input: any, ctx: Ctx) => Promise<unknown> | unknown;
};

const iso = z.number().int().describe("Unix 秒级时间戳");

/** 统一返回信封 */
function envelope(data: Record<string, unknown>, hints?: string[]) {
  const rem = pendingSummary();
  const policies = db.select().from(s.policies).all();
  const acks = db.select().from(s.policyAcks).all();
  const unacked = policies.filter((p) => isLive(p) && p.required && !acks.some((a) => a.policyId === p.id && a.policyVersion === p.version));
  return {
    ok: true,
    data,
    hints: hints ?? [],
    reminders_unread: rem,
    policy_gate: unacked.length ? { blocked: true, policies: unacked.map((p) => ({ id: p.id, title: p.title, version: p.version })) } : { blocked: false },
  };
}

function session(ctx: Ctx, ref?: string) {
  return openSession({ tokenId: ctx.tokenId ?? "web", agentName: ctx.actor.name, agentType: "mcp", userId: "" }, { sessionRef: ref, machine: ctx.ip });
}

/** 会话内已确认条例（短 TTL），避免与网页操作时的 actorName 不一致导致反复被拦 */
const ackCache = new Map<string, number>();
export function markPolicyAcked(actorName: string, policyId: string) {
  ackCache.set(`${actorName}:${policyId}`, Date.now() + 10 * 60_000);
}

/** 写操作前检查：项目条例（仅该项目）+ 全局条例（所有写操作）；非写工具不受限 */
function gate(ctx: Ctx, projectId: string | null | undefined, tool: string) {
  if (!WRITE_TOOLS.includes(tool)) return;
  let g = policyGate(projectId ?? null, tool, ctx.actor.name);
  if (!g) return;
  // 全局条例（scope_mode=all）在首次确认本进程内放行，避免同一会话反复被拦
  const remaining = g.policies.filter((p) => (ackCache.get(`${ctx.actor.name}:${p.id}`) ?? 0) < Date.now());
  if (!remaining.length) return;
  throw Object.assign(
    new Error(`${g.reason}：${remaining.map((p) => `${p.title}(v${p.version})`).join("、")}。请先 policy_read 再 policy_ack。`),
    { status: 403, policy_gate: { reason: "policy_unacked", policies: remaining } },
  );
}

const kindEnum = z.enum(ITEM_KINDS as [string, ...string[]]);
const KIND_HELP = "事项类型：feature 功能 / task 一般 / compliance 资质合规（备案、认证）/ account 账号开通 / purchase 采购 / contract 合同 / finance 财务 / release 发布 / risk 风险 / doc 文档";

/** 把阶段名/id、需求编号/id 解析成 id；找不到就报错，不静默丢 */
function resolveStructure(projectId: string, milestone?: string | null, requirement?: string | null) {
  let milestoneId: string | null | undefined = undefined;
  let requirementId: string | null | undefined = undefined;
  if (milestone === null) milestoneId = null;
  else if (milestone) {
    const m = getMilestone(milestone, projectId);
    if (!m || m.projectId !== projectId) throw Object.assign(new Error(`本项目没有阶段「${milestone}」。现有：${listMilestones(projectId).map((x) => x.name).join("、") || "无（可用 milestone_save 或 template_apply 建）"}`), { status: 404 });
    milestoneId = m.id;
  }
  if (requirement === null) requirementId = null;
  else if (requirement) {
    const r = getRequirement(requirement, projectId);
    if (!r || r.projectId !== projectId) throw Object.assign(new Error(`本项目没有需求「${requirement}」`), { status: 404 });
    requirementId = r.id;
  }
  return { milestoneId, requirementId };
}

export const tools: ToolDef[] = [
  {
    name: "onboard",
    title: "开始工作（必先调用）",
    description:
      "每个会话开始时调用一次。返回：你是谁、活跃项目及进度、未读提醒、未确认的必读条例、你之前认领的任务、别人正在做的任务、最近会议，以及标准工作流。调用后按 how_to_work 执行。",
    input: z.object({
      session_ref: z.string().optional().describe("你的会话标识，用来跨调用识别同一个 agent 会话；可传客户端生成的 UUID"),
      machine: z.string().optional().describe("机器名，便于区分多台电脑"),
    }),
    handler: async (i, ctx) => {
      const sess = session(ctx, i.session_ref);
      const data = agentOnboard({ name: ctx.actor.name, sessionId: sess.id });
      return envelope({ session_id: sess.id, ...data });
    },
  },
  {
    name: "sync",
    title: "心跳 + 拉提醒",
    description:
      "长时间工作时每 20-30 分钟调用一次：刷新会话心跳，返回最新未读提醒与你自己认领的任务。也可以用它确认某个项目的最新提醒。",
    input: z.object({ session_id: z.string(), project_id: z.string().optional() }),
    handler: async (i) => {
      heartbeat(i.session_id);
      const rows = pullReminders({ projectId: i.project_id });
      return envelope({ reminders: rows.map((r) => ({ id: r.id, kind: r.kind, severity: r.severity, title: r.title, body: r.bodyMd, project_id: r.projectId, target_id: r.targetId })) });
    },
  },
  {
    name: "project_list",
    title: "列出项目",
    description: "列出项目及进度（总数/完成/阻塞/逾期）。参数 status 过滤 active/paused/done/archived；q 按名称或代号模糊过滤。",
    input: z.object({ status: z.string().optional(), q: z.string().optional(), include_archived: z.boolean().optional() }),
    handler: async (i) => envelope({ projects: listProjects({ status: i.status, q: i.q, includeArchived: i.include_archived }) }),
  },
  {
    name: "project_get",
    title: "查看项目详情",
    description: "按 id 或 key（如 IT、ADMIN）获取项目：清单、工作流、资料位置、最近会议与决定、项目条例、进度。",
    input: z.object({ project: z.string().describe("项目 id 或 key") }),
    handler: async (i) => {
      const p = resolveProjectOrNull(i.project);
      return envelope({ project: p, progress: progressFor(p!.id) });
    },
  },
  {
    name: "project_create",
    title: "新建/更新项目",
    description: "创建项目（key 唯一，如 ADMIN-FIN）或按 id/key 更新。事务性工作用 kind=admin，IT 项目用 kind=it，客户交付用 kind=client，纯资料归档用 kind=knowledge。",
    write: true,
    input: z.object({
      key: z.string().describe("短代号，全大写，如 IT、ADMIN、LEGAL"),
      name: z.string(),
      kind: z.enum(["it", "admin", "client", "knowledge"]).optional(),
      status: z.enum(["active", "paused", "done", "archived"]).optional(),
      summary_md: z.string().optional(),
      due_at: iso.optional(),
      local_root: z.string().optional().describe("本机资料根目录"),
      github_repo: z.string().optional(),
      id: z.string().optional().describe("传入则更新已有项目"),
      template: z.string().optional().describe("新建时套用模板：app / miniprogram / saas / client / basic。会预置阶段、资质与配套事项和依赖。可先用 template_apply 不带参数查看"),
    }),
    handler: async (i, ctx) => {
      const input = { key: i.key, name: i.name, kind: i.kind, status: i.status, summaryMd: i.summary_md, dueAt: i.due_at, localRoot: i.local_root, githubRepo: i.github_repo };
      const p = i.id ? updateProject(i.id, input, ctx.actor, ctx.ip) : createProject(input, ctx.actor, ctx.ip);
      const tpl = !i.id && i.template ? applyTemplate(p.id, i.template, ctx.actor) : null;
      return envelope({ project: { id: p.id, key: p.key, name: p.name, kind: p.kind, status: p.status }, template: tpl }, tpl ? [`已套用模板「${tpl.name}」：${tpl.milestones} 个阶段、${tpl.items} 个事项、${tpl.deps} 条依赖。用 project_board 查看全貌。`] : []);
    },
  },
  {
    name: "project_board",
    title: "项目全貌（阶段 · 能否发版 · 卡在哪）",
    description:
      "一次拿到项目的全局判断：当前阶段、各阶段完成度与必过缺口、发版就绪（还差哪几项）、等待链与依赖违约、阻塞/逾期/待核实、需求漏斗（未拆解、待确认放弃）、按类型进度、健康度（含系统建议与原因）。\n" +
      "汇报进度、决定下一步做什么之前先调它，不要靠翻清单拼凑。",
    input: z.object({ project: z.string() }),
    handler: async (i) => {
      const p = resolveProjectOrNull(i.project);
      const b = projectBoard(p!.id);
      const { trend, ...rest } = b;
      void trend;
      return envelope(rest, b.release && !b.release.ready ? [`距离「${b.release.name}」可放行还差 ${b.release.mustTotal - b.release.mustDone} 个必过项。`] : []);
    },
  },
  {
    name: "milestone_save",
    title: "建/改阶段或发布版本",
    description:
      "阶段（kind=phase，如 设计/开发/测试/上线）或发布版本（kind=release，如 v1.0）。传 id 修改。\n" +
      "阶段门的放行/暂缓/终止只能由用户在网页决定；你可以在 gate_proposal 写建议（依据 project_board 的缺口）。",
    write: true,
    input: z.object({
      project: z.string(), id: z.string().optional(), name: z.string(),
      kind: z.enum(["phase", "release"]).optional(), goal: z.string().optional(),
      start_at: iso.nullable().optional(), due_at: iso.nullable().optional(),
      status: z.enum(["planned", "active", "done", "cancelled"]).optional(),
      gate_proposal: z.string().optional().describe("你对阶段门的建议：可以放行/建议暂缓，附理由"),
    }),
    handler: async (i, ctx) => {
      const p = resolveProjectOrNull(i.project);
      gate(ctx, p!.id, "milestone_save");
      if (ctx.isAgent && i.status === "done") throw Object.assign(new Error("阶段完成要经过阶段门：请在 gate_proposal 写建议，由用户在网页放行"), { status: 403 });
      const m = saveMilestone({ id: i.id, projectId: p!.id, name: i.name, kind: i.kind, goal: i.goal, startAt: i.start_at as never, dueAt: i.due_at as never, status: i.status, gateProposal: i.gate_proposal }, ctx.actor);
      return envelope({ milestone: m });
    },
  },
  {
    name: "requirement_save",
    title: "提需求 / 更新需求状态",
    description:
      "需求是「要做成什么」，事项是「具体去做什么」。用户提出的每一个想法/要求都先记成需求，确认要做后再用 checklist_add(requirement=编号) 拆成事项。\n" +
      "规则：关联事项全部完成后需求会自动关闭；不做了必须 status=dropped 并写 close_reason，你提的放弃需用户确认；有未完成事项时不能标 done。",
    write: true,
    input: z.object({
      project: z.string(), id: z.string().optional().describe("需求 id 或编号 R-001；不传则新建"),
      title: z.string().optional(), detail_md: z.string().optional(), source: z.string().optional().describe("来源：客户/会议/自己/agent"),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(), milestone: z.string().nullable().optional(),
      status: z.enum(["proposed", "accepted", "in_progress", "done", "dropped"]).optional(),
      close_reason: z.string().optional(),
    }),
    handler: async (i, ctx) => {
      const p = resolveProjectOrNull(i.project);
      gate(ctx, p!.id, "requirement_save");
      const st = resolveStructure(p!.id, i.milestone, undefined);
      const existing = i.id ? getRequirement(i.id, p!.id) : null;
      if (i.id && !existing) throw Object.assign(new Error(`本项目没有需求「${i.id}」`), { status: 404 });
      const r = saveRequirement({ id: existing?.id, projectId: p!.id, title: i.title, detailMd: i.detail_md, source: i.source, priority: i.priority, milestoneId: st.milestoneId, status: i.status, closeReason: i.close_reason }, ctx.actor);
      const hints: string[] = [];
      if (r.status === "dropped" && r.closeConfirmed === 0) hints.push("放弃已记录，等待用户在网页确认。");
      if (r.status === "accepted") hints.push(`下一步：用 checklist_add 拆成事项并带上 requirement="${r.code}"。`);
      return envelope({ requirement: r }, hints);
    },
  },
  {
    name: "requirement_list",
    title: "需求清单与追溯",
    description: "列出项目需求、每条的关联事项与完成情况；untriaged=true 表示已确认但还没拆出事项。",
    input: z.object({ project: z.string(), status: z.enum(["proposed", "accepted", "in_progress", "done", "dropped", "open"]).optional() }),
    handler: async (i) => {
      const p = resolveProjectOrNull(i.project);
      let rows = listRequirements(p!.id);
      if (i.status === "open") rows = rows.filter((r) => !["done", "dropped"].includes(r.status));
      else if (i.status) rows = rows.filter((r) => r.status === i.status);
      return envelope({ requirements: rows.map((r) => ({ id: r.id, code: r.code, title: r.title, status: r.status, priority: r.priority, close_reason: r.closeReason || undefined, close_confirmed: r.closeConfirmed === 1, items: r.items, untriaged: r.untriaged })) });
    },
  },
  {
    name: "item_link",
    title: "设置事项依赖（谁卡着谁）",
    description: "blocker 完成后 blocked 才能开始，例如「ICP 备案」卡「正式上线」。action=remove 删除。会做循环检测；可以跨项目。",
    write: true,
    input: z.object({ blocker_id: z.string(), blocked_id: z.string(), action: z.enum(["add", "remove"]).optional(), lag_days: z.number().int().optional() }),
    handler: async (i, ctx) => {
      const b = db.select().from(s.items).where(eq(s.items.id, i.blocked_id)).get();
      if (b) gate(ctx, b.projectId, "item_link");
      if (i.action === "remove") return envelope(removeDep(i.blocker_id, i.blocked_id, ctx.actor));
      return envelope({ dep: addDep(i.blocker_id, i.blocked_id, ctx.actor, i.lag_days ?? 0) });
    },
  },
  {
    name: "template_apply",
    title: "项目模板（查看 / 套用）",
    description:
      "不传 template：列出可用模板（App 上架、微信小程序、网站/SaaS、客户交付、通用），含预置的阶段与资质事项。\n" +
      "传 template：给项目补上模板里的阶段、配套事项（备案、软著、账号、隐私协议…）和依赖；可重复调用，只补缺的。",
    write: true,
    input: z.object({ project: z.string().optional(), template: z.string().optional() }),
    handler: async (i, ctx) => {
      if (!i.template) return envelope({ templates: listTemplates() });
      if (!i.project) throw Object.assign(new Error("套用模板需要 project"), { status: 422 });
      const p = resolveProjectOrNull(i.project);
      gate(ctx, p!.id, "template_apply");
      const r = applyTemplate(p!.id, i.template, ctx.actor);
      return envelope(r, [`新增 ${r.milestones} 个阶段、${r.items} 个事项、${r.deps} 条依赖，跳过已存在 ${r.skipped} 项。`]);
    },
  },
  {
    name: "project_update_post",
    title: "发项目进展更新（健康度）",
    description: "定期（默认每 7 天）发一次：health=on_track/at_risk/off_track + 进展 / 阻塞 / 下一步。项目健康度以最近一次更新为准；先看 project_board 的 health.suggested 与 reasons 再判断。",
    write: true,
    input: z.object({
      project: z.string(), health: z.enum(["on_track", "at_risk", "off_track"]),
      progress_md: z.string().optional(), blockers_md: z.string().optional(), next_md: z.string().optional(),
    }),
    handler: async (i, ctx) => {
      const p = resolveProjectOrNull(i.project);
      gate(ctx, p!.id, "project_update_post");
      return envelope({ update: postProjectUpdate({ projectId: p!.id, health: i.health, progressMd: i.progress_md, blockersMd: i.blockers_md, nextMd: i.next_md }, ctx.actor) });
    },
  },
  {
    name: "checklist_list",
    title: "读取清单",
    description: "分页读取任务。status='open' 表示未完成（todo/doing/blocked/changed）。每页最多 200，用 next_cursor 翻页。",
    input: z.object({
      project: z.string().optional(),
      status: z.enum(["todo", "doing", "blocked", "done", "dropped", "changed", "open"]).optional(),
      due_before: iso.optional(),
      q: z.string().optional(),
      group: z.string().optional().describe("按分组名过滤"),
      needs_review: z.boolean().optional().describe("只看已完成但证据像进度、需要核实的任务"),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.number().int().optional(),
    }),
    handler: async (i) => {
      let projectId = i.project;
      if (projectId) projectId = getProject(projectId)?.id ?? "__missing__";
      if (projectId === "__missing__") throw Object.assign(new Error(`找不到项目「${i.project}」，请先 project_list 确认代号`), { status: 404 });
      const res = listItems({ projectId, status: i.status as never, dueBefore: i.due_before, q: i.q, limit: i.limit, cursor: i.cursor, needsReview: i.needs_review });
      const groups = new Map<string, string>();
      if (res.items.length) {
        const ws = db.select().from(s.workstreams).all();
        for (const w of ws) groups.set(w.id, w.name);
      }
      const rows = i.group ? res.items.filter((it) => groups.get(it.workstreamId ?? "") === i.group) : res.items;
      return envelope({
        items: rows.map((it) => ({
          id: it.id, title: it.title, status: it.status, priority: it.priority, due_at: it.dueAt,
          done_definition: it.doneDefinition, claimed_by: it.claimedBy || null, version: it.version,
          evidence: it.evidence || undefined, block_reason: it.blockReason || undefined,
          progress_log: it.detailMd || undefined, needs_review: it.needsReview === 1 || undefined,
          superseded_by: it.supersededBy || undefined,
          group: groups.get(it.workstreamId ?? "") ?? null,
        })),
        next_cursor: res.nextCursor,
      });
    },
  },
  {
    name: "checklist_add",
    title: "添加任务",
    description:
      "批量添加【新的、可验收的事项】（1-50 条），不是记流水账。每条写清 title（动词开头、指向交付物）、done_definition（做到什么程度算完）、due_at（如有）。\n" +
      "同一件事的后续进展不要新建任务：用 checklist_progress 追加，或用 checklist_update 改状态。\n" +
      "如果它其实是原有事项的升级版（范围变了、标准变了），用 checklist_supersede。\n" +
      "返回里 merged 表示被识别为已有事项的进展并合并进去了；hints 提醒缺完成标准的条目。",
    write: true,
    input: z.object({
      project: z.string().optional().describe("项目 id 或 key；省略则进收件箱"),
      items: z.array(z.object({
        title: z.string(),
        detail_md: z.string().optional(),
        done_definition: z.string().optional(),
        priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
        due_at: iso.optional(),
        parent_id: z.string().optional(),
        group: z.string().optional().describe("分组名（如 交付/内部/外部依赖），不存在会自动创建"),
        kind: kindEnum.optional().describe(KIND_HELP),
        milestone: z.string().optional().describe("所属阶段（名称或 id），如 开发、上线"),
        requirement: z.string().optional().describe("对应需求（编号如 R-003 或 id）——拆解需求时必填，需求才能闭环"),
        must_meet: z.boolean().optional().describe("是否为该阶段必过项（没完成就不能放行/发版）"),
        start_at: iso.optional(),
        lead_time_days: z.number().int().optional().describe("通常需要几天（备案、认证类填）"),
        blocked_by: z.array(z.string()).optional().describe("前置事项 id：它们完成后本事项才能开始"),
        recur: z.string().optional().describe("重复：monthly:15 / quarterly:15 / yearly:05-31（完成后自动生成下一期）"),
      })).min(1).max(50),
      owner_type: z.enum(["purchase", "deal", "trip", "asset"]).optional().describe("这些事项挂在哪个事务对象下：采购的比价下单、合作的准备材料、行程的出行准备"),
      owner_id: z.string().optional(),
    }),
    handler: async (i, ctx) => {
      for (const x of i.items as Array<{ recur?: string }>) if (x.recur && !validRecur(x.recur)) throw Object.assign(new Error(`重复规则「${x.recur}」看不懂，用 monthly:15 / quarterly:15 / yearly:05-31`), { status: 422 });
      if (i.owner_type) {
        if (!i.owner_id) throw Object.assign(new Error("owner_type 需要配 owner_id"), { status: 422 });
        gate(ctx, null, "checklist_add");
        const res = addOwnedItems(i.owner_type, i.owner_id, i.items.map((x: Record<string, unknown>) => ({ title: x.title as string, detailMd: x.detail_md as string, doneDefinition: x.done_definition as string, priority: x.priority as never, dueAt: x.due_at as never, kind: x.kind as string | undefined, recurRule: x.recur as string | undefined })), ctx.actor);
        return envelope({ ids: res.ids, merged: res.merged }, [`已挂到 ${i.owner_type}:${i.owner_id}`, ...res.hints.slice(0, 3)]);
      }
      const p = i.project ? resolveProjectOrNull(i.project) : getInbox();
      gate(ctx, p!.isInbox ? null : p!.id, "checklist_add");
      const res = addItems(p!.id, i.items.map((x: Record<string, unknown>) => {
        const st = resolveStructure(p!.id, x.milestone as string | undefined, x.requirement as string | undefined);
        return {
          title: x.title as string, detailMd: x.detail_md as string, doneDefinition: x.done_definition as string,
          priority: x.priority as never, dueAt: x.due_at as never, parentId: x.parent_id as string, sourceType: "agent" as const,
          workstreamId: x.group ? ensureGroup(p!.id, x.group as string).id : null,
          kind: x.kind as string | undefined, milestoneId: st.milestoneId, requirementId: st.requirementId,
          mustMeet: x.must_meet as boolean | undefined, startAt: x.start_at as never, leadTimeDays: x.lead_time_days as never,
          recurRule: x.recur as string | undefined,
        };
      }), ctx.actor, ctx.ip);
      // 依赖：按输入位置对应到最终落库的事项（新建或被合并进的那条）
      i.items.forEach((x: { blocked_by?: string[] }, idx: number) => {
        const target = res.byIndex[idx];
        if (!x.blocked_by?.length || !target) return;
        for (const b of x.blocked_by) { try { addDep(b, target, ctx.actor); } catch (e) { res.hints.push(`依赖未加：${(e as Error).message}`); } }
      });
      const hints = [`已写入项目：${p!.key}（${p!.name}）`];
      if (p!.isInbox) hints.push("这些任务在收件箱。确认归属后调用 item_move 分拣到具体项目。");
      else hints.push("建议随后调用 checklist_list 确认已落库。");
      for (const m of res.merged) hints.push(`「${m.intoTitle}」的进展已合并（${m.reason}），没有新建任务。`);
      hints.push(...res.hints.slice(0, 5));
      // 顺带提示疑似重复，供 agent 自己核对
      const dups = res.ids.flatMap((id) => findDuplicates(p!.id, db.select().from(s.items).where(eq(s.items.id, id)).get()?.title ?? "").filter((d) => d.item_id !== id).map((d) => ({ new_id: id, ...d })));
      if (dups.length) hints.push(`疑似与已有任务重复：${dups.map((d) => `「${d.title}」(${d.item_id})`).join("、")}。确认是同一件事就用 item_merge 合并，是不同的事就忽略。`);
      return envelope({ ids: res.ids, merged: res.merged, duplicates: dups.map((d) => ({ item_id: d.item_id, title: d.title })), project: { id: p!.id, key: p!.key, name: p!.name }, progress: res.progress }, hints);
    },
  },
  {
    name: "checklist_update",
    title: "更新任务状态（核销/变更/阻塞）",
    description:
      "更新任务。status=done 必须带 evidence（做了什么、如何验证、链接或路径）；status=changed 需在 note 写明变更内容；status=blocked 必须带 block_reason。强烈建议传 expected_version 防止覆盖他人修改（版本不符会返回 409 和最新数据）。",
    write: true,
    input: z.object({
      item_id: z.string(),
      status: z.enum(["todo", "doing", "blocked", "done", "dropped", "changed"]).optional(),
      note: z.string().optional(),
      evidence: z.string().optional(),
      block_reason: z.string().optional(),
      due_at: iso.nullable().optional(),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
      expected_version: z.number().int().optional(),
      session_id: z.string().optional(),
      group: z.string().nullable().optional().describe("改到某个分组；传 null 移出分组"),
      kind: kindEnum.optional().describe(KIND_HELP),
      milestone: z.string().nullable().optional().describe("改到某阶段（名称或 id）；null 移出阶段"),
      requirement: z.string().nullable().optional().describe("关联到需求（R-003 或 id）；null 取消关联"),
      must_meet: z.boolean().optional(),
      start_at: iso.nullable().optional(),
      lead_time_days: z.number().int().nullable().optional(),
      done_definition: z.string().optional().describe("完成标准：做到什么程度算完"),
      waiting_for: z.string().optional().describe("交给别人/在等外部（客户、平台审核、供应商…）时写在等谁；会自动记交出日期并默认 3 天后提醒去催。对方回复了传空串清掉"),
      follow_up_at: iso.nullable().optional().describe("什么时候去催（默认交出后 3 天）"),
      planned_for: z.string().optional().describe("计划哪天做，YYYY-MM-DD；传 'today' 表示今天；空串移出计划"),
      defer_until: iso.nullable().optional().describe("先放一放：这天之前不出现在今日和到期提醒里"),
    }),
    handler: async (i, ctx) => {
      const before = db.select().from(s.items).all().find((x) => x.id === i.item_id);
      if (before) gate(ctx, before.projectId, "checklist_update");
      if (i.planned_for === "today") i.planned_for = localYmd();
      if (i.status === "done" && !(i.evidence || i.note)) throw Object.assign(new Error("验收失败：status=done 必须提供 evidence（做了什么、如何验证）"), { status: 422 });
      if (i.status === "blocked" && !i.block_reason) throw Object.assign(new Error("请提供 block_reason 说明卡在哪里、需要谁做什么"), { status: 422 });
      try {
        const st = before ? resolveStructure(before.projectId, i.milestone, i.requirement) : { milestoneId: undefined, requirementId: undefined };
        let res = updateItem(i.item_id, {
          status: i.status as never, note: i.note, evidence: i.evidence, blockReason: i.block_reason,
          dueAt: i.due_at as never, priority: i.priority as never, expectedVersion: i.expected_version,
          kind: i.kind, milestoneId: st.milestoneId, requirementId: st.requirementId, mustMeet: i.must_meet,
          startAt: i.start_at as never, leadTimeDays: i.lead_time_days as never, doneDefinition: i.done_definition,
          waitingFor: i.waiting_for, followUpAt: i.follow_up_at as never, plannedFor: i.planned_for, deferUntil: i.defer_until as never,
        }, ctx.actor, i.session_id, ctx.ip);
        if (i.group !== undefined) {
          setItemGroup(i.item_id, i.group);
          res.item = db.select().from(s.items).where(eq(s.items.id, i.item_id)).get()!;
        }
        const hints: string[] = [];
        if (i.waiting_for && res.item.followUpAt) hints.push(`已记为在等「${res.item.waitingFor}」，${new Date(res.item.followUpAt * 1000).toLocaleDateString("zh-CN")} 会提醒去催。`);
        if (res.nextRecur) hints.push(`这是重复事项，已生成下一期（截止 ${new Date(res.nextRecur.dueAt! * 1000).toLocaleDateString("zh-CN")}）。`);
        if (res.waitingOn?.length) hints.push(`提醒：前置事项还没完成（${res.waitingOn.join("、")}），确认可以并行再继续。`);
        if (res.flag === "evidence_is_progress") {
          hints.push("注意：这条 evidence 读起来是「进行到哪一步」，不是「做到了什么程度」。任务已标记完成但进入「待核实」（needs_review=1）。如果其实没做完，请改回 doing，并用 checklist_progress 记录进展。");
        }
        return envelope({ item: res.item, needs_review: res.item.needsReview === 1 || undefined, progress: res.progress }, hints);
      } catch (e) {
        const err = e as Error & { status?: number; current?: unknown };
        if (err.status === 409) return envelope({ conflict: true, current: err.current, message: err.message });
        throw e;
      }
    },
  },
  {
    name: "checklist_progress",
    title: "记录进展（不新建任务）",
    description:
      "同一件事有了进展（完成了一部分、开了会、发了材料、有阶段性结论）时调用：把进展追加到该任务的进展记录里，任务仍保持未完成状态。\n" +
      "这是记账，不是新建事项。只有真的多出一件独立、可验收的事时，才用 checklist_add。",
    write: true,
    input: z.object({ item_id: z.string(), note: z.string().describe("这一步做了什么、产出了什么、下一步是什么"), percent: z.number().int().min(0).max(100).optional().describe("可选：大约完成到百分之几") }),
    handler: async (i, ctx) => {
      const it = db.select().from(s.items).where(eq(s.items.id, i.item_id)).get();
      if (!it) throw Object.assign(new Error("任务不存在"), { status: 404 });
      gate(ctx, it.projectId, "checklist_progress");
      const r = addProgress(i.item_id, i.note, ctx.actor, { percent: i.percent });
      return envelope({ item: { id: r.item.id, title: r.item.title, status: r.item.status, version: r.item.version, latest: r.item.detailMd.split("\n\n").slice(-1)[0] } }, ["进展已记录在原任务上。"]);
    },
  },
  {
    name: "checklist_supersede",
    title: "版本更迭（需求变了，升级为新版）",
    description:
      "同一件事但范围/标准变了，需要重做或接着做新版时调用：旧任务标记完成并注明「被新版取代」，同时建一个新的待办任务挂上来源。\n" +
      "与 checklist_progress 的区别：进展=原样继续；更迭=原目标作废、以新目标为准。别把两件事混在一起。",
    write: true,
    input: z.object({
      item_id: z.string().describe("旧任务"),
      title: z.string().describe("新版本任务标题"),
      detail_md: z.string().optional().describe("新版本的要求、与旧版的差异"),
      done_definition: z.string().optional(),
      due_at: iso.optional(),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
      group: z.string().optional(),
    }),
    handler: async (i, ctx) => {
      const it = db.select().from(s.items).where(eq(s.items.id, i.item_id)).get();
      if (!it) throw Object.assign(new Error("任务不存在"), { status: 404 });
      gate(ctx, it.projectId, "checklist_supersede");
      const group = i.group ? ensureGroup(it.projectId, i.group) : null;
      const r = supersedeItem(i.item_id, { title: i.title, detailMd: i.detail_md, doneDefinition: i.done_definition, dueAt: i.due_at ?? null, priority: i.priority, workstreamId: group?.id }, ctx.actor, ctx.ip);
      return envelope({ old_item_id: r.old.id, item: r.next }, [`旧任务已关闭并标注被新版取代；请在新任务「${r.next.title}」上继续，不要回头改旧任务。`]);
    },
  },
  {
    name: "claim_item",
    title: "认领任务",
    description: "认领一个任务开始做。若他人已认领且未超时（2 小时），返回 conflict 与认领人信息，此时应先询问用户或换任务。认领后任务变 doing。",
    write: true,
    input: z.object({ item_id: z.string(), session_id: z.string() }),
    handler: async (i, ctx) => {
      const it = db.select().from(s.items).all().find((x) => x.id === i.item_id);
      if (!it) throw Object.assign(new Error("任务不存在"), { status: 404 });
      gate(ctx, it.projectId, "claim_item");
      const res = claimItem(i.item_id, i.session_id, ctx.actor);
      if (res.conflict) return envelope({ conflict: true, claimed_by: res.claimedBy, claimed_at: res.claimedAt, item: res.item }, ["该任务已被他人认领。请向用户确认是否接手；如确认接手，可再次调用 claim_item。"]);
      return envelope({ item: res.item });
    },
  },
  {
    name: "release_item",
    title: "释放任务认领",
    description: "做完或放弃时释放认领，让别人可以接手。",
    write: true,
    input: z.object({ item_id: z.string() }),
    handler: async (i, ctx) => { releaseItem(i.item_id, ctx.actor); return envelope({ released: true }); },
  },
  {
    name: "checklist_verify",
    title: "全量核对项目清单",
    description:
      "收工前自查：返回项目进度 + 所有问题项（done 无证据、blocked 无原因、认领超时、已逾期）。把这些 gaps 全部处理后再结束会话。",
    input: z.object({ project: z.string() }),
    handler: async (i) => {
      const p = resolveProjectOrNull(i.project);
      return envelope(verifyChecklist(p!.id));
    },
  },
  {
    name: "meeting_import",
    title: "导入会议记录（自动建档 + 抽取事务）",
    description:
      "把任何来源的会议记录（飞书/腾讯会议/录音转写/粘贴文本/AI 摘要）归档为会议档案。\n" +
      "默认【只归档、不生成任务】—— 用户大多只要清单本身，清单由人自己整理，或让用户明确说\"帮我把这条会议整理成清单\"时再做。\n" +
      "需要落任务时传 items（你自己整理好的，或用户确认过的）；create_items=true 时才用内置规则自动抽一版草稿。",
    write: true,
    input: z.object({
      project: z.string(),
      title: z.string().optional(),
      held_at: iso.optional(),
      participants: z.string().optional(),
      source: z.string().optional().describe("feishu|tencent|recording|paste|agent 等"),
      text: z.string().describe("会议记录原文"),
      attachments: z.array(z.object({ name: z.string(), url: z.string().optional(), path: z.string().optional(), kind: z.string().optional() })).optional(),
      items: z.array(z.object({
        title: z.string(), detail_md: z.string().optional(), done_definition: z.string().optional(),
        due_at: iso.optional(), priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
        group: z.string().optional(),
        done: z.boolean().optional().describe("true=这条在会上已经办完，归档为已完成（status_note 作证据），不进入待办；默认 false"),
        status_note: z.string().optional().describe("已办事项的完成说明/结论，或待办事项的当前进展"),
        supersedes: z.string().optional().describe("如果这条是某个已有未完成事项的新版本（范围/标准变了），填该事项的 item_id"),
        expected_version: z.number().int().optional(),
      })).optional().describe("用户确认要落成任务的条目。只放新事项、未完成事项的最新版本、已办结论；不要把过程流水账逐条列进来。"),
      create_items: z.boolean().optional().describe("true=用内置规则自动抽一版草稿并落任务。只有用户明确要求自动生成清单时才传。"),
      link_item_ids: z.array(z.string()).optional().describe("把已有的任务关联到这条会议（不改任务本身）"),
      save_draft: z.boolean().optional().describe("true=把这条会议的清单草稿存成快照（仅当用户想留存清单时）"),
      parse_with_ai: z.boolean().optional(),
    }),
    handler: async (i, ctx) => {
      const p = resolveProjectOrNull(i.project);
      gate(ctx, p!.id, "meeting_import");
      const r = await createMeeting({
        projectId: p!.id, title: i.title ?? "会议记录", heldAt: i.held_at, participants: i.participants,
        source: i.source ?? "agent", minutesMd: i.text, attachments: i.attachments,
        items: i.items?.map((x: Record<string, unknown>) => ({ title: x.title, detailMd: x.detail_md, doneDefinition: x.done_definition, dueAt: x.due_at, priority: x.priority, group: x.group, done: x.done, statusNote: x.status_note, supersedes: x.supersedes, expectedVersion: x.expected_version as never })) as never,
        parseWithAi: i.parse_with_ai,
        extractItems: i.create_items === true,
      }, ctx.actor, ctx.ip);
      for (const iid of i.link_item_ids ?? []) linkItemToMeeting(iid, r.meeting!.id, ctx.actor);
      if (i.save_draft) saveMeetingItemsSnapshot(r.meeting!.id, i.items ?? []);
      return envelope({
        meeting_id: r.meeting?.id, project: { key: p!.key, name: p!.name }, deduped: r.deduped,
        created_item_ids: r.createdItemIds, progress_merged: r.progressNotes ?? [], done_archived: r.doneNotes ?? [],
        summary: r.meeting?.summaryMd,
      }, [
        "本工具默认只归档；用户没有明确要清单时，不要自己生成任务。",
        "只应为「新的事项 / 未完成事项的新版本 / 已办结论」建立或更新记录；过程叙述留在会议全文里即可。",
      ]);
    },
  },
  {
    name: "ingest_history",
    title: "归集历史对话/资料",
    description: "把过去与 agent 的对话、散落文档归集进中心：自动摘要、抽取事务、按内容指纹去重。适合事后补录。",
    write: true,
    input: z.object({
      project: z.string().optional(),
      kind: z.enum(["meeting", "notes", "checklist"]).optional(),
      title: z.string().optional(),
      text: z.string(),
      source: z.string().optional(),
      create_items: z.boolean().optional().describe("true=同时从内容中抽取任务；默认只归档"),
    }),
    handler: async (i, ctx) => {
      const p = i.project ? resolveProjectOrNull(i.project) : getInbox();
      gate(ctx, p!.isInbox ? null : p!.id, "ingest_history");
      const r = await ingest({ projectId: p!.id, kind: i.kind, title: i.title, text: i.text, source: i.source ?? "agent-history", createItems: i.create_items }, ctx.actor, ctx.ip);
      return envelope({ ...r, project: { key: p!.key, name: p!.name } }, p!.isInbox ? ["已进收件箱，请用 item_move 分拣。"] : []);
    },
  },
  {
    name: "note_save",
    title: "保存知识/笔记",
    description: "记录零散但重要的信息：咨询结论、规则、账号归属、经验教训。传 id 则更新。",
    write: true,
    input: z.object({ id: z.string().optional(), project: z.string().optional(), title: z.string(), body_md: z.string().optional(), tags: z.string().optional() }),
    handler: async (i, ctx) => {
      const p = i.project ? resolveProjectOrNull(i.project) : null;
      const n = upsertNote({ id: i.id, projectId: p?.id ?? null, title: i.title, bodyMd: i.body_md, tags: i.tags, source: ctx.actor.name }, ctx.actor);
      return envelope({ note: n, project: p ? { key: p.key, name: p.name } : null });
    },
  },
  {
    name: "decision_record",
    title: "记录决定",
    description: "记录已确认的决定及其理由与影响面，避免后续反复讨论。",
    write: true,
    input: z.object({ project: z.string(), title: z.string(), rationale_md: z.string().optional(), impact: z.string().optional() }),
    handler: async (i, ctx) => {
      const p = resolveProjectOrNull(i.project);
      gate(ctx, p!.isInbox ? null : p!.id, "decision_record");
      const d = createDecision({ projectId: p!.id, title: i.title, rationaleMd: i.rationale_md, impact: i.impact }, ctx.actor);
      return envelope({ decision: d, project: { key: p!.key, name: p!.name } });
    },
  },
  {
    name: "file_register",
    title: "登记资料位置",
    description:
      "登记资料在哪（本机路径 / GitHub / 网盘链接）。中心不保存文件本体。同一项目同一路径会更新。传 verify=true 表示你刚刚确认过其存在。位置变更请重新调用本工具更新 path。",
    write: true,
    input: z.object({
      project: z.string(), item_id: z.string().optional(), label: z.string(),
      machine: z.string().optional(), path: z.string().optional(), url: z.string().optional(),
      kind: z.enum(["file", "dir", "repo", "link"]).optional(),
      archive_to: z.enum(["local", "github", "r2", "other"]).optional(),
      size_bytes: z.number().int().optional(), note: z.string().optional(), verify: z.boolean().optional(),
    }),
    handler: async (i, ctx) => {
      const p = resolveProjectOrNull(i.project);
      gate(ctx, p!.isInbox ? null : p!.id, "file_register");
      const f = registerFile({
        projectId: p!.id, itemId: i.item_id, label: i.label, machine: i.machine, path: i.path, url: i.url,
        kind: i.kind, archiveTo: i.archive_to, sizeBytes: i.size_bytes, note: i.note,
      }, ctx.actor, i.verify);
      return envelope({ file: f, project: { key: p!.key, name: p!.name } });
    },
  },
  {
    name: "file_verify",
    title: "核验资料位置",
    description: "核验资料是否还在：result=ok（还在原处）/moved（移动了，传 new_path）/missing（找不到了）。",
    write: true,
    input: z.object({ file_id: z.string(), result: z.enum(["ok", "missing", "moved"]), new_path: z.string().optional(), note: z.string().optional() }),
    handler: async (i, ctx) => envelope({ file: verifyFile(i.file_id, { result: i.result, newPath: i.new_path, note: i.note }, ctx.actor) }),
  },
  {
    name: "file_list",
    title: "查询资料位置",
    description: "按项目列出资料位置及核验状态（stale=超过 30 天未核验）。",
    input: z.object({ project: z.string().optional(), stale_only: z.boolean().optional() }),
    handler: async (i) => {
      const p = i.project ? resolveProjectOrNull(i.project) : null;
      return envelope({ files: listFiles({ projectId: p?.id, staleOnly: i.stale_only }) });
    },
  },
  {
    name: "reminders_pull",
    title: "拉取提醒",
    description: "获取未读提醒（逾期/到期/阻塞/条例/资料核验）。默认只返回 open；传 include_acked 可看全部。",
    input: z.object({ project: z.string().optional(), include_acked: z.boolean().optional() }),
    handler: async (i, ctx) => {
      void ctx;
      const p = i.project ? resolveProjectOrNull(i.project) : null;
      const rows = pullReminders({ projectId: p?.id, includeAcked: i.include_acked });
      return envelope({ reminders: rows });
    },
  },
  {
    name: "reminder_ack",
    title: "处理提醒",
    description: "action=ack 标记已读；snooze 延后（snooze_hours）；done 完成。",
    write: true,
    input: z.object({ ids: z.array(z.string()).min(1), action: z.enum(["ack", "snooze", "done"]).optional(), snooze_hours: z.number().optional() }),
    handler: async (i, ctx) => envelope({ updated: ackReminders(i.ids, ctx.actor, i.action ?? "ack", i.snooze_hours ?? 24) }),
  },
  {
    name: "policy_read",
    title: "读取条例",
    description:
      "读取条例全文（全局 + 指定项目）。只返回生效中的条例（状态 active 且未过期），并标注 required（必读）与生效工具。条例是用户对 agent 的硬性要求，必须遵守。",
    input: z.object({ project: z.string().optional(), policy_id: z.string().optional(), include_pending: z.boolean().optional().describe("同时查看待批准的条例") }),
    handler: async (i) => {
      const p = i.project ? resolveProjectOrNull(i.project) : null;
      const rows = listPolicies(p?.id).filter((r) => r.live || (i.include_pending && (r.status === "pending" || r.status === "draft")));
      const selected = i.policy_id ? rows.filter((r) => r.id === i.policy_id) : rows;
      return envelope({ policies: selected.map((r) => ({ id: r.id, title: r.title, body_md: r.bodyMd, version: r.version, required: !!r.required, status: r.status, applies_to_tools: r.tools, scope_mode: r.scopeMode, expires_at: r.expiresAt, purpose: r.purpose })) });
    },
  },
  {
    name: "policy_ack",
    title: "确认已读条例",
    description: "确认你已阅读条例当前版本。未确认的必读条例会阻止对应写操作。只能确认生效中的条例。",
    write: true,
    input: z.object({ policy_id: z.string() }),
    handler: async (i, ctx) => {
      const r = ackPolicy(i.policy_id, ctx.actor.name);
      markPolicyAcked(ctx.actor.name, i.policy_id);
      return envelope(r);
    },
  },
  {
    name: "policy_write",
    title: "提议条例（需用户在网页批准）",
    description:
      "用户口述了一条规矩时调用。你写的条例只会变成「待批准」，不会拦截任何操作；必须由用户在网页「条例」页批准后才生效。正文最多 2000 字，必读条例必须用 applies_to_tools 限定到具体写操作。",
    write: true,
    input: z.object({
      id: z.string().optional().describe("传 id 表示修订已有条例"),
      project: z.string().optional().describe("项目条例；省略为全局条例"),
      title: z.string(),
      body_md: z.string().max(2000),
      required: z.boolean().optional().describe("是否必读（会拦截写操作）"),
      applies_to_tools: z.string().optional().describe(`限定工具，逗号分隔，可选：${WRITE_TOOLS.join(",")}`),
      scope_mode: z.enum(["tools", "all"]).optional().describe("all=所有写操作（需用户批准）"),
      purpose: z.string().optional().describe("这条规矩管什么、依据是什么，方便用户判断"),
      expires_at: iso.optional(),
      review_every_days: z.number().int().optional(),
    }),
    handler: async (i, ctx) => {
      const p = i.project ? resolveProjectOrNull(i.project) : null;
      const r = upsertPolicy({ id: i.id, projectId: p?.id ?? null, title: i.title, bodyMd: i.body_md, required: i.required, appliesToTools: i.applies_to_tools, scopeMode: i.scope_mode, purpose: i.purpose, expiresAt: i.expires_at ?? null, reviewEveryDays: i.review_every_days }, ctx.actor);
      return envelope({ policy: { id: r.id, title: r.title, status: r.status, version: r.version }, project: p ? { key: p.key, name: p.name } : null }, ["条例已提交为「待批准」，需用户在网页 条例 页点批准后才会生效（当前不影响任何操作）。"]);
    },
  },
  {
    name: "item_move",
    title: "分拣任务到项目",
    description:
      "把任务移动到正确的项目（例如从收件箱分拣出去），或移回收件箱。移动后仍保留状态与历史；若任务原属别的项目，会记录来源。",
    write: true,
    input: z.object({ item_id: z.string(), project: z.string().optional().describe("目标项目 id/key；省略=移回收件箱"), parking_lot: z.boolean().optional().describe("留在项目里但标记为待分拣，不计入进度"), note: z.string().optional() }),
    handler: async (i, ctx) => {
      const p = i.project ? resolveProjectOrNull(i.project) : null;
      gate(ctx, p && p.isInbox !== 1 ? p.id : null, "item_move");
      const r = moveItem(i.item_id, p?.id ?? null, ctx.actor, { parkingLot: i.parking_lot, note: i.note }, ctx.ip);
      return envelope(r, [`已移动到 ${r.project.key}（${r.project.name}）`]);
    },
  },
  {
    name: "item_merge",
    title: "合并重复任务",
    description: "同一项目内的重复任务合并：保留 keep_id，把其余任务的资料引用与历史挂过去后删除。用 search 或 checklist_list 先确认确实是同一件事。不同项目请用 item_move。",
    write: true,
    input: z.object({ keep_id: z.string(), dup_ids: z.array(z.string()).min(1).max(50) }),
    handler: async (i, ctx) => {
      const it = db.select().from(s.items).where(eq(s.items.id, i.keep_id)).get();
      if (it) gate(ctx, it.projectId, "item_merge");
      return envelope(mergeItems(i.keep_id, i.dup_ids, ctx.actor));
    },
  },
  {
    name: "file_move",
    title: "资料改挂项目",
    description: "把资料位置记录改挂到另一个项目（与任务分拣配套）。不移动磁盘上的文件。",
    write: true,
    input: z.object({ file_id: z.string(), project: z.string() }),
    handler: async (i, ctx) => {
      const p = resolveProjectOrNull(i.project);
      gate(ctx, p!.isInbox ? null : p!.id, "file_move");
      return envelope(moveFile(i.file_id, p!.id, ctx.actor));
    },
  },
  {
    name: "project_groups",
    title: "查看/设置项目分组",
    description: "查看项目分组及各组进度；传 groups 数组则整体设置分组顺序（已存在分组保留，任务挂靠不丢）。任务用 checklist_add/checklist_update 的 group 参数挂到分组。",
    write: true,
    input: z.object({ project: z.string(), groups: z.array(z.string()).max(20).optional() }),
    handler: async (i, ctx) => {
      const p = resolveProjectOrNull(i.project);
      if (!i.groups) return envelope({ groups: listGroups(p!.id) });
      gate(ctx, p!.isInbox ? null : p!.id, "project_groups");
      return envelope({ groups: setProjectGroups(p!.id, i.groups, ctx.actor) });
    },
  },
  {
    name: "asset_save",
    title: "登记/更新台账（资质、账号、域名、证书、合同、订阅、设备）",
    description:
      "长期存在、会到期的东西登记在台账里：备案号、软著证书、开发者账号、商户号、云账号、域名、SSL 证书、合同、订阅、设备。到期前按 remind_days 提醒，并写明过期后果。\n" +
      "办理过程是事项，办完的结果登记到台账：传 from_item=事项 id 自动带上项目与证据。\n" +
      "【不要写密码】：secret_ref 只写保存位置（如「1Password：苹果开发者」），检测到疑似密码会拒收。",
    write: true,
    input: z.object({
      id: z.string().optional(), from_item: z.string().optional(),
      kind: z.enum(ASSET_KINDS as unknown as [string, ...string[]]).optional(),
      name: z.string().optional(), identifier: z.string().optional().describe("编号：备案号、AppID、域名、证书号、合同号、序列号"),
      authority: z.string().optional().describe("办理机构/平台"), owner: z.string().optional().describe("归属主体或人"),
      project: z.string().optional(), valid_from: iso.nullable().optional(), valid_until: iso.nullable().optional(),
      renew_rule: z.string().optional(), remind_days: z.string().optional().describe("如 30,14,7"),
      status: z.enum(["active", "revoked"]).optional(), secret_ref: z.string().optional(), notes_md: z.string().optional(), cost_yuan: z.number().optional(),
    }),
    handler: async (i, ctx) => {
      const p = i.project ? resolveProjectOrNull(i.project) : null;
      gate(ctx, p?.id ?? null, "asset_save");
      const input = { id: i.id, kind: i.kind, name: i.name, identifier: i.identifier, authority: i.authority, owner: i.owner, projectId: p ? p.id : undefined, validFrom: i.valid_from as never, validUntil: i.valid_until as never, renewRule: i.renew_rule, remindDays: i.remind_days, status: i.status, secretRef: i.secret_ref, notesMd: i.notes_md, costYuan: i.cost_yuan };
      const a = i.from_item ? assetFromItem(i.from_item, input, ctx.actor) : saveAsset(input, ctx.actor);
      return envelope({ asset: a }, a.daysLeft != null && a.daysLeft <= 30 ? [`注意：${a.daysLeft < 0 ? "已过期" : `${a.daysLeft} 天后到期`}。${a.consequence}`] : []);
    },
  },
  {
    name: "asset_list",
    title: "查台账",
    description: "列出台账，按剩余天数排序。state=expiring 即将到期 / expired 已过期。",
    input: z.object({ kind: z.string().optional(), project: z.string().optional(), state: z.enum(["active", "expiring", "expired", "revoked"]).optional() }),
    handler: async (i) => {
      const p = i.project ? resolveProjectOrNull(i.project) : null;
      return envelope({ assets: listAssets({ kind: i.kind, projectId: p?.id, state: i.state }).map((a) => ({ id: a.id, kind: a.kind, name: a.name, identifier: a.identifier, owner: a.owner, valid_until: a.validUntil, days_left: a.daysLeft, state: a.state, secret_ref: a.secretRef || undefined })) });
    },
  },
  {
    name: "purchase_save",
    title: "采购：记要买的东西 / 加报价 / 推进状态",
    description:
      "要买设备或配件时调用。写清 spec_md（型号规格要求）和 caveats_md（注意事项：接口、兼容、电压、发票抬头…）。\n" +
      `状态：${PURCHASE_STATUS.join(" → ")}。add_quote 加一家报价（自动算到手价、标出最低）；选定后 chosen_quote_id；下单必须填 order_no；到货填 holder/location/warranty_until 会自动登记成设备台账。\n` +
      "比价、下单、催发票这类动作用 checklist_add(owner_type=purchase, owner_id=…) 挂成待办。",
    write: true,
    input: z.object({
      id: z.string().optional(), title: z.string().optional(), spec_md: z.string().optional(), caveats_md: z.string().optional(),
      status: z.enum(PURCHASE_STATUS as unknown as [string, ...string[]]).optional(), budget_yuan: z.number().nullable().optional(), qty: z.number().int().optional(),
      needed_by: iso.nullable().optional(), project: z.string().optional(), chosen_quote_id: z.string().optional(), order_no: z.string().optional(),
      holder: z.string().optional(), location: z.string().optional(), warranty_until: iso.nullable().optional(),
      invoice_status: z.enum(["none", "requested", "received", "not_needed"]).optional(),
      add_quote: z.object({ vendor: z.string(), url: z.string().optional(), model: z.string().optional(), price_yuan: z.number(), shipping_yuan: z.number().optional(), notes: z.string().optional() }).optional(),
    }),
    handler: async (i, ctx) => {
      const p = i.project ? resolveProjectOrNull(i.project) : null;
      gate(ctx, p?.id ?? null, "purchase_save");
      let r = savePurchase({ id: i.id, title: i.title, specMd: i.spec_md, caveatsMd: i.caveats_md, status: i.status, budgetYuan: i.budget_yuan, qty: i.qty, neededBy: i.needed_by as never, projectId: p ? p.id : undefined, chosenQuoteId: i.chosen_quote_id, orderNo: i.order_no, holder: i.holder, location: i.location, warrantyUntil: i.warranty_until as never, invoiceStatus: i.invoice_status }, ctx.actor);
      if (i.add_quote) r = addQuote(r.id, { vendor: i.add_quote.vendor, url: i.add_quote.url, model: i.add_quote.model, priceYuan: i.add_quote.price_yuan, shippingYuan: i.add_quote.shipping_yuan, notes: i.add_quote.notes }, ctx.actor);
      const hints: string[] = [];
      if (r.overBudget) hints.push("选定的报价超预算了。");
      if (r.invoicePending) hints.push("记得要发票（invoice_status）。");
      return envelope({ purchase: r }, hints);
    },
  },
  {
    name: "deal_save",
    title: "客户合作：记合作 / 推进阶段 / 下一步",
    description:
      `合作机会（谈一个客户、一次合作）。阶段：${DEAL_STAGES.join(" → ")}。推进中的合作必须有 next_step 和 next_step_at（下一步做什么、什么时候）——这是最容易丢的；没谈成必须写 lost_reason。\n` +
      "org 写机构名（不存在会自动建），contact 一并登记联系人。要准备的材料用 checklist_add(owner_type=deal, owner_id=…) 挂上。谈成后可用 project_create(template=client) 转成交付项目，再把 project 关联回来。",
    write: true,
    input: z.object({
      id: z.string().optional(), title: z.string().optional(), org: z.string().optional(),
      contact: z.object({ name: z.string(), title: z.string().optional(), phone: z.string().optional(), wechat: z.string().optional(), email: z.string().optional() }).optional(),
      stage: z.enum(DEAL_STAGES as unknown as [string, ...string[]]).optional(), amount_yuan: z.number().nullable().optional(), probability: z.number().int().optional(),
      expected_close_at: iso.nullable().optional(), next_step: z.string().optional(), next_step_at: iso.nullable().optional(),
      lost_reason: z.string().optional(), notes_md: z.string().optional(), project: z.string().optional(),
    }),
    handler: async (i, ctx) => {
      const p = i.project ? resolveProjectOrNull(i.project) : null;
      gate(ctx, p?.id ?? null, "deal_save");
      const c = i.contact ? saveContact({ org: i.org ?? null, name: i.contact.name, title: i.contact.title, phone: i.contact.phone, wechat: i.contact.wechat, email: i.contact.email, touched: true }, ctx.actor) : null;
      const d = saveDeal({ id: i.id, title: i.title, org: i.org, contactId: c?.id, stage: i.stage, amountYuan: i.amount_yuan, probability: i.probability, expectedCloseAt: i.expected_close_at as never, nextStep: i.next_step, nextStepAt: i.next_step_at as never, lostReason: i.lost_reason, notesMd: i.notes_md, projectId: p ? p.id : undefined }, ctx.actor);
      const hints: string[] = [];
      if (d.noNextStep) hints.push("这条合作还没有「下一步」，请补上 next_step 与 next_step_at。");
      if (d.stage === "won" && !d.projectId) hints.push("已签约：可以 project_create(template=client) 建交付项目，再 deal_save(project=…) 关联。");
      return envelope({ deal: d }, hints);
    },
  },
  {
    name: "trip_save",
    title: "行程：出差/拜访客户",
    description: "记行程（时间、城市、交通段、住宿、同行人、关联合作）。新建时默认生成行前与行后准备清单（订票、订酒店、带资料、票据报销、纪要归档）；改出发日会自动平移未完成的准备事项。",
    write: true,
    input: z.object({
      id: z.string().optional(), title: z.string().optional(), purpose: z.string().optional(), city: z.string().optional(),
      start_at: iso.optional(), end_at: iso.optional(), deal_id: z.string().optional(), project: z.string().optional(),
      legs: z.array(z.object({ type: z.string().optional(), no: z.string().optional(), from: z.string().optional(), to: z.string().optional(), depart_at: iso.optional(), arrive_at: iso.optional(), order_no: z.string().optional() })).optional(),
      lodging: z.array(z.object({ name: z.string().optional(), address: z.string().optional(), check_in: iso.optional(), check_out: iso.optional(), order_no: z.string().optional() })).optional(),
      attendees: z.string().optional(), notes_md: z.string().optional(), with_prep: z.boolean().optional(),
    }),
    handler: async (i, ctx) => {
      const p = i.project ? resolveProjectOrNull(i.project) : null;
      gate(ctx, p?.id ?? null, "trip_save");
      const t = saveTrip({
        id: i.id, title: i.title, purpose: i.purpose, city: i.city, startAt: i.start_at, endAt: i.end_at, dealId: i.deal_id, projectId: p ? p.id : undefined,
        legs: i.legs?.map((l: Record<string, unknown>) => ({ type: l.type, no: l.no, from: l.from, to: l.to, departAt: l.depart_at, arriveAt: l.arrive_at, orderNo: l.order_no })) as never,
        lodging: i.lodging?.map((l: Record<string, unknown>) => ({ name: l.name, address: l.address, checkIn: l.check_in, checkOut: l.check_out, orderNo: l.order_no })) as never,
        attendees: i.attendees, notesMd: i.notes_md, withPrep: i.with_prep,
      }, ctx.actor);
      return envelope({ trip: t });
    },
  },
  {
    name: "affairs_list",
    title: "公司事务总览（采购 / 合作 / 联系人 / 行程）",
    description: "一次看公司层面的在办事务：未完成采购、在谈合作（含下一步与是否逾期）、很久没联系的人、近期行程。",
    input: z.object({ include_closed: z.boolean().optional() }),
    handler: async (i) => envelope({
      purchases: listPurchases({ open: !i.include_closed }).map((p) => ({ id: p.id, title: p.title, status: p.label, budget: p.budget, cheapest: p.cheapest ? `${p.cheapest.vendor} ¥${p.cheapest.total}` : null, needed_by: p.neededBy, late: p.late || undefined, invoice_pending: p.invoicePending || undefined })),
      deals: listDeals({ open: !i.include_closed }).map((d) => ({ id: d.id, title: d.title, org: d.org?.name, stage: d.label, amount: d.amount, next_step: d.nextStep, next_step_at: d.nextStepAt, next_overdue: d.nextOverdue || undefined, prep_open: d.prepOpen })),
      contacts_to_follow: listContacts().filter((c) => c.overdueContact).map((c) => ({ id: c.id, name: c.name, org: c.orgName, days_since: c.daysSince })),
      trips: listTrips({ upcoming: true }).map((t) => ({ id: t.id, title: t.title, city: t.city, start_at: t.startAt, end_at: t.endAt, phase: t.phase, prep_open: t.prepOpen })),
    }),
  },
  {
    name: "today",
    title: "秘书：今天的全部（做什么 / 要拍板 / 在等谁 / 快到期 / 拖着没动）",
    description:
      "开工先调这个。返回：today 今天要做的（逾期→今天到期→计划→进行中；P0 不自动进，由用户挑）；decisions 只有用户能定的事；waiting 在等别人的（nudge=该催了）；upcoming 7 天内的台账/合作/采购/行程节点；stale 一拖再拖或 14 天没动的；top3 本周三件事。\n" +
      "plan_add / plan_remove：把事项加入/移出今天的计划（只放你今天真会做的）。",
    write: true,
    input: z.object({ plan_add: z.array(z.string()).optional(), plan_remove: z.array(z.string()).optional() }),
    handler: async (i, ctx) => {
      const changed = (i.plan_add?.length ?? 0) + (i.plan_remove?.length ?? 0);
      if (changed) {
        for (const id of [...(i.plan_add ?? []), ...(i.plan_remove ?? [])]) {
          const it = db.select().from(s.items).where(eq(s.items.id, id)).get();
          if (it) gate(ctx, it.projectId, "today");
        }
        if (i.plan_add?.length) planToday(i.plan_add, true, ctx.actor);
        if (i.plan_remove?.length) planToday(i.plan_remove, false, ctx.actor);
      }
      const o = secretaryOverview();
      const hints: string[] = [];
      if (o.counts.nudge) hints.push(`有 ${o.counts.nudge} 件到了该催的时候，替用户起草催办消息或提醒用户。`);
      if (o.stale.some((x) => x.reason === "rolled")) hints.push("有事项连续多天计划了没做：问用户是今天做、改日期、先放一放还是不做了，不要默默再滚一天。");
      if (!o.top3.length) hints.push("本周还没定三件事：可用 weekly_review 起草，用户在网页确认。");
      return envelope({
        date: o.date, counts: o.counts,
        top3: o.top3,
        today: o.today.map((x) => ({ id: x.id, title: x.title, project: x.projectName, why: x.why, status: x.status, priority: x.priority, due_at: x.dueAt, rolled: x.rollCount || undefined })),
        decisions: o.decisions.map((d) => ({ kind: d.kind, label: d.label, title: d.title, detail: d.detail, target: `${d.targetType}:${d.targetId}` })),
        waiting: o.waiting.map((w) => ({ id: w.id, title: w.title, project: w.projectName, waiting_for: w.waitingFor, waited_days: w.waitedDays, follow_up_at: w.followUpAt, nudge: w.nudge || undefined })),
        upcoming: o.upcoming.map((e) => ({ kind: e.kind, title: e.title, at: e.start, note: e.note })),
        stale: o.stale.map((x) => ({ id: x.id, title: x.title, project: x.projectName, reason: x.reason, roll_count: x.rollCount, idle_days: x.idleDays })),
      }, hints);
    },
  },
  {
    name: "weekly_review",
    title: "每周复盘（取素材 / 起草本周三件事）",
    description:
      "不带 top3：返回本周复盘素材（完成、新增、延期、放弃、等待、拖延、没有下一步的项目、上周三件事完成情况）。\n" +
      "带 top3（最多 3 条，可带 item_id）+ notes：保存为草稿，用户在网页「复盘」确认后生效；用户已确认的复盘 agent 不能改。",
    write: true,
    input: z.object({
      week: z.string().optional().describe("周一日期 YYYY-MM-DD，默认本周"),
      top3: z.array(z.object({ title: z.string(), item_id: z.string().optional() })).max(3).optional(),
      notes: z.string().optional(),
    }),
    handler: async (i, ctx) => {
      if (i.top3) {
        gate(ctx, null, "weekly_review");
        const r = saveWeeklyReview({ week: i.week, top3: i.top3.map((x: { title: string; item_id?: string }) => ({ title: x.title, itemId: x.item_id })), notesMd: i.notes }, ctx.actor);
        return envelope({ review: { week: r.weekStart, status: r.status, top3: r.top3, notes: r.notesMd } }, r.status === "draft" ? ["已保存为草稿，请用户到网页「复盘」确认。"] : []);
      }
      const m = weeklyMaterial(i.week);
      return envelope(m as unknown as Record<string, unknown>);
    },
  },
  {
    name: "calendar_agenda",
    title: "日程：某段时间内所有带日期的事",
    description: "把事项截止、阶段节点、台账到期、采购需到货、合作下一步、行程合在一起按时间排。不传时间默认今天起 14 天。安排「这周做什么」前先看它。",
    input: z.object({ from: iso.optional(), to: iso.optional() }),
    handler: async (i) => {
      const now = Math.floor(Date.now() / 1000);
      const from = i.from ?? now - 86400, to = i.to ?? now + 14 * 86400;
      return envelope({ events: agenda(from, to).map((e) => ({ kind: e.kind, title: e.title, at: e.start, end: e.end, tone: e.tone, note: e.note, link: e.href })) });
    },
  },
  {
    name: "search",
    title: "全站搜索",
    description: "跨项目/任务/会议/笔记/决定/资料搜索关键词。types 可选 item,meeting,note,decision,file,project。",
    input: z.object({ q: z.string(), types: z.array(z.string()).optional(), limit: z.number().int().max(100).optional() }),
    handler: async (i) => envelope({ hits: search(i.q, { types: i.types, limit: i.limit }) }),
  },
  {
    name: "session_end",
    title: "结束会话",
    description: "收工调用：写会话总结与交接说明，释放本会话认领的任务，把未完成项转成提醒。",
    write: true,
    input: z.object({ session_id: z.string(), summary: z.string(), release_claims: z.boolean().optional() }),
    handler: async (i, ctx) => {
      const claimed = db.select().from(s.items).all().filter((x) => x.claimedBy === i.session_id);
      if (i.release_claims !== false) for (const c of claimed) releaseItem(c.id, ctx.actor);
      closeSession(i.session_id, i.summary);
      return envelope({ closed: true, released: claimed.length, summary: i.summary }, ["下次连接请再次调用 onboard。"]);
    },
  },
  {
    name: "agents_list",
    title: "查看 agent 会话",
    description: "查看近期哪些 agent 会话在运行、各自在做什么（只读）。",
    input: z.object({}),
    handler: async () => envelope({ sessions: listSessions() }),
  },
  {
    name: "meetings_list",
    title: "列出会议档案",
    description: "列出会议档案（含摘要、来源、附件）。可按项目过滤。",
    input: z.object({ project: z.string().optional(), limit: z.number().int().max(100).optional() }),
    handler: async (i) => {
      const p = i.project ? resolveProjectOrNull(i.project) : null;
      return envelope({ meetings: listMeetings(p?.id, i.limit) });
    },
  },
  {
    name: "meeting_draft_items",
    title: "为会议整理一版清单草稿（不落库）",
    description:
      "用户在网页点了「整理清单」、或明确让你\"看看这条会议有哪些事要做\"时调用：按规则从会议原文抽出一版待办草稿，只返回给你看，不写任何任务。\n" +
      "你审阅后可以改编，再调 checklist_add 落库（推荐，由你做判断），或让用户自己在网页上确认保存。",
    input: z.object({ meeting_id: z.string() }),
    handler: async (i) => envelope(await previewMeetingItems(i.meeting_id), ["草稿不会自动写入。确认后再用 checklist_add 落库，重复的用 checklist_add 前先 checklist_list 核对。"]),
  },
  {
    name: "meeting_get",
    title: "查看会议详情",
    description: "按 id 获取会议全文、摘要、附件与它衍生出的任务清单。",
    input: z.object({ id: z.string() }),
    handler: async (i) => {
      const m = getMeeting(i.id);
      if (!m) throw Object.assign(new Error("会议不存在"), { status: 404 });
      return envelope({ meeting: m });
    },
  },
];

export const toolsByName = new Map(tools.map((t) => [t.name, t]));

// 供 REST / openapi 使用
export { envelope };
