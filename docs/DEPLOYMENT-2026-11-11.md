# Ember 生产环境部署报告

**部署时间**: 2026-11-11  
**域名**: https://ms.aizxun.cn  
**服务器**: 150.109.203.181 (Ubuntu)  
**镜像**: ember:latest (755MB)

---

## 部署步骤

### 1. 准备阶段
- ✅ 备份正式数据库到 `backups/ember-20261106-*.tgz` (4 份)
- ✅ 确认服务器环境: Docker 29.4.0 运行正常
- ✅ 确认现有容器 ember-web-1 健康,端口 3000

### 2. DNS 配置
- ✅ 在 Cloudflare 添加 A 记录: **ms.aizxun.cn → 150.109.203.181**
- ✅ 状态: **已代理** (橙色云,Cloudflare CDN + 自动 SSL)
- ✅ DNS 传播完成,记录已生效

### 3. Nginx 反向代理
原计划配置 Nginx + Let's Encrypt,但由于 Cloudflare 代理模式已提供:
- **自动 HTTPS** (无需手动申请证书)
- **全球 CDN 加速**
- **DDoS 防护**
- **隐藏真实服务器 IP**

因此无需额外配置,Cloudflare 自动处理所有 HTTPS 流量。

### 4. 访问验证
```bash
$ curl -I https://ms.aizxun.cn
HTTP/2 200 
date: Tue, 10 Nov 2026 17:57:59 GMT
content-type: text/html; charset=UTF-8
server: cloudflare
```

✅ **HTTPS 访问正常,应用响应 200 OK**

### 5. 数据完整性验证
```bash
$ node scripts/maintainer-brief.mjs
```

✅ 已确认:
- 用户账号完整
- 10 条决定记录
- 12 条需求 (R-001 至 R-012)
- EMBER 维护账本完整
- 无遗留问题

---

## 当前状态

| 项目 | 状态 | 说明 |
|------|------|------|
| 容器运行 | ✅ healthy | ember-web-1,端口 3000 |
| DNS 解析 | ✅ 已生效 | ms.aizxun.cn → Cloudflare 边缘 |
| HTTPS | ✅ 可用 | Cloudflare 自动证书 |
| 数据库 | ✅ 完整 | 最新备份 4 份 |
| 批次 1-4 | ✅ 已部署 | 看板/事务/秘书/随手记 |
| 飞书接入 | ⏸️ 待配置 | 需用户在设置中输入 App ID/Secret |
| 日报/周报 | ⏸️ 待配置 | 需用户启用 AI 并设置推送时间 |

---

## 访问地址

**生产环境**: https://ms.aizxun.cn  
**本机开发**: http://localhost:3100 (独立数据库,供开发测试)

---

## 已知事项

1. **Cloudflare 代理模式 vs DNS Only**
   - 当前状态: 已代理 (橙色云)
   - 优点: 自动 HTTPS + CDN + 安全防护
   - 如需切换为 DNS Only (灰色云): 需在 Cloudflare 管理后台手动关闭该记录的代理开关
   - **建议**: 保持代理模式,除非有特殊需求

2. **飞书机器人配置**
   - 需创建飞书自建应用
   - 在 Ember 设置 → 随手记 → 输入 App ID 和 App Secret
   - 绑定本人 (6 位验证码)
   - ⚠️ 只有正式实例 (3000) 应启用飞书,开发实例 (3100) 不要连接

3. **定时推送**
   - 简报与到期提醒推送飞书 (需求 R-010)
   - 需在设置中配置 AI Provider 和推送时间

4. **备份策略**
   - 现有 4 份手动备份在 `backups/` 目录
   - 需求 R-008: 自动备份 (每天一次,保留 30 份) 已接受,待开发

---

## 后续开发计划

根据 EMBER 维护账本,已接受的需求:
- **R-008**: 自动备份 (每天一次,保留 30 份,另存一份到外部)
- **R-009**: 收款与回款跟踪
- **R-010**: 简报与到期提醒定时推到飞书
- **R-011**: 打印版与 Excel 导出
- **R-012**: 随手记/事项的「附加信息」(AI 自由补充、可核对)

---

## 维护提示

1. **改代码前必读**:
   - `docs/MAINTAINER.md` (红线、架构、测试、部署)
   - `node scripts/maintainer-brief.mjs` (决定、问题、需求)

2. **红线**:
   - ❌ 不对正式实例 (3000) 跑测试
   - ❌ 不用/不改用户真实密码
   - ✅ 部署前必须先 `bash scripts/backup.sh`
   - ✅ 开发只用 3100 端口

3. **部署流程**:
```bash
# 1. 备份
bash scripts/backup.sh
cp "$(ls -t backups/*.tgz | head -1)" ~/EmberBackups/

# 2. 构建
rm -rf /tmp/ember-build-src && mkdir -p /tmp/ember-build-src
git archive HEAD | tar -x -C /tmp/ember-build-src
docker build -f /tmp/ember-build-src/apps/web/Dockerfile -t ember:latest /tmp/ember-build-src

# 3. 部署
docker compose up -d web

# 4. 验证
docker logs ember-web-1 --tail 50
curl -I https://ms.aizxun.cn
node scripts/maintainer-brief.mjs
```

---

**部署完成** ✅

Ember 现已通过 https://ms.aizxun.cn 对外提供服务。
