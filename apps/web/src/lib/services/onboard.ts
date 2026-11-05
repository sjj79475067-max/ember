import { db, s } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { listProjects, getInbox } from "./projects";
import { pullReminders, countOpen } from "./reminders";
import { listPolicies } from "./policies";

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
  return {
    you: { agent_name: agent.name, session_id: agent.sessionId },
    projects: projects.filter((p) => p.status === "active").map((p) => ({
      id: p.id, key: p.key, name: p.name, kind: p.kind,
      progress: p.progress, due_at: p.dueAt, github: p.githubRepo || undefined,
    })),
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
    since_last_time: changelog.map((c) => ({ version: c.version, title: c.title })),
    how_to_work: WORKFLOW,
  };
}

const WORKFLOW = [
  "1. 读条例：若有必读未确认条例，先 policy_read，再 policy_ack，否则写操作会被门禁拦截。",
  "2. 定项目：从 projects 里按 key/name 匹配；没有就 project_create。无法判断归属时：任务用 checklist_add 省略 project（进收件箱），会议/历史用 meeting_import/ingest_history 省略 project，不要猜着写进某个项目。",
  "3. 看清单：checklist_list(project, status='open')，不要凭记忆假设。项目分类多时用 group 过滤；分组用 project_groups 设置。",
  "4. 开工：claim_item 认领（会显示他人认领情况），着手做；记得每 30 分钟 sync 一次心跳。",
  "5. 记录：会议由 meeting_import 归档并自动抽取事务；决定用 decision_record；零散知识用 note_save。",
  "6. 核销：完成后 checklist_update status='done' 必须带 evidence（做了什么、在哪验证、链接/路径）。",
  "7. 变更：做不了按原样完成就 status='changed' 并写清变更内容；被卡住 status='blocked' + block_reason。",
  "8. 收尾：收工前 checklist_verify 全量核对，把 gaps 补齐；file_register 登记产物位置；session_end 写总结。",
  "9. 提醒：工具返回值里 reminders_unread 有未读提醒，先处理 P0。",
  "10. 分拣：inbox.pending > 0 时，看 inbox.items，确认归属后 item_move 分拣；分不清就保持原样并在会话总结里说明。",
  "11. 条例：你只能 policy_write 提议条例（进入待批准），由用户在网页批准；不要试图修改或废止条例。",
].join("\n");
