# Ember 维护手册

写给接手维护 Ember 的人或 agent。改代码前先读完这页，再读维护账本。

## 0. 先读维护账本（唯一的外部记忆）

Ember 里有个项目叫 **EMBER（Ember 维护）**，里面存三样东西：
- **决定**：已经定下来的做法和原因。不要推翻重做；要改先问用户，改完记一条新决定，并注明取代哪条。
- **问题**：各个 agent 和用户反馈的问题。同一个问题只有一条，每再报一次就累计次数，附上例子。
- **需求**：用户要的功能和状态。

读法：
- 能连 Ember 的 MCP：调 `maintainer_brief`。
- 连不上：在仓库根目录跑 `node scripts/maintainer-brief.mjs`。它会从正式实例只读复制一份数据库，然后打印同样的内容。

用户的新要求，先 `requirement_save(project="EMBER")` 记下来，再动手。修好一个问题，`checklist_update status=done`，evidence 写清改了什么、怎么验证、哪个提交。

## 1. 红线

- **不碰正式实例做测试**：正式实例是 Docker 容器 `ember-web-1`，端口 3000，数据卷 `ember_ember-data`。开发和测试只用 3100 端口的独立实例，数据库是 `/tmp/ember-dev3100/ember.db`。
- **不用、不改、不重置用户的真实密码**。测试账号用随机密码。
- **部署前先备份**：`bash scripts/backup.sh`，然后复制一份到 `~/EmberBackups/`。
- **不存任何密码或密钥原文**：台账只记保存位置；飞书 Secret、AI Key 加密存库。
- **开发实例不启用飞书**：同一个机器人只让正式实例连，否则消息会被随机分走。
- **难回退的操作先问用户**：删数据、改权限、对外发送。

## 2. 架构

- `apps/web`：Next.js 15 App Router + React 19 + Tailwind v4 + SQLite（better-sqlite3，Drizzle）。
- **迁移**：`apps/web/drizzle/NNNN_*.sql`，由 `scripts/migrate.mjs` 只向前执行。语句之间用 `--> statement-breakpoint` 分隔。ALTER 要写在使用新列的语句之前。列名用驼峰。
- **服务层** `src/lib/services/*`：所有业务规则都在这里，网页、MCP、REST 共用。
  - `items.ts`：事项、防流水账（合并进展、完成证据核实、版本更迭）、秘书字段。
  - `board.ts` / `milestones.ts` / `requirements.ts` / `deps.ts`：看板、阶段门、需求闭环、依赖。
  - `assets` / `purchases` / `crm` / `trips` / `calendar` / `recur`：公司事务。
  - `secretary.ts`：今日、在等别人、拍板、拖延、每周复盘。
  - `maintenance.ts`：EMBER 维护账本。
  - `policies.ts`：条例与门禁（`WRITE_TOOLS` 列表）。
- **agent 入口**：`src/lib/mcp/registry.ts`，一份工具注册表，同时提供 MCP（`/api/mcp`）和 REST（`/api/v1/call/{tool}`）。新增写工具必须同时加进 `WRITE_TOOLS`。
- **随手记** `src/lib/capture/*`：
  - `channel.ts`：统一信封和适配器接口。
  - `feishu.ts` / `feishu-handlers.ts`：飞书长连接、卡片、只认本人。
  - `http.ts`：快捷指令投递。
  - `parse.ts`：AI 整理 / 规则整理、口语日期和时间。
  - `service.ts`：草稿、确认、落库。
  - `scheduler.ts`：到点提醒，每 30 秒检查一次。
  - `boot.ts`：由 `src/instrumentation.ts` 在 Node 运行时启动，构建阶段不启动。
- **飞书卡片的坑**：不要在点击回调里直接改卡片，飞书客户端会用旧卡片盖回去。要先落库，回调返回后再刷新卡片（`CARD_REFRESH_DELAY_MS`）。

## 3. 开发与测试

```bash
cd apps/web
npx tsc --noEmit -p .      # 类型检查
npx vitest run             # 单元测试（每个文件用临时数据库）
# 开发实例（3100，独立数据库，不连飞书）
DATABASE_URL=file:/tmp/ember-dev3100/ember.db APP_URL=http://localhost:3100 npx next dev -p 3100
# 端到端测试（只对 3100）
ADMIN_EMAIL=dev@test.local ADMIN_PASS="$(cat /tmp/ember-dev3100/pw)" npx playwright test
```

- 新迁移先对开发库跑：`DATABASE_URL=file:/tmp/ember-dev3100/ember.db node scripts/migrate.mjs`。
- 开发服务器开着时不要跑 `next build`，会弄坏 `.next`。
- 改了界面，要看桌面、390px 手机宽度、深色模式三种截图。

## 4. 部署（正式实例）

```bash
bash scripts/backup.sh && cp "$(ls -t backups/*.tgz | head -1)" ~/EmberBackups/
rm -rf /tmp/ember-build-src && mkdir -p /tmp/ember-build-src && git archive HEAD | tar -x -C /tmp/ember-build-src
docker build -f /tmp/ember-build-src/apps/web/Dockerfile -t ember:latest /tmp/ember-build-src
docker compose up -d web
```

- 只用已提交的代码构建（`git archive HEAD`），避免把没做完的改动带进去。
- 部署后检查：容器 healthy；日志里 `migrations ok`；只读复制数据库，核对用户、项目、事项数量没变，密码哈希没变。
- 构建时 corepack 下载 pnpm 偶尔会断网，重试即可。

## 5. 改动记录的规矩

- 每个功能、每次修复都要提交，提交信息写清做了什么。
- 改变了做法：在 EMBER 里记一条决定，不要只写在聊天里。
- 功能细则写在 `docs/SPEC*.md`：BATCH1 看板、BATCH2 事务、BATCH3 秘书、BATCH4 随手记。
