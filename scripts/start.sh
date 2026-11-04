#!/usr/bin/env bash
# 本机启动 Ember（不依赖 Docker）：建库 → 迁移 → 启动
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { cp .env.example .env; echo "已生成 .env（本机模式可直接使用）"; }
set -a; . ./.env; set +a
export DATABASE_URL=file:./data/ember.db
cd apps/web
mkdir -p data
node scripts/migrate.mjs
echo "启动 http://localhost:${EMBER_PORT:-3000}"
pnpm start
