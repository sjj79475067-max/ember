#!/usr/bin/env bash
# Ember 备份：Docker 模式打包数据卷；本机模式复制 data 目录。
set -euo pipefail
OUT=${1:-"./backups"}
mkdir -p "$OUT"
STAMP=$(date +%Y%m%d-%H%M%S)
cd "$(dirname "$0")/.."
if docker compose ps --format '{{.Name}}' 2>/dev/null | grep -q ember; then
  docker run --rm -v ember_ember-data:/data -v "$PWD/$OUT":/out alpine \
    sh -c "tar czf /out/ember-$STAMP.tgz -C /data ."
  echo "已备份到 $OUT/ember-$STAMP.tgz"
else
  tar czf "$OUT/ember-$STAMP.tgz" -C apps/web data
  echo "已备份到 $OUT/ember-$STAMP.tgz"
fi
