import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";

const tsDef = sql`(cast(strftime('%s','now') as integer))`;
const now = () => integer().notNull().default(tsDef);

// ---------- 身份 ----------
export const users = sqliteTable("users", {
  id: text().primaryKey(),
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text().notNull(),
  role: text({ enum: ["owner", "member", "client"] }).notNull().default("owner"),
  createdAt: now(),
  updatedAt: now(),
});

export const sessions = sqliteTable("sessions", {
  id: text().primaryKey(),
  userId: text().notNull(),
  tokenHash: text().notNull().unique(),
  expiresAt: integer().notNull(),
  createdAt: now(),
});

export const apiTokens = sqliteTable("api_tokens", {
  id: text().primaryKey(),
  userId: text().notNull(),
  name: text().notNull(),
  agentType: text().notNull().default("generic"),
  prefix: text().notNull(),
  hash: text().notNull().unique(),
  scopes: text().notNull().default("read,write"),
  lastUsedAt: integer(),
  revokedAt: integer(),
  createdAt: now(),
});

// ---------- 项目与清单 ----------
export const projects = sqliteTable("projects", {
  id: text().primaryKey(),
  key: text().notNull().unique(), // IT, ADMIN-FIN ...
  name: text().notNull(),
  kind: text({ enum: ["it", "admin", "client", "knowledge"] }).notNull().default("admin"),
  isInbox: integer().notNull().default(0), // 1 = 收件箱（只此一个，未归类内容先进这里）
  aliases: text().notNull().default(""), // 逗号分隔的历史代号/别称，便于老 agent 用旧代号仍能命中
  status: text({ enum: ["active", "paused", "done", "archived"] }).notNull().default("active"),
  summaryMd: text().notNull().default(""),
  dueAt: integer(),
  localRoot: text().notNull().default(""),
  githubRepo: text().notNull().default(""),
  archiveNote: text().notNull().default(""),
  position: integer().notNull().default(0),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index("idx_projects_status").on(t.status)]);

export const workstreams = sqliteTable("workstreams", {
  id: text().primaryKey(),
  projectId: text().notNull(),
  name: text().notNull(),
  intent: text().notNull().default(""),
  position: integer().notNull().default(0),
  createdAt: now(),
}, (t) => [index("idx_ws_project").on(t.projectId)]);

