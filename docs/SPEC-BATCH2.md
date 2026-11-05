# 第二批规范：公司事务（资质账号台账 · 采购与设备 · 客户合作 · 行程 · 公司固定日历 · 日历订阅）

依据：Snipe-IT（许可证/资产/签出）、InvenTree（供应商报价阶梯）、ERPNext（合同、请购→报价→下单→入库）、Twenty/EspoCRM（机构/联系人/商机）、Monica（多久没联系）、国内小公司财税日历、ICS 订阅标准。只照抄数据结构与做法，代码自写（这些项目多为 AGPL/GPL）。

原则：
- **「事项」是要去做的事，「台账」是长期存在的东西**。备案号、开发者账号、域名、证书、合同、设备都是台账：有归属、有到期、要续期。办理过程仍是事项，办完把结果登记到台账。
- 不建第二套任务系统：采购、合作、行程里的「要做的事」都落成普通事项（带 kind），所以进度、提醒、看板、agent 规则全部通用。

## 1. 资质与账号台账 `assets`（kind=credential / account / domain / cert / license / contract / device）
| 字段 | 说明 |
|---|---|
| kind | credential 资质（备案号/软著/许可证）· account 账号（开发者账号、商户号、云账号）· domain 域名 · cert 证书 · contract 合同 · subscription 订阅 · device 设备 |
| name, identifier | 名称、编号（备案号、AppID、域名、证书 CN、合同号、序列号）|
| authority | 办理机构/平台（工信部、华为开发者联盟、阿里云…）|
| owner | 账号/证照归属人或主体 |
| projectId | 关联项目（可空：公司级） |
| validFrom, validUntil | 有效期；`validUntil` 空表示长期 |
| renewRule | 续期规则说明（如「到期前 30 天在阿里云续费」）|
| remindDays | 提前提醒天数，默认 `30,14,7` |
| status | active · expiring（自动）· expired（自动）· revoked |
| sourceItemId | 由哪个事项办下来的（办完自动登记） |
| secretRef | **只存位置，不存密码**：例如「1Password: 苹果开发者」 |
| notesMd, cost, currency | 备注、费用 |

规则：
- 到期前 `remindDays` 各一档提醒；过期显示真实后果（域名：宽限期/赎回期；年报：经营异常名录）。
- 资质/账号类事项完成时，agent 或用户可一键「登记到台账」（`asset_save(from_item=…)`），把证据里的编号带过去。
- 任何字段都**不存密码明文**；`secretRef` 写保存位置。

## 2. 采购 `purchases` + 报价 `quotes`
状态：`idea` 想买 → `comparing` 比价 → `approved` 决定买 → `ordered` 已下单 → `received` 已到货 → `in_use` 在用 → `returned`/`retired`。
| 字段 | 说明 |
|---|---|
| title, specMd | 要买什么；型号/规格要求 |
| caveatsMd | 注意事项（接口、电压、兼容性、发票抬头…）|
| budget, qty, neededBy | 预算、数量、什么时候要 |
| projectId | 为哪个项目买（可空） |
| chosenQuoteId, orderNo, orderedAt, receivedAt | 选了哪家、订单号、时间 |
| warrantyUntil, holder, location | 保修到期、谁在用、放在哪 |
| invoiceStatus | none · requested · received（要发票的小公司必须追）|

`quotes`：purchaseId、vendor、url、price、shipping、notes、capturedAt —— 一条采购下可以有多家报价，界面自动算到手价并标出最低。
- 到货后可「登记为设备」→ 生成 `assets(kind=device)`，带保修到期提醒。
- 采购的推进动作（比价、下单、催发票）落成事项（kind=purchase），挂在采购上。

## 3. 客户与合作（轻量 CRM）
- `orgs`：name、kind（客户/供应商/合作方/政府平台）、website、notesMd。
- `contacts`：orgId、name、title、phone、wechat、email、notesMd、lastContactAt、contactEveryDays（多久要联系一次，可空）。
- `deals`（合作机会）：orgId、title、stage（线索 lead → 洽谈 talking → 方案/报价 proposal → 谈判 negotiating → 已签 won / 未成 lost）、amount、probability、expectedCloseAt、nextStep、nextStepAt、projectId（签约后转成项目）、lostReason。
- 准备材料：deal 下的事项（kind=doc/contract），即「为这次合作要准备的东西」。
- 互动：会议档案可关联 deal/contact（复用 meetings），自动更新 lastContactAt。
规则：`nextStepAt` 到期提醒；`contactEveryDays` 超期提醒「很久没联系」；deal 赢单可一键建项目（默认 client 模板）。

## 4. 行程 `trips` + 日程
- `trips`：title、purpose、startAt、endAt、city、dealId/projectId、legsJson（交通段：类型、班次、出发/到达时间、订单号）、lodgingJson、attendees、notesMd。
- 出行准备清单：trip 下的事项（kind=task），默认带「订票、订酒店、带资料、报销票据」。
- 行程结束后提醒：报销与票据整理、会议纪要归档。

## 5. 公司固定日历（重复事项）
- 事项新增 `recurRule`（monthly:15 / quarterly:15 / yearly:05-31 / yearly:01-01~06-30）与 `recurParentId`。完成后自动生成下一期，保留上一期证据。
- 预置「公司事务」模板 `company_cn`：增值税及附加（按季，季后 15 日）、企业所得税预缴（按季）、汇算清缴（5 月 31 日）、工商年报（6 月 30 日前）、个税汇算（6 月 30 日前，提醒老板本人）、社保公积金（按月）、发票整理（按月）。每条带逾期后果说明。具体以当地税局为准。

## 6. 日历订阅（ICS）
- `/api/calendar/{token}.ics`：截止日、阶段节点、台账到期、采购需到货日、合作下一步、行程，供手机日历订阅（只读）。token 独立生成、可吊销，不复用 agent token。

## 7. 页面
- 新增「事务」入口：台账（按到期排序、即将到期高亮）、采购（看板按状态 + 比价表）、合作（看板按阶段 + 联系人）、行程（时间线）、日历（月视图汇总所有带日期的东西）。
- 首页增加「近 30 天到期」与「合作下一步」。

## 8. Agent 工具
`asset_save` / `asset_list`、`purchase_save`（含报价、状态推进）、`deal_save` / `contact_save` / `org_save`、`trip_save`、`calendar_agenda(from,to)`（所有带日期的东西合在一起）。
写操作照常过条例门禁；密码类字段一律拒收（检测到疑似密码直接 422）。
