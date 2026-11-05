# 第一批规范：开发流程落地（需求追溯 · 阶段与发布关卡 · 依赖 · 项目看板 · 模板）

依据：docs 调研（Linear 里程碑/项目更新、Jira 版本就绪、Plane 状态分组、OpenProject 依赖、Stage-Gate 门禁、国内上线前置事项）。
原则：一人公司可用 —— 层级只加「阶段」一层；结构上的判断（能不能发版、卡在哪）全部自动推导，不靠人维护第二份数据。

## 1. 新增对象

### 1.1 阶段 / 里程碑 `milestones`
| 字段 | 说明 |
|---|---|
| projectId, name, position | 所属项目、名称、顺序 |
| kind | `phase` 阶段（设计/开发/测试/上线）· `release` 发布版本（v1、v1.1） |
| goal | 这一段要达成什么 |
| startAt, dueAt | 计划起止（可空） |
| status | `planned` · `active` · `done` · `cancelled` |
| gateDecision | 阶段门结论：`pending` · `go` · `hold` · `kill`（只有用户能定） |
| gateNote, gateDecidedAt, gateDecidedBy | 结论说明与留痕 |
| gateProposal | agent 的建议（不生效，供用户参考） |

**就绪度（自动推导）**：阶段内 `mustMeet=1` 的事项全部为 `done`（且非待核实）或 `dropped` → 「可放行」；否则列出缺口。阶段完成度 = 非 dropped 事项中 done 的比例。

### 1.2 需求 `requirements` —— 「提了就要有着落」
| 字段 | 说明 |
|---|---|
| code | 项目内编号 R-001 |
| title, detailMd, source | 内容与来源（会议/客户/自己/agent） |
| priority | P0–P3 |
| milestoneId | 计划在哪个阶段/版本交付 |
| status | `proposed` 提出 · `accepted` 确认要做 · `in_progress` · `done` · `dropped` |
| closeReason | **dropped 必填**；done 时自动写「关联事项已全部完成」 |
| closeConfirmed | agent 放弃的需求需用户确认（0），用户操作即确认（1） |

规则：
- 需求通过事项 `items.requirementId` 拆解；有未关闭事项时不能标 done。
- 关联事项全部 done（且有证据、非待核实）→ 需求自动变 done（系统留痕）。
- `accepted` 超过 7 天还没拆出事项、`proposed` 超过 14 天未决 → 提醒。
- agent 提议放弃 → `dropped` + `closeConfirmed=0` → 提醒用户确认，防止 agent 悄悄砍需求。

### 1.3 依赖 `item_deps`
- 只有一种：A 完成后 B 才能开始（`blockerId → blockedId`），可带 `lagDays`。
- 写入时做环检测；跨项目允许（例如公司事务里的「营业执照年报」卡项目上线）。
- 推导：B 的前置未全部完成 → B 显示「等待中：等 A」；A 的截止日晚于 B 的开始/截止 → **依赖违约**（红线）。

### 1.4 项目更新 `project_updates`（Linear 式健康度）
- 字段：health（on_track / at_risk / off_track）、progressMd、blockersMd、nextMd、author。
- 项目健康度 = 最近一次更新的 health；从未更新或超过 `updateEveryDays`（默认 7）未更新 → 显示「更新缺失」，并给出系统建议值（有逾期 P0 或违约依赖 → 偏离；有阻塞或必过项逾期 → 有风险）。

## 2. 事项扩展（items）
- `kind`：feature 功能 · task 一般 · compliance 资质合规 · account 账号开通 · purchase 采购 · contract 合同 · finance 财务 · release 发布 · risk 风险 · doc 文档。
- `milestoneId`、`requirementId`、`mustMeet`（阶段必过项）、`startAt`、`leadTimeDays`（通常要多久，资质类用）、`templateKey`（模板来源，幂等）。

## 3. 模板（国内常见场景，可重复应用不重复建）
- `app`：设计 → 开发 → 测试 → 上线；上线阶段预置 域名 → 云服务器 → ICP 备案 → 公安联网备案；App 备案、软著、隐私政策、用户协议、各商店开发者账号、短信签名模板、支付商户号、HTTPS、商店提审（依赖备案/软著/隐私/账号）、灰度与监控。
- `miniprogram`：小程序账号 → 小程序备案 → 类目资质 → 隐私保护指引 → 服务器域名配置 → 提审。
- `saas`：域名、服务器、ICP、公安备案、HTTPS、隐私政策、用户协议、支付、短信；可选 ICP 经营许可证、等保。
- `client`：签约 → 实施 → 验收 → 结项；合同、需求确认单、验收单、开票、回款、交付物归档。
- 每条预置事项带 kind、mustMeet、leadTimeDays、说明（办理入口与常见坑），依赖按模板 key 连好。

## 4. 项目页
标签：**总览**（默认）· 需求 · 清单（列表/看板切换）· 计划（甘特/依赖图）· 会议 · 资料 · 决定与更新 · 动态。

总览一屏回答三个问题：
1. **现在在哪**：里程碑轨道（每段完成度、当前段高亮、截止倒计时）。
2. **能不能发**：发版就绪环（必过 7/10），下方直接列出缺口（谁、什么类型、卡在哪）。
3. **卡在哪**：等待中/违约依赖、阻塞、逾期、待核实、需求漏斗（提出/确认/进行/完成/放弃，未拆解的标红）。
另有：按类型进度条（功能/资质/账号/采购…）、健康卡（最近更新 + 系统建议）、近 30 天完成趋势。

## 5. Agent 面（MCP/REST 同名工具）
- `project_board(project)`：一次拿到上面所有推导结果（阶段、就绪缺口、等待链、需求漏斗、健康度）。
- `milestone_save`：建/改阶段；agent 只能填 `gate_proposal`，不能定 gate。
- `requirement_save` / `requirement_list`：提需求、改状态；放弃必须写原因，agent 放弃需用户确认。
- `item_link`：加/删依赖（环检测）。
- `template_apply(project, template?)`：不传 template 时列出可用模板。
- `project_update_post`：发项目更新（三段式 + 健康度）。
- 既有 `checklist_add/update` 增加 kind / milestone / requirement / must_meet / start_at / blocked_by。
- `checklist_verify` 增加：需求未拆解、必过项缺失、依赖违约、等待中却被认领、阶段到期仍有必过缺口。

## 6. 验收
- 单测：就绪度推导、需求自动闭合与放弃规则、依赖环检测与违约、模板幂等、健康度推导。
- 浏览器：总览/计划/看板拖拽在桌面与 390px 手机宽度无溢出；首页 JS 增量 < 200 kB gz（图表按需加载）。
- 迁移在既有数据上可重复执行；部署前备份。
