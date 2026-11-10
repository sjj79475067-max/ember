# Ember 生产环境部署指南

本文档说明如何将 Ember 部署到生产服务器。

## 部署选项

### 方案 1: Cloudflare Tunnel（推荐新手）

**优点**：
- 无需公网 IP，无需配置防火墙
- 自动 HTTPS，无需手动申请证书
- 免费 CDN + DDoS 防护
- 5 分钟完成部署

**步骤**：

1. 在 Cloudflare 添加域名（免费账号即可）

2. 本地启动容器：
```bash
docker compose up -d
```

3. 安装 cloudflared：
```bash
# macOS
brew install cloudflare/cloudflare/cloudflared

# Linux
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
```

4. 登录并创建隧道：
```bash
cloudflared tunnel login
cloudflared tunnel create ember
cloudflared tunnel route dns ember ember.你的域名.com
```

5. 配置隧道（创建 `~/.cloudflared/config.yml`）：
```yaml
tunnel: <你的隧道 ID>
credentials-file: /Users/你的用户名/.cloudflared/<隧道 ID>.json

ingress:
  - hostname: ember.你的域名.com
    service: http://localhost:3000
  - service: http_status:404
```

6. 启动隧道：
```bash
cloudflared tunnel run ember
```

7. （可选）设置开机自启：
```bash
sudo cloudflared service install
```

### 方案 2: VPS + Nginx + Let's Encrypt（推荐有服务器的用户）

**前置要求**：
- Ubuntu/Debian 服务器
- 已解析的域名（A 记录指向服务器 IP）
- Docker 已安装

**步骤**：

1. 安装 Nginx 与 Certbot：
```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

2. 配置 Nginx 反向代理（`/etc/nginx/sites-available/ember`）：
```nginx
server {
    listen 80;
    server_name ember.你的域名.com;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

3. 启用站点并申请证书：
```bash
sudo ln -s /etc/nginx/sites-available/ember /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d ember.你的域名.com
```

4. 修改 `docker-compose.yml`，只监听本地：
```yaml
ports:
  - "127.0.0.1:3000:3000"
```

5. 启动容器：
```bash
docker compose up -d
```

6. 自动续期证书：
```bash
sudo systemctl enable certbot.timer
```

### 方案 3: Cloudflare 代理模式（本项目实际使用）

**优点**：
- 自动 HTTPS，无需 Certbot
- 全球 CDN 加速
- DDoS 防护 + 隐藏真实 IP
- Web 界面配置，无需命令行

**步骤**：

1. 在 Cloudflare 添加域名并使用 Cloudflare NS

2. 添加 DNS A 记录：
   - Name: `ember`（或任意子域名）
   - Type: `A`
   - Content: `服务器公网 IP`
   - Proxy status: **Proxied（橙色云）**
   - TTL: Auto

3. 在服务器上：
```bash
# 修改 docker-compose.yml 只监听本地
ports:
  - "127.0.0.1:3000:3000"

# 配置 Nginx（同方案 2，但无需 HTTPS 配置）
# 启动容器
docker compose up -d
```

4. 访问 `https://ember.你的域名.com`

Cloudflare 会自动处理 SSL 终止，并转发到你的服务器 80/443 端口。

## 数据持久化

**默认配置（Docker 卷）**：
```yaml
volumes:
  - ember-data:/app/data
```
数据存在 Docker 管理的卷里，查看位置：
```bash
docker volume inspect ember_ember-data
```

**指定目录（推荐生产环境）**：
```yaml
volumes:
  - /opt/ember/data:/app/data
```
数据存在宿主机 `/opt/ember/data`，便于备份和迁移。

## 备份与恢复

### 自动备份

仓库自带备份脚本：
```bash
bash scripts/backup.sh
```
会生成 `backups/ember-日期时间.tgz`，包含数据库和配置。

建议设置定时任务：
```bash
crontab -e
# 每天凌晨 3 点备份
0 3 * * * cd /path/to/ember && bash scripts/backup.sh
```

### 手动备份

```bash
# 备份数据库
docker exec ember-web-1 sqlite3 /app/data/ember.db ".backup /app/data/backup.db"
docker cp ember-web-1:/app/data/backup.db ./ember-backup-$(date +%Y%m%d).db

# 备份整个数据目录
tar czf ember-data-$(date +%Y%m%d).tgz /opt/ember/data
```

### 恢复

```bash
# 停止容器
docker compose down

# 恢复数据库
cp ember-backup-20261111.db /opt/ember/data/ember.db

# 重启容器
docker compose up -d
```

## 环境变量

生产环境必须配置的变量（`.env`）：

```bash
# 访问地址（用于邮件、回调等）
APP_URL=https://ember.你的域名.com

# 会话密钥（32 字节随机字符串）
SESSION_SECRET=<openssl rand -base64 32 的输出>

# 数据库路径（Docker 内固定）
DATABASE_URL=file:/app/data/ember.db

# 端口（通常保持 3000）
EMBER_PORT=3000

# 定时任务密钥（可选，用于日报/周报推送）
CRON_KEY=<随机字符串>
```

## 性能优化

### 内存限制

默认 512MB，可根据实际调整：
```yaml
mem_limit: 1g
```

### SQLite 优化

数据库已配置 WAL 模式，无需额外优化。如果数据量超过 100 万条记录，建议迁移到 PostgreSQL。

### 日志轮转

容器日志默认无限增长，建议配置轮转：
```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

## 安全加固

1. **限制端口**：只监听 `127.0.0.1:3000`，通过 Nginx 对外
2. **HTTPS only**：在 Nginx 里强制跳转 HTTPS
3. **定期备份**：至少每天一次
4. **更新依赖**：定期 `pnpm update`
5. **审计日志**：Ember 自带完整审计，定期检查异常操作

## 监控

### 健康检查

容器自带健康检查：
```bash
docker ps  # 查看 STATUS 列是否 healthy
```

### 手动检查

```bash
curl http://localhost:3000/api/health
# 应返回: {"ok":true}
```

### 日志

```bash
# 查看实时日志
docker logs -f ember-web-1

# 查看最近 100 行
docker logs --tail 100 ember-web-1
```

## 升级

1. 备份数据：
```bash
bash scripts/backup.sh
```

2. 拉取最新代码：
```bash
git pull origin main
```

3. 重新构建镜像：
```bash
docker compose build
```

4. 重启容器：
```bash
docker compose up -d
```

数据库迁移会自动执行（由 `scripts/migrate.mjs` 在启动时运行）。

## 故障排查

### 容器无法启动

```bash
# 查看日志
docker logs ember-web-1

# 常见原因：
# 1. SESSION_SECRET 未设置
# 2. 端口被占用
# 3. 数据库损坏（恢复备份）
```

### 502 Bad Gateway

```bash
# 检查容器是否运行
docker ps

# 检查容器健康状态
docker inspect ember-web-1 | grep -A 5 Health

# 检查 Nginx 配置
sudo nginx -t
```

### 数据库锁定

SQLite 在高并发下可能锁定，重启容器即可：
```bash
docker restart ember-web-1
```

如果频繁发生，建议：
1. 增加 `busy_timeout`（已配置 5000ms）
2. 迁移到 PostgreSQL

## 多实例部署

Ember 目前是单实例设计（基于 SQLite）。如需多实例，需要：
1. 迁移到 PostgreSQL
2. 使用 Redis 存储会话
3. 配置负载均衡器

这些超出当前文档范围，可根据需要联系维护者。

---

**部署完成后，访问 `/connect` 页面配置你的 AI agents！**
