# Agent 接入手册（给人看的一页版）

## 1. 让 agent 知道中心存在

三种方式，任选：

1. **MCP 配置**（最顺）：在 `/connect` 页复制对应客户端的配置。
   - Claude Code：`claude mcp add --transport http ember <地址>/api/mcp --header "Authorization: Bearer ember_xxx"`
   - Cursor/Cline/Continue：JSON 里 `url` + `headers`（Cline 需 `"type":"streamableHttp"`）
   - Codex：`~/.codex/config.toml` 的 `[mcp_servers.ember]`
2. **项目 AGENTS.md / CLAUDE.md 指针**（让"任何新会话"都知道）：
   ```md
   ## 事务中心
   本项目所有计划、进度、资料位置以 Ember 为准：<地址>/llms.txt
   开始工作前调用 ember 的 onboard 工具；完成任务必须带证据。
   ```
3. **一句话给不支持 MCP 的 agent**：
   > 阅读 `<地址>/llms.txt`，用 `<地址>/api/v1/onboard` 获取上下文，按 how_to_work 执行；Token: ember_xxx

## 2. Agent 的标准工作流

1. `onboard` —— 身份、项目、提醒、条例、工作流。
2. `policy_read` → `policy_ack` —— 有必读条例时（否则对应写操作被拦）。条例只能提议（`policy_write`，进入待批准），由用户批准。
3. `project_list` / `project_get` —— 确认项目。**归属不明不要猜**：任务省略 project、会议/历史不指定项目 → 自动进「收件箱」，之后用 `item_move` 分拣。
4. `checklist_list(status=open)` —— 看真实进度，不凭记忆。
5. `claim_item` —— 认领（冲突时先问用户）。
6. 做事，期间：会议用 `meeting_import`；决定用 `decision_record`；知识用 `note_save`；产物用 `file_register`。
7. `checklist_update(status=done, evidence=...)` —— 完成必须有证据，且证据要说清「做到什么程度」，不能是「已对接/在推进」。
   进展用 `checklist_progress` 记在原任务上；需求变了用 `checklist_supersede` 升级版本；都不要用 `checklist_add` 记流水账。
8. `checklist_verify` —— 收工前看 gaps 并补齐。
9. `session_end` —— 写总结、释放认领。

## 3. 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 403 policy_gate | 有未确认的必读条例 | `policy_read` + `policy_ack` |
| 404 找不到项目 | 代号写错或项目不存在 | `project_list` 确认；不确定就用收件箱 |
| policy_write 返回 pending | 正常：条例需用户在网页批准 | 告知用户去「条例」页批准 |
| 409 版本冲突 | 他人已改 | 重新 `checklist_list` 取最新 version |
| 422 必须提供 evidence | done 无证据 | 补写做了什么、如何验证 |
| conflict=true（认领） | 他人 2 小时内已认领 | 询问用户或换任务 |
