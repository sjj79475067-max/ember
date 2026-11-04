# Ember · 事务进度中心

Agent 优先的个人事务进度与资料定位中心。任何 AI agent 连上它，就知道自己该做什么、做到哪、资料在哪；你在浏览器里看全局。

## 30 秒启动（Docker，推荐）

```bash
cp .env.example .env
# 编辑 .env，把 SESSION_SECRET 换成随机串：openssl rand -base64 32
docker compose up -d --build
open http://localhost:3000          # 首次进入创建管理员账号
```

## 本机开发

```bash
pnpm install
cd apps/web && pnpm db:migrate && pnpm dev
```

## 接入 Agent

网页右上「接入 Agent」页生成 Token，复制对应配置：

```bash
# Claude Code
claude mcp add --transport http ember http://localhost:3000/api/mcp --header "Authorization: Bearer ember_xxx"
```

其他客户端（Cursor / Cline / Codex / 豆包 / Hermes / 任意 HTTP agent）在接入页都有可复制配置。
不支持远程 MCP 的终端：`npx ember-mcp --url http://localhost:3000 --token ember_xxx`。

自描述入口：`/llms.txt`、`/llms-full.txt`、`/.well-known/agent.json`、`/openapi.json`。

## 它解决的问题

- 多个 agent、多次会话做的事被**归集**成项目 → 清单 → 证据 → 进度。
- 会议/文档/历史对话导入为**会议档案**，自动抽取待办事务（可无 AI 使用）。
- 资料不搬到中心，只登记**位置与归档去向**，位置变了 agent 回写，过期自动提醒核验。
- 到期、阻塞、必读条例通过 **Reminder Inbox** 在 agent 每次连接时推给它。

## 文档

- [规格](docs/SPEC.md)
- [Agent 接入手册](docs/AGENT-GUIDE.md)
- [运维](docs/OPERATIONS.md)