export const items = sqliteTable("items", {
  id: text().primaryKey(),
  projectId: text().notNull(),
  workstreamId: text(),
  parkingLot: integer(),
  needsReview: integer().notNull().default(0), // 1 = 已完成但证据与标题对不上，待核实
  supersededBy: text().notNull().default(""), // 被哪个更新后的任务替代（版本更迭链）
  parentId: text(),
  title: text().notNull(),
  detailMd: text().notNull().default(""),
  doneDefinition: text().notNull().default(""),
  status: text({ enum: ["todo", "doing", "blocked", "done", "dropped", "changed"] }).notNull().default("todo"),
  priority: text({ enum: ["P0", "P1", "P2", "P3"] }).notNull().default("P1"),
  dueAt: integer(),
  evidence: text().notNull().default(""),
  blockReason: text().notNull().default(""),
  claimedBy: text().notNull().default(""), // agent session id or "user"
  claimedAt: integer(),
  claimNote: text().notNull().default(""),
  sourceType: text({ enum: ["meeting", "decision", "import", "manual", "agent"] }).notNull().default("manual"),
  sourceProjectKey: text().notNull().default(""), // 从别的项目拆出来/移动过来时记录来源
  sourceRef: text().notNull().default(""),
  position: integer().notNull().default(0),
  version: integer().notNull().default(1),
  completedAt: integer(),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [
  index("idx_items_project_status").on(t.projectId, t.status),
  index("idx_items_due").on(t.dueAt),
  index("idx_items_claim").on(t.claimedBy),
]);

export const itemEvents = sqliteTable("item_events", {
  id: text().primaryKey(),
  itemId: text().notNull(),
  actorType: text({ enum: ["user", "agent", "system"] }).notNull(),
  actorName: text().notNull().default(""),
  action: text().notNull().default("update"), // create|update|claim|release|complete|change|block
  fromStatus: text().notNull().default(""),
  toStatus: text().notNull().default(""),
  note: text().notNull().default(""),
  evidence: text().notNull().default(""),
  createdAt: now(),
}, (t) => [index("idx_events_item").on(t.itemId)]);

// ---------- 档案：会议 / 决定 / 笔记 ----------
export const meetings = sqliteTable("meetings", {
  id: text().primaryKey(),
  projectId: text().notNull(),
  title: text().notNull(),
  heldAt: integer().notNull(),
  participants: text().notNull().default(""),
  source: text().notNull().default("manual"), // feishu|tencent|recording|paste|agent|...
  minutesMd: text().notNull().default(""),
  summaryMd: text().notNull().default(""),
  attachments: text().notNull().default("[]"), // JSON: [{name,path,url,size}]
  tags: text().notNull().default(""),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index("idx_meetings_project").on(t.projectId, t.heldAt)]);

export const decisions = sqliteTable("decisions", {
  id: text().primaryKey(),
  projectId: text().notNull(),
  title: text().notNull(),
  rationaleMd: text().notNull().default(""),
  impact: text().notNull().default(""),
  status: text({ enum: ["proposed", "accepted", "superseded"] }).notNull().default("accepted"),
  meetingId: text(),
  createdAt: now(),
}, (t) => [index("idx_decisions_project").on(t.projectId)]);

export const notes = sqliteTable("notes", {
  id: text().primaryKey(),
  projectId: text(),
  title: text().notNull(),
  bodyMd: text().notNull().default(""),
  tags: text().notNull().default(""),
  source: text().notNull().default("manual"),
  createdAt: now(),
  updatedAt: now(),
});

// ---------- 资料定位（不存文件本体） ----------
export const fileRefs = sqliteTable("file_refs", {
  id: text().primaryKey(),
  projectId: text().notNull(),
  itemId: text(),
  label: text().notNull(),
  machine: text().notNull().default(""),
  path: text().notNull().default(""),
  url: text().notNull().default(""),
  kind: text().notNull().default("file"), // file|dir|repo|link
  archiveTo: text({ enum: ["local", "github", "r2", "other"] }).notNull().default("local"),
  sizeBytes: integer(),
  status: text({ enum: ["active", "moved", "missing", "archived"] }).notNull().default("active"),
  note: text().notNull().default(""),
  lastVerifiedAt: integer(),
  verifiedBy: text().notNull().default(""),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index("idx_files_project").on(t.projectId), index("idx_files_verified").on(t.lastVerifiedAt)]);

// ---------- 提醒 / 条例 ----------
export const reminders = sqliteTable("reminders", {
  id: text().primaryKey(),
  projectId: text(),
  targetType: text().notNull().default("item"),
  targetId: text().notNull().default(""),
  kind: text({ enum: ["due", "overdue", "blocked", "policy", "stale_file", "review", "digest"] }).notNull(),
  severity: text({ enum: ["P0", "P1", "P2"] }).notNull().default("P1"),
  title: text().notNull(),
  bodyMd: text().notNull().default(""),
  dedupeKey: text().notNull().unique(),
  status: text({ enum: ["open", "acked", "snoozed", "done"] }).notNull().default("open"),
  snoozedUntil: integer(),
  ackedAt: integer(),
  ackedBy: text().notNull().default(""),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index("idx_reminders_status").on(t.status, t.severity)]);

export const policies = sqliteTable("policies", {
  id: text().primaryKey(),
  projectId: text(),
  title: text().notNull(),
  bodyMd: text().notNull().default(""),
  version: integer().notNull().default(1),
  required: integer().notNull().default(0),
  appliesToTools: text().notNull().default(""),
  // draft=起草中(agent 写的不生效) pending=待批准 active=生效 retired=已废止
  status: text({ enum: ["draft", "pending", "active", "retired"] }).notNull().default("active"),
  purpose: text().notNull().default(""),   // 这条规矩管什么、依据是什么
  scopeMode: text({ enum: ["tools", "all"] }).notNull().default("tools"), // all = 所有写操作（需用户批准）
  expiresAt: integer(),
  reviewEveryDays: integer(),
  lastReviewedAt: integer(),
  proposedBy: text().notNull().default(""),
  approvedBy: text().notNull().default(""),
  approvedAt: integer(),
  active: integer().notNull().default(1),
  createdAt: now(),
  updatedAt: now(),
});

export const policyAcks = sqliteTable("policy_acks", {
  id: text().primaryKey(),
  policyId: text().notNull(),
  policyVersion: integer().notNull(),
  actorType: text().notNull().default("agent"),
  actorName: text().notNull().default(""),
  createdAt: now(),
}, (t) => [uniqueIndex("idx_ack_unique").on(t.policyId, t.policyVersion, t.actorName)]);

// ---------- Agent 会话 / 审计 / 导入 ----------
export const agentSessions = sqliteTable("agent_sessions", {
  id: text().primaryKey(),
  tokenId: text(),
  agentName: text().notNull(),
  agentType: text().notNull().default("generic"),
  machine: text().notNull().default(""),
  sessionRef: text().notNull().default(""),
  status: text({ enum: ["open", "closed"] }).notNull().default("open"),
  summary: text().notNull().default(""),
  startedAt: now(),
  lastSeenAt: now(),
  closedAt: integer(),
}, (t) => [index("idx_asess_agent").on(t.agentName, t.status)]);

export const auditLog = sqliteTable("audit_log", {
  id: text().primaryKey(),
  actorType: text().notNull(),
  actorName: text().notNull().default(""),
  action: text().notNull(),
  entity: text().notNull(),
  entityId: text().notNull().default(""),
  diffJson: text().notNull().default("{}"),
  requestId: text().notNull().default(""),
  ip: text().notNull().default(""),
  createdAt: now(),
}, (t) => [index("idx_audit_entity").on(t.entity, t.entityId), index("idx_audit_time").on(t.createdAt)]);

export const importBatches = sqliteTable("import_batches", {
  id: text().primaryKey(),
  projectId: text(),
  kind: text().notNull().default("meeting"), // meeting|notes|checklist
  source: text().notNull().default("paste"),
  fingerprint: text().notNull().unique(),
  rawText: text().notNull().default(""),
  summaryMd: text().notNull().default(""),
  createdItemIds: text().notNull().default("[]"),
  createdAt: now(),
});

// ---------- AI ----------
export const aiProviders = sqliteTable("ai_providers", {
  id: text().primaryKey(),
  label: text().notNull(),
  kind: text().notNull().default("openai_compat"), // anthropic|openai_compat
  baseUrl: text().notNull().default(""),
  model: text().notNull().default(""),
  apiKeyEnc: text().notNull().default(""),
  enabled: integer().notNull().default(1),
  isDefault: integer().notNull().default(0),
  createdAt: now(),
});

export const aiUsage = sqliteTable("ai_usage", {
  id: text().primaryKey(),
  providerId: text().notNull(),
  feature: text().notNull(),
  inputTokens: integer().notNull().default(0),
  outputTokens: integer().notNull().default(0),
  ms: integer().notNull().default(0),
  ok: integer().notNull().default(1),
  createdAt: now(),
});

export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text().notNull().default(""),
  updatedAt: now(),
});

export const agentChangelog = sqliteTable("agent_changelog", {
  id: text().primaryKey(),
  version: text().notNull(),
  title: text().notNull(),
  bodyMd: text().notNull().default(""),
  createdAt: now(),
});

export type Item = typeof items.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type FileRef = typeof fileRefs.$inferSelect;
export type Policy = typeof policies.$inferSelect;
