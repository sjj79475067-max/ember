# Ember（淬）

**Agent 优先的事务进度管理中心** — 让所有 AI Agent 知道自己在做什么、还有哪些没做完、资料在哪里。

## 为什么做 Ember

当你让多个 AI agent（Claude Code、Cursor、豆包工作、龙虾等）做很多事时，问题来了：
- 做了什么、还有哪些没做，全散落在各次对话里
- 会议纪要 → 任务清单 → 完成核对 → 变更追踪 → 资料定位，没有归集
- 多台电脑、多个项目，进度无法共享

Ember 是你和所有 agent 的**单一入口**：任何 agent 连上它，就知道当前项目有哪些约定、有哪些事没做完、资料在哪；做完了能逐条核销并留下审计；你在一个漂亮的中文界面里看全局进度、批阅、检索、配置。

## 核心特性

### 🤖 Agent 优先设计

- **即插即用**：agent 接入即刻知道怎么用，无需探索
- **双通道**：MCP (Streamable HTTP) + REST API，覆盖所有主流 agent
- **自描述**：`/llms.txt`、OpenAPI、接入向导，配置一键复制
- **熟练工记忆**：上下文在中心，agent 换台机器也能继续

### 📋 覆盖四大场景

**批次 1 — 项目看板**
- GTD 风格看板：Todo / Doing / Blocked / Done / Changed
- 阶段门与里程碑：每个阶段的必过项和交付物
- 甘特图与依赖：可视化项目时间线
- 防流水账：合并进展、完成证据核实

**批次 2 — 公司事务**
- 资产台账：设备、软件、账号，到期提醒
- 采购记录：供应商、合同、发票、保修
- 客户管理：联系人、商机、交付
- 行程日历：iCal 订阅，跨设备同步

**批次 3 — 秘书层**
- 今日计划：自动滚动昨日未完成、P0 事项、到期提醒
- 在等别人：Waiting For 列表与跟进日期
- 拍板队列：需要决策的事项集中处理
- 每周复盘：Top 3 回顾与下周计划

**批次 4 — 随手记**
- 飞书长连接机器人：语音/文字 → AI 整理成草稿 → 确认后落库
- 快捷指令：iPhone/Mac 直接投递
- 网页收集：URL + 笔记 → 归档到项目

### 🔒 数据安全

- 自托管：Docker 一键部署，数据完全在你掌控
- 文件不上传：资料由 agent 管理，中心只登记位置
- 审计完整：所有写操作带 actor + reason + timestamp
- 密码不存：台账只记保存位置，敏感信息加密存储

## 快速开始

### 前置要求

- Docker 20+ 与 Docker Compose
- Node.js 20+ (仅开发时需要)

### 一键部署

```bash
# 1. 克隆仓库
git clone https://github.com/sjj79475067-max/ember.git
cd ember

# 2. 生成密钥并配置
cp .env.example .env
openssl rand -base64 32  # 复制输出到 .env 的 SESSION_SECRET

# 3. 启动容器
docker compose up -d

# 4. 访问 http://localhost:3000
```

首次访问会引导你创建管理员账号。

### Agent 接入

启动后访问 `/connect` 页面，选择你的 agent 类型（Claude Code / Cursor / Codex 等），复制配置粘贴即可。

**Claude Code 示例**：
```bash
claude mcp add ember --transport http \
  --url http://localhost:3000/api/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

## 架构

- **前端**：Next.js 15 App Router + React 19 + Tailwind v4
- **后端**：同进程 API + MCP 服务器
- **数据库**：SQLite (better-sqlite3) + Drizzle ORM
- **MCP**：官方 `@modelcontextprotocol/sdk`，Streamable HTTP 无状态

目录结构：
```
cc/
├── apps/web/              # Next.js 主应用
│   ├── src/
│   │   ├── app/           # 页面与 API 路由
│   │   ├── components/    # UI 组件
│   │   └── lib/
│   │       ├── services/  # 业务逻辑层
│   │       ├── mcp/       # MCP 工具注册
│   │       ├── capture/   # 随手记适配器
│   │       └── db/        # 数据模型
│   └── drizzle/           # SQL 迁移
├── docs/                  # 规格与架构文档
└── scripts/               # 备份、部署脚本
```

## 开发

```bash
cd apps/web

# 类型检查
npx tsc --noEmit

# 单元测试
npx vitest run

# 启动开发服务器 (端口 3100，独立数据库)
DATABASE_URL=file:/tmp/ember-dev/ember.db \
APP_URL=http://localhost:3100 \
npx next dev -p 3100

# 端到端测试
ADMIN_EMAIL=dev@test.local \
ADMIN_PASS=test123 \
npx playwright test
```

### 维护账本

Ember 自己的开发也用 Ember 管理！项目内有个 **EMBER** 项目，记录所有决定、问题和需求：

```bash
# 读取维护账本（需要容器运行）
node scripts/maintainer-brief.mjs

# 或通过 MCP 工具
maintainer_brief
```

修改代码前先读 `docs/MAINTAINER.md` 和维护账本，了解已定的做法和红线。

## 生产部署

详见 `docs/DEPLOYMENT-2026-11-11.md`。

**生产级配置建议**：
- Nginx 反向代理 + Let's Encrypt SSL
- 或 Cloudflare Tunnel / 代理模式（自动 HTTPS + CDN + DDoS 防护）
- 定期备份：`bash scripts/backup.sh`
- 限制端口：`127.0.0.1:3000:3000`，避免直接暴露

## 文档

- [规格文档](docs/) — SPEC-BATCH1~4.md 详细功能说明
- [维护手册](docs/MAINTAINER.md) — 红线、架构、测试、部署
- [Agent 接入指南](docs/AGENT-GUIDE.md) — 工具清单与最佳实践

## 设计理念

1. **单一入口 → 渐进披露**：agent 一次 `onboard` 拿到所有上下文
2. **工具面要小**：10-16 个语义化工具，描述精准
3. **写操作可追溯**：全量审计，冲突用乐观锁
4. **文件是引用而非复制**：默认仅登记位置
5. **免费优先**：核心无付费依赖，AI 可完全关闭

## 技术债与路线图

当前已完成批次 1-4（看板、事务、秘书、随手记）。

未来可能的方向：
- 语音助手集成（ASR 已预留接口）
- 多租户与团队协作
- Webhook 出站通知
- 更多渠道适配器（钉钉、企微、Slack）

## 许可

MIT License

## 致谢

感谢所有让 AI Agent 更好用的开源项目：
- [Model Context Protocol](https://modelcontextprotocol.io/) — Anthropic 的 agent 互操作协议
- [Next.js](https://nextjs.org/) — React 全栈框架
- [Drizzle ORM](https://orm.drizzle.team/) — TypeScript ORM
- [shadcn/ui](https://ui.shadcn.com/) — 可组合 UI 组件

---

**Ember（淬）** — 让每个 agent 都是熟练工。
