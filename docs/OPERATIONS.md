# 运维

## 目录与数据

- 唯一状态：`data/ember.db`（SQLite，WAL 模式）。`ember.db-wal`、`ember.db-shm` 一并备份。
- 迁移：`node scripts/migrate.mjs`（容器启动时自动执行）。

## 备份 / 恢复

```bash
# 备份（Docker）
docker compose exec web sh -c "cp /app/data/ember.db* /app/data/backup-$(date +%F)/" 2>/dev/null || \
  docker run --rm -v ember_ember-data:/d -v "$PWD":/out alpine tar czf /out/ember-$(date +%F).tgz -C /d .
# 恢复
docker compose down && tar xzf ember-2026-11-05.tgz -C /path/to/volume && docker compose up -d
```
本机模式直接复制 `apps/web/data/ember.db*`。

## 公网访问

1. 改 `.env` 的 `APP_URL` 为公网地址，`SESSION_SECRET` 用强随机串。
2. 反向代理（示例 Caddy）：
   ```
   ember.example.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```
3. 已装 cloudflared 的机器可加一条 ingress 到 `http://127.0.0.1:3000`，Token 通过 HTTPS 传输。

## 诊断

- `GET /api/health`：db 状态与计数。
- 日志：`docker compose logs -f web`。
- Agent 连不上：先看 `/connect` 页的「测试连接」，再确认 Token 未吊销、URL 含 `/api/mcp`。

## Docker 部署验证记录（2026-11-05）

- 镜像 `ember:latest` 约 499MB（linux/arm64），容器空闲内存约 60MiB。
- `docker compose up -d --build` 后 `/api/health` 返回 `db:up`，全链路冒烟与 MCP 冒烟通过。
- 备份：`./scripts/backup.sh` → `backups/ember-<时间>.tgz`；恢复：`./scripts/restore.sh <包>`。
  恢复会停止服务 → 覆盖数据卷 → 修正属主（1001）→ 重启；演练验证：恢复前新建的标记项目在恢复后消失，且写入正常。
- 注意：数据卷中 SQLite 文件属主必须是容器用户 `nextjs(1001)`，否则出现 `SQLITE_READONLY`（镜像已预建 `/app/data` 并授权，恢复脚本会自动 chown）。
- Docker Desktop 若拉镜像超时，检查设置里的手动代理是否指向本机可用端口（本机为 `127.0.0.1:7890`）。

## 手机推送与定时简报

1. 网页「简报」页底部 → 手机推送 → 选渠道：
   - **Bark**（iPhone，免费）：App 里复制 `https://api.day.app/<你的key>` 填进去。
   - **ntfy**（全平台免费）：填服务器（默认 `https://ntfy.sh`）和任意 topic 名，手机订阅同一 topic。
   - **Webhook**：任意接收 JSON `{title, body, at, source}` 的地址。
2. 点「发送测试」确认收到；「推送当前未读提醒」按最低级别（P0/P1/全部）合并成一条。
3. 定时简报（每天 8 点）在宿主机 crontab：
   ```cron
   0 8 * * * curl -s -X POST "http://localhost:3000/api/scheduled/brief?key=$CRON_KEY" >/dev/null
   ```
   `CRON_KEY` 在 `.env` 中，容器启动时注入；未设置则该入口直接 401。
