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
  template: text().notNull().default(""),
  updateEveryDays: integer().notNull().default(7),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index("idx_projects_status").on(t.status)]);

// ---------- 阶段 / 发布 ----------
export const milestones = sqliteTable("milestones", {
  id: text().primaryKey(),
  projectId: text().notNull(),
  name: text().notNull(),
  kind: text({ enum: ["phase", "release"] }).notNull().default("phase"),
  position: integer().notNull().default(0),
  goal: text().notNull().default(""),
  startAt: integer(),
  dueAt: integer(),
  status: text({ enum: ["planned", "active", "done", "cancelled"] }).notNull().default("planned"),
  gateDecision: text({ enum: ["pending", "go", "hold", "kill"] }).notNull().default("pending"),
  gateNote: text().notNull().default(""),
  gateDecidedAt: integer(),
  gateDecidedBy: text().notNull().default(""),
  gateProposal: text().notNull().default(""),
  templateKey: text().notNull().default(""),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index("idx_ms_project").on(t.projectId, t.position)]);

// ---------- 需求（提了就要有着落） ----------
export const requirements = sqliteTable("requirements", {
  id: text().primaryKey(),
  projectId: text().notNull(),
  code: text().notNull(),
  title: text().notNull(),
  detailMd: text().notNull().default(""),
  source: text().notNull().default(""),
  priority: text({ enum: ["P0", "P1", "P2", "P3"] }).notNull().default("P1"),
  milestoneId: text(),
  status: text({ enum: ["proposed", "accepted", "in_progress", "done", "dropped"] }).notNull().default("proposed"),
  closeReason: text().notNull().default(""),
  closeConfirmed: integer().notNull().default(1),
  closedAt: integer(),
  closedBy: text().notNull().default(""),
  createdBy: text().notNull().default(""),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index("idx_req_project").on(t.projectId, t.status), uniqueIndex("idx_req_code").on(t.projectId, t.code)]);

// ---------- 依赖：blocker 完成后 blocked 才能开始 ----------
export const itemDeps = sqliteTable("item_deps", {
  id: text().primaryKey(),
  blockerId: text().notNull(),
  blockedId: text().notNull(),
  lagDays: integer().notNull().default(0),
  createdBy: text().notNull().default(""),
  createdAt: now(),
}, (t) => [uniqueIndex("idx_dep_pair").on(t.blockerId, t.blockedId), index("idx_dep_blocked").on(t.blockedId)]);

// ---------- 项目更新（健康度来源） ----------
export const projectUpdates = sqliteTable("project_updates", {
  id: text().primaryKey(),
  projectId: text().notNull(),
  health: text({ enum: ["on_track", "at_risk", "off_track"] }).notNull(),
  progressMd: text().notNull().default(""),
  blockersMd: text().notNull().default(""),
  nextMd: text().notNull().default(""),
  autoSummary: text().notNull().default(""),
  author: text().notNull().default(""),
  createdAt: now(),
}, (t) => [index("idx_pu_project").on(t.projectId, t.createdAt)]);

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
  kind: text().notNull().default("task"), // feature|task|compliance|account|purchase|contract|finance|release|risk|doc
  milestoneId: text(),
  requirementId: text(),
  mustMeet: integer().notNull().default(0), // 1 = 所在阶段的必过项
  startAt: integer(),
  leadTimeDays: integer(),
  templateKey: text().notNull().default(""),
  ownerType: text().notNull().default(""), // purchase|deal|trip|asset —— 事项挂在哪个事务对象下
  ownerId: text().notNull().default(""),
  recurRule: text().notNull().default(""), // monthly:15 | quarterly:15 | yearly:05-31
  recurParentId: text().notNull().default(""),
  supersededBy: text().notNull().default(""), // 被哪个更新后的任务替代（版本更迭链）
  waitingFor: text().notNull().default(""), // 在等谁/什么（GTD Waiting For）
  delegatedAt: integer(),
  followUpAt: integer(),
  plannedFor: text().notNull().default(""), // YYYY-MM-DD 计划哪天做
  rollCount: integer().notNull().default(0),
  deferUntil: integer(),
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

// ---------- 第二批：公司事务 ----------
export const assets = sqliteTable("assets", {
  id: text().primaryKey(),
  kind: text().notNull().default("account"), // credential|account|domain|cert|contract|subscription|device
  name: text().notNull(),
  identifier: text().notNull().default(""),
  authority: text().notNull().default(""),
  owner: text().notNull().default(""),
  projectId: text(),
  validFrom: integer(),
  validUntil: integer(),
  renewRule: text().notNull().default(""),
  remindDays: text().notNull().default("30,14,7"),
  status: text().notNull().default("active"), // active|revoked（expiring/expired 由日期推导）
  sourceItemId: text().notNull().default(""),
  secretRef: text().notNull().default(""),
  notesMd: text().notNull().default(""),
  cost: integer(), // 分
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index("idx_assets_until").on(t.validUntil), index("idx_assets_kind").on(t.kind)]);

