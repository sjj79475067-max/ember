# SPEC · Ember 事务进度中心 v1.0

> 本文是系统的唯一规格来源。实现偏离规格视为缺陷；规格变更需在同一 PR 修改本文件。

## 1. 产品定位

自托管、**Agent 优先**的「事务进度与资料定位中心」。任何 agent（Claude Code / Codex / Cursor / Cline / 豆包工作 / Hermes / 任意 HTTP agent）连上后立即知道：自己是谁、当前项目与进度、哪些事没做完、资料在哪、有哪些必须遵守的条例。用户在一个中文界面中看全局、批阅、检索与配置。

**不做**：文件网盘、专业财务/法律计算、实时协作编辑、公开 SaaS 多租户计费。

## 2. 协议：Ember Activity Protocol v1

统一信封（所有 REST 与 MCP 工具返回）：

```json
{
  "ok": true,
  "data": { },
  "hints": ["给 agent 的下一步建议"],
  "reminders_unread": { "total": 3, "byKind": { "overdue": 1, "policy": 2 } },
  "policy_gate": { "blocked": false, "policies": [] }
}
```

- 错误：`{ ok:false, error:"中文说明", status?, issues?, policy_gate? }`，HTTP 码有意义（401/403/404/409/422/429）。
- 时间：Unix 秒。
- 任务状态机：`todo → doing → done | dropped | changed`，`blocked` 可从任一非终态进入并可退出。
- 完成定义：`status=done` 必须携带 `evidence`（做了什么 + 在哪可验证）。无证据的 done 被拒（422）。
- 变更：`status=changed` 需在 `note` 写清与原计划的差异。
- 并发：携带 `expected_version`；不符返回 `409`，信封内含 `current` 最新数据。
- 认领：`claim_item`；同一任务在 2 小时心跳窗口内被他人持有时返回 `conflict=true` 与持有人。**不硬锁**——用户确认后可再调一次覆盖。
- 幂等：导入/会议按文本指纹去重，可安全重试。
- 文件：中心不保存文件本体，只保存位置（机器/路径/链接）+ 归档去向 + 核验时间。

## 3. 语义模型

| 实体 | 说明 | 关键字段 |
|---|---|---|
| Project | 任何工作聚类：IT / 事务 / 客户 / 资料库 | key（唯一代号）、kind、status、dueAt、localRoot、githubRepo、archiveNote |
| Workstream | 项目内的阶段/工作流 | name、position |
| Item | 清单条目 | status、priority、dueAt、doneDefinition、evidence、blockReason、claimedBy、claimedAt、sourceType、sourceRef、version |
| ItemEvent | 条目事件流（谁、何时、从什么状态到什么状态、证据） | actorType、actorName、action |
| Meeting | 会议档案（任意来源） | heldAt、source、minutesMd、summaryMd、attachments |
| Decision | 已定决定 | rationaleMd、impact、meetingId |
| Note | 知识条目 | projectId 可为空、tags、source |
| FileRef | 资料定位 | machine、path、url、archiveTo、status(active/moved/missing/archived)、lastVerifiedAt |
| Reminder | 提醒 | kind(due/overdue/blocked/policy/stale_file/review)、severity、dedupeKey、status(open/acked/snoozed/done) |
| Policy | 条例 | required、version（内容变更自动 +1）、appliesToTools |
| AgentSession | agent 会话 | agentName、agentType、sessionRef、lastSeenAt、summary |
| ImportBatch | 归集批次 | fingerprint（去重）、rawText、createdItemIds |
| AiProvider | 模型配置 | kind(anthropic/openai_compat)、baseUrl、model、apiKeyEnc(AES-256-GCM) |

## 4. Agent 入口

1. `GET /api/v1/onboard`（Bearer）：身份、项目+进度、未读提醒、未确认必读条例、我认领的任务、他人在做的任务、最近会议、自上次以来的变更摘要、`how_to_work`。
2. `POST /api/v1/call/{tool}`：与 MCP 工具同名同参。
3. `POST /api/mcp`：MCP Streamable HTTP，无状态，`enableJsonResponse`。
4. 自描述：`/llms.txt`（概览）、`/llms-full.txt`（全量手册+每个工具 schema+场景配方）、`/.well-known/agent.json`（机器可读能力清单）、`/openapi.json`。
5. 变更通知：`agent_changelog` 表 → onboard 的 `since_last_time`；工具描述变更同步更新 `llms-full.txt`。

## 5. 条例门禁与写入限制

**生命周期**：`draft` 草稿 → `pending` 待批准 → `active` 生效 → `retired` 废止（另有过期自动失效）。
- 用户在网页保存即生效；**agent 只能 `policy_write` 提议，一律进入 pending，不拦截任何操作**；批准 / 废止只能由用户在网页操作。
- 内容修改 → `version+1` → 需重新确认；agent 修改生效中的条例 → 回到 pending。

