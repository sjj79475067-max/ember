#!/usr/bin/env bash
# 恢复： ./scripts/restore.sh backups/ember-YYYYmmdd-HHMMSS.tgz
set -euo pipefail
ARCHIVE=${1:?用法: ./scripts/restore.sh <备份文件>}
cd "$(dirname "$0")/.."
if docker compose ps --format '{{.Name}}' 2>/dev/null | grep -q ember; then
  echo "停止服务…"; docker compose stop web
  docker run --rm -v ember_ember-data:/data -v "$PWD":/src alpine \
    sh -c "rm -rf /data/* && tar xzf /src/$ARCHIVE -C /data"
  docker compose start web
else
  rm -rf apps/web/data.bak && mv apps/web/data apps/web/data.bak 2>/dev/null || true
  mkdir -p apps/web/data && tar xzf "$ARCHIVE" -C apps/web
fi
echo "恢复完成。"
