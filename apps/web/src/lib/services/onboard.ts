import { db, s } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";
import { listProjects, getInbox } from "./projects";
import { pullReminders, countOpen } from "./reminders";
import { listPolicies } from "./policies";
import { portfolioCards } from "./board";

export function agentOnboard(agent: { name: string; sessionId: string }) {
  const projects = listProjects({});
  const inbox = getInbox();
  const inboxRows = db.select().from(s.items).where(eq(s.items.projectId, inbox.id)).all().filter((x) => x.parkingLot != null && !["done", "dropped"].includes(x.status));
  const reminders = pullReminders({}).slice(0, 20);
  const allPolicies = listPolicies();
  const globalPolicies = allPolicies.filter((p) => !p.projectId && p.required && p.live && !p.acked);
  const openItems = db.select().from(s.items).where(eq(s.items.status, "doing")).limit(20).all();
  const claimedByMe = db.select().from(s.items).where(eq(s.items.claimedBy, agent.sessionId)).all();
  const recentMeetings = db.select().from(s.meetings).orderBy(desc(s.meetings.heldAt)).limit(5).all();
  const changelog = db.select().from(s.agentChangelog).orderBy(desc(s.agentChangelog.createdAt)).limit(5).all();
  const mojibake = db.select().from(s.items).where(and(eq(s.items.status, "changed"), eq(s.items.needsReview, 0))).all()
    .filter((i) => i.evidence.trim().length <= 12 || /^(进行中|继续|有进展|处理中|做了一部分)/.test(i.evidence.trim())).slice(0, 10);
  const suspiciousDone = db.select().from(s.items).where(eq(s.items.needsReview, 1)).all().slice(0, 10);
  return {
    you: { agent_name: agent.name, session_id: agent.sessionId },
    projects: (() => {
      const cards = new Map((portfolioCards() as Array<{ id: string; health: string; current: string | null; release: { name: string; mustDone: number; mustTotal: number; ready: boolean } | null; waiting: number }>).map((c) => [c.id, c]));
      return projects.filter((p) => p.status === "active").map((p) => {
        const c = cards.get(p.id);
        return {
          id: p.id, key: p.key, name: p.name, kind: p.kind,
          progress: p.progress, due_at: p.dueAt, github: p.githubRepo || undefined,
          health: c?.health, current_phase: c?.current ?? undefined,
          release: c?.release ? `${c.release.name} 必过 ${c.release.mustDone}/${c.release.mustTotal}${c.release.ready ? "，可放行" : ""}` : undefined,
          waiting: c?.waiting || undefined,
        };
      });
    })(),
    inbox: {
      project_key: inbox.key,
      pending: inboxRows.length,
      items: inboxRows.slice(0, 10).map((i) => ({ item_id: i.id, title: i.title, created_at: i.createdAt })),
      how: "确认归属后调用 item_move(item_id, project)；不知道该放哪就留着，不要乱塞进业务项目。",
    },
    reminders_unread: { total: countOpen(), items: reminders.map((r) => ({ id: r.id, kind: r.kind, severity: r.severity, title: r.title, project_id: r.projectId })) },
    required_policies_unacked: globalPolicies.map((p) => ({ id: p.id, title: p.title, version: p.version, applies_to_tools: p.tools, scope_mode: p.scopeMode })),
    your_claims: claimedByMe.map((i) => ({ item_id: i.id, title: i.title, status: i.status, project_id: i.projectId })),
    in_progress_by_others: openItems.filter((i) => i.claimedBy && i.claimedBy !== agent.sessionId).map((i) => ({ item_id: i.id, title: i.title, claimed_by: i.claimedBy })),
    recent_meetings: recentMeetings.map((m) => ({ id: m.id, title: m.title, project_id: m.projectId, held_at: m.heldAt })),
    needs_attention: {
      done_evidence_suspect: suspiciousDone.map((i) => ({ item_id: i.id, title: i.title, evidence: i.evidence.slice(0, 120) })),
      changed_without_detail: mojibake.map((i) => ({ item_id: i.id, title: i.title, note: i.evidence })),
    },
    since_last_time: changelog.map((c) => ({ version: c.version, title: c.title })),
    how_to_work: WORKFLOW,
  };
}

const WORKFLOW = [
  "1. 读条例：若有必读未确认条例，先 policy_read，再 policy_ack，否则写操作会被门禁拦截。",
  "2. 定项目：从 projects 里按 key/name 匹配；没有就 project_create。无法判断归属时：任务用 checklist_add 省略 project（进收件箱），会议/历史用 meeting_import/ingest_history 省略 project，不要猜着写进某个项目。",
  "3. 看全貌：project_board(project) 一次拿到当前阶段、能不能发版、缺哪几项、谁卡着谁、需求漏斗；再用 checklist_list(project, status='open') 看具体事项。不要凭记忆假设。",
  "3b. 需求闭环：用户提出的每个要求先 requirement_save 记成需求；确认要做后 checklist_add 拆事项时带 requirement=编号。不做了就 status=dropped 并写 close_reason（需用户确认）。不允许有需求悄悄消失。",
  "3c. 结构：新项目用 project_create(template=app/miniprogram/saas/client/basic) 自动建好阶段和备案、软著、账号、隐私协议等配套事项；老项目用 template_apply 补。新事项写 kind（资质/账号/采购/合同…）、milestone、must_meet；有先后关系用 item_link 或 blocked_by。",
  "4. 开工：claim_item 认领（会显示他人认领情况），着手做；记得每 30 分钟 sync 一次心跳。",
  "5. 记录：会议由 meeting_import 归档并自动抽取事务；决定用 decision_record；零散知识用 note_save。",
  "6. 核销：完成后 checklist_update status='done' 必须带 evidence（做了什么、在哪验证、链接/路径）。证据要说清【做到什么程度】——只写「已对接」「在推进」「完成一半」会被判定为进度而不是完成，任务进入待核实。",
  "6b. 进展：同一件事往前走了一步（见客户、发了材料、拿到反馈）用 checklist_progress 记在该任务上；不要用 checklist_add 新建「跟进××」这类过程性条目。",
  "6c. 版本：需求变了导致原目标作废时用 checklist_supersede 升级为新版本，旧任务会自动关闭并注明被取代；关联事项用 parent_id 挂到上一级，别平铺。",
  "7. 变更：做不了按原样完成就 status='changed' 并写清变更内容（新范围、对谁有影响）；被卡住 status='blocked' + block_reason。",
  "8. 收尾：收工前 checklist_verify 全量核对，把 gaps 补齐；file_register 登记产物位置；session_end 写总结。",
  "9. 提醒：工具返回值里 reminders_unread 有未读提醒，先处理 P0。",
  "10. 分拣：inbox.pending > 0 时，看 inbox.items，确认归属后 item_move 分拣；分不清就保持原样并在会话总结里说明。",
  "11. 条例：你只能 policy_write 提议条例（进入待批准），由用户在网页批准；不要试图修改或废止条例。",
  "12. 阶段门：阶段放行只能由用户在网页决定。你判断可以放行时，用 milestone_save 的 gate_proposal 写建议和依据。每周用 project_update_post 发一次进展（进展/阻塞/下一步 + 健康度）。",
].join("\n");
