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
