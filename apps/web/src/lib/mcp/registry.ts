import { z } from "zod";
import type { Ctx } from "@/lib/http/api";
import { listProjects, getProject, createProject, updateProject } from "@/lib/services/projects";
import { addItems, listItems, updateItem, claimItem, releaseItem, verifyChecklist, progressFor } from "@/lib/services/items";
import { createMeeting, getMeeting, listMeetings } from "@/lib/services/meetings";
import { ingest } from "@/lib/services/ingest";
import { upsertNote, createDecision, listNotes, listDecisions } from "@/lib/services/notes";
import { registerFile, verifyFile, listFiles } from "@/lib/services/files";
import { pullReminders, ackReminders, pendingSummary } from "@/lib/services/reminders";
import { listPolicies, ackPolicy, upsertPolicy, policyGate } from "@/lib/services/policies";
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
  const unacked = policies.filter((p) => p.active && p.required && !acks.some((a) => a.policyId === p.id && a.policyVersion === p.version));
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

function gate(ctx: Ctx, projectId: string | null, tool: string) {
  const g = policyGate(projectId, tool, ctx.actor.name);
  if (g) {
    throw Object.assign(
      new Error(`${g.reason}：${g.policies.map((p) => `${p.title}(v${p.version})`).join("、")}`),
      { status: 403, policy_gate: g },
    );
  }
  const ca = policyGate(null, tool, ctx.actor.name);
  if (ca) {
    const remaining = ca.policies.filter((p) => (ackCache.get(`${ctx.actor.name}:${p.id}`) ?? 0) < Date.now());
    if (remaining.length) {
      throw Object.assign(
        new Error(`存在未确认的必读条例，请先调用 policy_read + policy_ack：${remaining.map((p) => `${p.title}(v${p.version})`).join("、")}`),
        { status: 403, policy_gate: { reason: "policy_unacked", policies: remaining } },
      );
    }
  }
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
      const p = getProject(i.project);
      if (!p) throw Object.assign(new Error("项目不存在"), { status: 404 });
      return envelope({ project: p, progress: progressFor(p.id) });
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
    }),
    handler: async (i, ctx) => {
      const input = { key: i.key, name: i.name, kind: i.kind, status: i.status, summaryMd: i.summary_md, dueAt: i.due_at, localRoot: i.local_root, githubRepo: i.github_repo };
      const p = i.id ? updateProject(i.id, input, ctx.actor, ctx.ip) : createProject(input, ctx.actor, ctx.ip);
      return envelope({ project: { id: p.id, key: p.key, name: p.name, kind: p.kind, status: p.status } });
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
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.number().int().optional(),
    }),
    handler: async (i) => {
      let projectId = i.project;
      if (projectId) projectId = getProject(projectId)?.id ?? projectId;
      const res = listItems({ projectId, status: i.status as never, dueBefore: i.due_before, q: i.q, limit: i.limit, cursor: i.cursor });
      return envelope({
        items: res.items.map((it) => ({
          id: it.id, title: it.title, status: it.status, priority: it.priority, due_at: it.dueAt,
          done_definition: it.doneDefinition, claimed_by: it.claimedBy || null, version: it.version,
          evidence: it.evidence || undefined, block_reason: it.blockReason || undefined,
        })),
        next_cursor: res.nextCursor,
      });
    },
  },
  {
    name: "checklist_add",
    title: "添加任务",
    description: "批量添加任务（1-50 条）。每条写清 title（动词开头）、done_definition（可验收的完成标准）、due_at（如有）。会议衍生的任务请用 meeting_import 自动抽取。",
    write: true,
    input: z.object({
      project: z.string(),
      items: z.array(z.object({
        title: z.string(),
        detail_md: z.string().optional(),
        done_definition: z.string().optional(),
        priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
        due_at: iso.optional(),
        parent_id: z.string().optional(),
      })).min(1).max(50),
    }),
    handler: async (i, ctx) => {
      const p = getProject(i.project);
      if (!p) throw Object.assign(new Error("项目不存在"), { status: 404 });
      gate(ctx, p.id, "checklist_add");
      const res = addItems(p.id, i.items.map((x: Record<string, string>) => ({
        title: x.title, detailMd: x.detail_md, doneDefinition: x.done_definition,
        priority: x.priority as never, dueAt: x.due_at as never, parentId: x.parent_id, sourceType: "agent" as const,
      })), ctx.actor, ctx.ip);
      return envelope({ ids: res.ids, progress: res.progress }, ["建议随后调用 checklist_list 确认已落库。"]);
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
    }),
    handler: async (i, ctx) => {
      const before = db.select().from(s.items).all().find((x) => x.id === i.item_id);
      if (before) gate(ctx, before.projectId, "checklist_update");
      if (i.status === "done" && !(i.evidence || i.note)) throw Object.assign(new Error("验收失败：status=done 必须提供 evidence（做了什么、如何验证）"), { status: 422 });
      if (i.status === "blocked" && !i.block_reason) throw Object.assign(new Error("请提供 block_reason 说明卡在哪里、需要谁做什么"), { status: 422 });
      try {
        const res = updateItem(i.item_id, {
          status: i.status as never, note: i.note, evidence: i.evidence, blockReason: i.block_reason,
          dueAt: i.due_at as never, priority: i.priority as never, expectedVersion: i.expected_version,
        }, ctx.actor, i.session_id, ctx.ip);
        return envelope({ item: res.item, progress: res.progress });
      } catch (e) {
        const err = e as Error & { status?: number; current?: unknown };
        if (err.status === 409) return envelope({ conflict: true, current: err.current, message: err.message });
        throw e;
      }
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
      const p = getProject(i.project);
      if (!p) throw Object.assign(new Error("项目不存在"), { status: 404 });
      return envelope(verifyChecklist(p.id));
    },
  },
  {
    name: "meeting_import",
    title: "导入会议记录（自动建档 + 抽取事务）",
    description:
      "把任何来源的会议记录（飞书/腾讯会议/录音转写/粘贴文本/AI 摘要）归档为会议档案，并自动整理出待办清单。可直接传 items 跳过 AI。返回会议 id 与生成的清单。",
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
      })).optional().describe("如果 agent 自己已整理好事务，直接传，跳过 AI 抽取"),
      parse_with_ai: z.boolean().optional(),
    }),
    handler: async (i, ctx) => {
      const p = getProject(i.project);
      if (!p) throw Object.assign(new Error("项目不存在"), { status: 404 });
      gate(ctx, p.id, "meeting_import");
      const r = await createMeeting({
        projectId: p.id, title: i.title ?? "会议记录", heldAt: i.held_at, participants: i.participants,
        source: i.source ?? "agent", minutesMd: i.text, attachments: i.attachments,
        items: i.items?.map((x: Record<string, unknown>) => ({ title: x.title, detailMd: x.detail_md, doneDefinition: x.done_definition, dueAt: x.due_at, priority: x.priority })) as never,
        parseWithAi: i.parse_with_ai,
      }, ctx.actor, ctx.ip);
      return envelope({ meeting_id: r.meeting?.id, deduped: r.deduped, created_item_ids: r.createdItemIds, summary: r.meeting?.summaryMd });
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
      create_items: z.boolean().optional(),
    }),
    handler: async (i, ctx) => {
      const p = i.project ? getProject(i.project) : null;
      const r = await ingest({ projectId: p?.id, kind: i.kind, title: i.title, text: i.text, source: i.source ?? "agent-history", createItems: i.create_items }, ctx.actor, ctx.ip);
      return envelope(r);
    },
  },
  {
    name: "note_save",
    title: "保存知识/笔记",
    description: "记录零散但重要的信息：咨询结论、规则、账号归属、经验教训。传 id 则更新。",
    write: true,
    input: z.object({ id: z.string().optional(), project: z.string().optional(), title: z.string(), body_md: z.string().optional(), tags: z.string().optional() }),
    handler: async (i, ctx) => {
      const p = i.project ? getProject(i.project) : null;
      const n = upsertNote({ id: i.id, projectId: p?.id ?? null, title: i.title, bodyMd: i.body_md, tags: i.tags, source: ctx.actor.name }, ctx.actor);
      return envelope({ note: n });
    },
  },
  {
    name: "decision_record",
    title: "记录决定",
    description: "记录已确认的决定及其理由与影响面，避免后续反复讨论。",
    write: true,
    input: z.object({ project: z.string(), title: z.string(), rationale_md: z.string().optional(), impact: z.string().optional() }),
    handler: async (i, ctx) => {
      const p = getProject(i.project);
      if (!p) throw Object.assign(new Error("项目不存在"), { status: 404 });
      const d = createDecision({ projectId: p.id, title: i.title, rationaleMd: i.rationale_md, impact: i.impact }, ctx.actor);
      return envelope({ decision: d });
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
      const p = getProject(i.project);
      if (!p) throw Object.assign(new Error("项目不存在"), { status: 404 });
      const f = registerFile({
        projectId: p.id, itemId: i.item_id, label: i.label, machine: i.machine, path: i.path, url: i.url,
        kind: i.kind, archiveTo: i.archive_to, sizeBytes: i.size_bytes, note: i.note,
      }, ctx.actor, i.verify);
      return envelope({ file: f });
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
      const p = i.project ? getProject(i.project) : null;
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
      const p = i.project ? getProject(i.project) : null;
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
    description: "读取 AI 管理条例全文（全局 + 指定项目）。条例是用户对 agent 的硬性要求，必须遵守。",
    input: z.object({ project: z.string().optional(), policy_id: z.string().optional() }),
    handler: async (i) => {
      const p = i.project ? getProject(i.project) : null;
      let rows = listPolicies(p?.id);
      if (i.policy_id) rows = rows.filter((r) => r.id === i.policy_id);
      return envelope({ policies: rows });
    },
  },
  {
    name: "policy_ack",
    title: "确认已读条例",
    description: "确认你已阅读条例当前版本。未确认的必读条例会阻止写操作。",
    write: true,
    input: z.object({ policy_id: z.string() }),
    handler: async (i, ctx) => {
      const r = ackPolicy(i.policy_id, ctx.actor.name);
      db.insert(s.policyAcks).values({ id: newId("pak"), policyId: i.policy_id, policyVersion: r.version, actorType: "agent", actorName: "*", createdAt: Math.floor(Date.now() / 1000) }).onConflictDoNothing().run();
      markPolicyAcked(ctx.actor.name, i.policy_id);
      return envelope(r);
    },
  },
  {
    name: "policy_write",
    title: "新增/更新条例",
    description: "用户口述规则时写入中心。required=true 表示 agent 写操作前必须确认。applies_to_tools 逗号分隔（如 checklist_update,meeting_import）。",
    write: true,
    input: z.object({ id: z.string().optional(), project: z.string().optional(), title: z.string(), body_md: z.string(), required: z.boolean().optional(), applies_to_tools: z.string().optional() }),
    handler: async (i, ctx) => {
      const p = i.project ? getProject(i.project) : null;
      return envelope({ policy: upsertPolicy({ id: i.id, projectId: p?.id ?? null, title: i.title, bodyMd: i.body_md, required: i.required, appliesToTools: i.applies_to_tools }, ctx.actor) });
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
      const p = i.project ? getProject(i.project) : null;
      return envelope({ meetings: listMeetings(p?.id, i.limit) });
    },
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
