#!/usr/bin/env bash
# 恢复： ./scripts/restore.sh backups/ember-YYYYmmdd-HHMMSS.tgz
# 关键：SQLite 文件属主必须与容器内 nextjs(1001) 一致，否则只读。
set -euo pipefail
ARCHIVE=$(cd "$(dirname "${1:?用法: ./scripts/restore.sh <备份文件>}")" && pwd)/$(basename "${1}")
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
tar xzf "$ARCHIVE" -C "$TMP"
if docker compose ps 2>/dev/null | grep -q ember-web; then
  echo "停止服务…"
  docker compose stop web >/dev/null
  docker run --rm -v ember_ember-data:/data -v "$TMP":/src alpine \
    sh -c "rm -rf /data/* && cp -a /src/. /data/ && chown -R 1001:1001 /data"
  docker compose start web >/dev/null
else
  mkdir -p apps/web/data
  cp -a "$TMP"/. apps/web/data/
fi
rm -rf "$TMP"
echo "恢复完成。"
