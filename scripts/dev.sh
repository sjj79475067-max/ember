#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../apps/web"
export DATABASE_URL=${DATABASE_URL:-file:./data/ember.db}
node scripts/migrate.mjs
pnpm dev
