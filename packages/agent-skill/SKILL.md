---
name: ember-center
description: 使用 Ember 事务进度中心记录与核对工作进度。当用户提到「事务中心 / 进度中心 / Ember」、要求归档会议记录、登记资料位置、核对清单完成情况，或需要把本次会话的工作沉淀到长期项目里时使用。
---

# Ember 事务进度中心

中心是唯一进度真相源。不要凭记忆假设进度，也不要只在聊天里汇报"已完成"。

## 开始（每个会话第一件事）

1. 调用 MCP 工具 `onboard`（若未配置 MCP，则 `GET ${EMBER_URL}/api/v1/onboard`，带 `Authorization: Bearer $EMBER_TOKEN`）。
2. 若返回值里 `required_policies_unacked` 非空：`policy_read` → `policy_ack`，否则写操作会被 403 拦截。
3. 按返回的 `how_to_work` 执行；项目按 `key`（如 IT、ADMIN）识别。

## 什么时候做什么

| 场景 | 调用 |
|---|---|
| 开完会 / 贴给我一份会议记录 | `meeting_import`（原文整段传入；已整理好的条目用 `items` 直接传） |
| 我和你说定了某个方案 | `decision_record` |
| 零散但有用的信息（账号归属、规则、经验） | `note_save` |
| 我让你开始做某件事 | `claim_item`（有人认领时先问我） |
| 做完了 | `checklist_update` + `status=done` + **必填 evidence**（改了什么、验证方式、链接/路径） |
| 做的和原计划不一样 | `checklist_update` + `status=changed` + note 写清差异 |
| 卡住了 | `checklist_update` + `status=blocked` + block_reason（需要谁做什么） |
| 产出文件放在哪 | `file_register`（路径/链接，mov 了重新登记） |
| 收工 | `checklist_verify` 看缺口 → 补齐 → `session_end` 写总结 |

## 硬性要求

- `done` 没有 evidence 会被拒绝；evidence 要能让人一眼验证（命令、路径、commit、截图链接）。
- 长任务每 20–30 分钟调一次 `sync`（心跳 + 拉提醒）。
- 工具返回值里的 `reminders_unread` 一旦有 P0（逾期/阻塞），先处理再继续。
- 不要在本地维护第二份清单；需要最新状态就 `checklist_list`。

## 未配置 MCP 时

`${EMBER_URL}/llms.txt` 是完整接入说明；所有工具都可用 `POST ${EMBER_URL}/api/v1/call/<工具名>` 调用，参数同名。