export const purchases = sqliteTable("purchases", {
  id: text().primaryKey(),
  title: text().notNull(),
  specMd: text().notNull().default(""),
  caveatsMd: text().notNull().default(""),
  status: text().notNull().default("idea"), // idea|comparing|approved|ordered|received|in_use|returned|retired
  budget: integer(), // 分
  qty: integer().notNull().default(1),
  neededBy: integer(),
  projectId: text(),
  chosenQuoteId: text(),
  orderNo: text().notNull().default(""),
  orderedAt: integer(),
  receivedAt: integer(),
  warrantyUntil: integer(),
  holder: text().notNull().default(""),
  location: text().notNull().default(""),
  invoiceStatus: text().notNull().default("none"), // none|requested|received|not_needed
  assetId: text(),
  createdBy: text().notNull().default(""),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index("idx_purchases_status").on(t.status)]);

export const quotes = sqliteTable("quotes", {
  id: text().primaryKey(),
  purchaseId: text().notNull(),
  vendor: text().notNull(),
  url: text().notNull().default(""),
  model: text().notNull().default(""),
  price: integer().notNull(), // 分
  shipping: integer().notNull().default(0),
  notes: text().notNull().default(""),
  capturedAt: now(),
}, (t) => [index("idx_quotes_purchase").on(t.purchaseId)]);

export const orgs = sqliteTable("orgs", {
  id: text().primaryKey(),
  name: text().notNull(),
  kind: text().notNull().default("client"), // client|vendor|partner|platform
  website: text().notNull().default(""),
  notesMd: text().notNull().default(""),
  createdAt: now(),
  updatedAt: now(),
});

export const contacts = sqliteTable("contacts", {
  id: text().primaryKey(),
  orgId: text(),
  name: text().notNull(),
  title: text().notNull().default(""),
  phone: text().notNull().default(""),
  wechat: text().notNull().default(""),
  email: text().notNull().default(""),
  notesMd: text().notNull().default(""),
  lastContactAt: integer(),
  contactEveryDays: integer(),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index("idx_contacts_org").on(t.orgId)]);

export const deals = sqliteTable("deals", {
  id: text().primaryKey(),
  orgId: text(),
  contactId: text(),
  title: text().notNull(),
  stage: text().notNull().default("lead"), // lead|talking|proposal|negotiating|won|lost
  amount: integer(), // 分
  probability: integer(),
  expectedCloseAt: integer(),
  nextStep: text().notNull().default(""),
  nextStepAt: integer(),
  projectId: text(),
  lostReason: text().notNull().default(""),
  notesMd: text().notNull().default(""),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index("idx_deals_stage").on(t.stage)]);

export const trips = sqliteTable("trips", {
  id: text().primaryKey(),
  title: text().notNull(),
  purpose: text().notNull().default(""),
  city: text().notNull().default(""),
  startAt: integer().notNull(),
  endAt: integer().notNull(),
  dealId: text(),
  projectId: text(),
  legsJson: text().notNull().default("[]"),
  lodgingJson: text().notNull().default("[]"),
  attendees: text().notNull().default(""),
  notesMd: text().notNull().default(""),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index("idx_trips_start").on(t.startAt)]);

export const calendarFeeds = sqliteTable("calendar_feeds", {
  id: text().primaryKey(),
  name: text().notNull(),
  tokenHash: text().notNull().unique(),
  prefix: text().notNull(),
  revokedAt: integer(),
  lastUsedAt: integer(),
  createdAt: now(),
});

export type Item = typeof items.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type FileRef = typeof fileRefs.$inferSelect;
export type Policy = typeof policies.$inferSelect;

// ---------- 每周复盘 ----------
export const weeklyReviews = sqliteTable("weekly_reviews", {
  id: text().primaryKey(),
  weekStart: text().notNull().unique(), // YYYY-MM-DD（周一）
  top3Json: text().notNull().default("[]"), // [{title, itemId?}]
  notesMd: text().notNull().default(""),
  statsJson: text().notNull().default("{}"),
  status: text({ enum: ["draft", "done"] }).notNull().default("draft"),
  author: text().notNull().default(""),
  createdAt: now(),
  updatedAt: now(),
});