**硬约束（服务端强制，不依赖 UI）**
- 正文 ≤ 2000 字，标题 ≤ 80 字。
- 必读（required）条例**必须**用 `applies_to_tools` 限定到具体写操作；要全站生效必须显式 `scope_mode=all`（只有用户能批准）。
- 同一范围（全局 / 单个项目）最多 5 条生效且无过期的必读条例。
- 支持 `expires_at`（到期自动失效）与 `review_every_days`（到期未复核产生提醒）。

**门禁规则**：只检查生效中（active 且未过期）的必读条例；项目条例只拦该项目的写操作，工具型只拦其中列出的写操作，只读工具永远不拦。未确认 → 403 + `policy_gate.policies`。

## 5.1 防止交叉与混乱的结构

- **收件箱（INBOX）**：唯一的未归类项目。`checklist_add` 省略 project、`meeting_import` / `ingest_history` 不指定项目 → 落进收件箱并标记为 `parkingLot`，不计入任何项目进度；`item_move` 分拣到具体项目或合并 `item_merge`。
- **项目解析**：id / key（不区分大小写）/ 别名，别名的中文「收件箱」也可用；找不到项目时**报错并列出可用项目**，绝不静默写进别的项目。
- **项目分组**：`project_groups` 设置分组，任务用 `group` 参数挂靠；界面按分组折叠，长清单不再糊成一坨。
- **写权限**：token 的 `write` scope 在 MCP 与 REST 两条通道都强制校验。

## 5.2 事项生命周期：进展 vs 新事项 vs 新版本

中心的目标是「事事有着落」，不是流水账。同一件事的三类记录必须分开：

| 场景 | 用什么 | 结果 |
|---|---|---|
| 事情往前走了一步（见客户、交材料、拿到反馈） | `checklist_progress(item_id, note, percent?)` | 进展追加到原任务 `detailMd` 并记事件，任务状态不变 |
| 确实多出一件独立、可验收的事 | `checklist_add`（必须写 done_definition） | 新建任务 |
| 需求/范围变了，原目标作废 | `checklist_supersede(item_id, title, ...)` | 旧任务关闭并 `supersededBy` 指向新任务，新任务建立 |

自动防流水账：
- `checklist_add` 的过程性标题（「跟进××」「继续推进」等）或与已有未完成任务高度相似（二元组重合 ≥60%）→ 合并为该任务进展（返回 `merged`）。
- `checklist_add` 带 `expected_version` 且版本已变 → 视为同事项的新进展，合并而非新建。
- `meeting_import` 的 items 支持 `done=true`（已办事项归档为已完成，`status_note` 作证据）、`status_note`（进展合并）、`supersedes`（版本更迭）。
- 完成证据判据：`done` 但证据是「进行到哪一步」而非「做到了什么程度」→ 自动标 `needsReview=1`，产生待核实提醒，`checklist_verify` 列为 gap。
- `checklist_verify` 额外检查：进行中无人认领、变更无说明、缺完成标准、疑似重复。

## 6. 提醒引擎

- 触发：到期前 3 天（due）、逾期（overdue）、阻塞（blocked）、必读未确认（policy）、资料超 30 天未核验或缺失（stale_file）。
- 去重：`dedupeKey` 唯一（含日/周粒度），重复触发只更新内容不重复建行。
- 展示：网页收件箱 + 每次 onboard/sync/任意工具返回的 `reminders_unread`。
- 处理：ack / snooze / done。

## 7. AI 使用边界

| 用 AI | 不用 AI |
|---|---|
| 会议/历史资料 → 摘要 + 事务抽取；导入预览 | 状态机、权限、审计、提醒计算、去重、检索、文件登记、统计 |
| （规划）日报周报、陈旧检测建议、条例冲突检查 | — |

未配置 AI 时，导入按确定性规则拆分（按标题/编号/项目符号/长度过滤），核心流程完全可用。

## 8. 安全

- 密码 scrypt；会话 Cookie `HttpOnly + SameSite=Lax + Secure(生产)`，签名校验；登录限流（同 IP+账号 5 分钟内 8 次）。
- Agent Token：`ember_` 前缀、仅存 SHA-256 哈希、可吊销、scope=read,write、记录 last_used。
- 所有写操作写 `audit_log`（actor/action/entity/diff/ip/requestId）。
- 越权：Agent 令牌只能操作自身数据域；UI 路由校验会话；只读角色禁写。
- CSRF：状态变更均走 POST/PATCH 且 SameSite=Lax；跨站表单无法携带 JSON content-type，风险受限；生产建议置于 TLS 之后。

## 9. 验收（Definition of Done）

- `pnpm build` 通过；`docker compose up` 后 `/api/health` 返回 `db:up`。
- `scripts/mcp-smoke.mjs` 全绿。
- 主要页面可访问且暗色模式无明显对比度问题。
- 备份：复制 `data/ember.db*` 即完整备份；恢复后数据一致。
