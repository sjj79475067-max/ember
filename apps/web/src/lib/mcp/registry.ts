import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Ctx } from "@/lib/http/api";
import { listProjects, getProject, createProject, updateProject, resolveProjectOrNull, getInbox } from "@/lib/services/projects";
import { addItems, listItems, updateItem, claimItem, releaseItem, verifyChecklist, progressFor, moveItem, mergeItems, addProgress, supersedeItem, findDuplicates } from "@/lib/services/items";
import { moveFile } from "@/lib/services/files";
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
      })).min(1).max(50),
    }),
    handler: async (i, ctx) => {
      const p = i.project ? resolveProjectOrNull(i.project) : getInbox();
      gate(ctx, p!.isInbox ? null : p!.id, "checklist_add");
      const res = addItems(p!.id, i.items.map((x: Record<string, string>) => ({
        title: x.title, detailMd: x.detail_md, doneDefinition: x.done_definition,
        priority: x.priority as never, dueAt: x.due_at as never, parentId: x.parent_id, sourceType: "agent" as const,
        workstreamId: x.group ? ensureGroup(p!.id, x.group).id : null,
      })), ctx.actor, ctx.ip);
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
    }),
    handler: async (i, ctx) => {
      const before = db.select().from(s.items).all().find((x) => x.id === i.item_id);
      if (before) gate(ctx, before.projectId, "checklist_update");
      if (i.status === "done" && !(i.evidence || i.note)) throw Object.assign(new Error("验收失败：status=done 必须提供 evidence（做了什么、如何验证）"), { status: 422 });
      if (i.status === "blocked" && !i.block_reason) throw Object.assign(new Error("请提供 block_reason 说明卡在哪里、需要谁做什么"), { status: 422 });
      try {
        let res = updateItem(i.item_id, {
          status: i.status as never, note: i.note, evidence: i.evidence, blockReason: i.block_reason,
          dueAt: i.due_at as never, priority: i.priority as never, expectedVersion: i.expected_version,
        }, ctx.actor, i.session_id, ctx.ip);
        if (i.group !== undefined) {
          setItemGroup(i.item_id, i.group);
          res.item = db.select().from(s.items).where(eq(s.items.id, i.item_id)).get()!;
        }
        const hints: string[] = [];
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
