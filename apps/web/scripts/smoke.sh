#!/usr/bin/env bash
# 全链路冒烟：初始化 → 登录 → 建项目 → 导入会议 → 生成清单 → agent 认领/核销 → 提醒
set -euo pipefail
BASE=${1:-http://localhost:3000}
TOKEN_FILE=${2:-"/tmp/ember-smoke-token"}
EMAIL="smoke$$@example.com"
ADMIN_EMAIL=${ADMIN_EMAIL:-me@example.com}
ADMIN_PASS=${ADMIN_PASS:-ember12345}

jq_() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

echo "== 1. 初始化（若已初始化则跳过）"
INIT=$(curl -s "$BASE/api/auth/setup")
if [ "$(echo "$INIT" | jq_ 'd["initialized"]')" = "False" ]; then
  curl -s -X POST "$BASE/api/auth/setup" -H 'content-type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"name\":\"冒烟\",\"password\":\"$ADMIN_PASS\"}" > /dev/null
  echo "  已创建管理员 $ADMIN_EMAIL"
else
  echo "  已初始化，跳过"
fi

echo "== 2. 管理员登录"
SESSION=$(mktemp)
LOGIN=$(curl -s -c "$SESSION" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
if [ "$(echo "$LOGIN" | jq_ 'd.get("ok")')" != "True" ]; then
  echo "  登录失败：$LOGIN" ; exit 1
fi
echo "  登录成功"

echo "== 3. 生成 agent token"
TOK=$(curl -s -b "$SESSION" -X POST "$BASE/api/ui/tokens" -H 'content-type: application/json' -d '{"name":"smoke-agent"}' | jq_ 'd["token"]')
echo "$TOK" > "$TOKEN_FILE"

echo "== 4. 确认条例"
POL=$(curl -s -b "$SESSION" -X POST "$BASE/api/ui/policies" -H 'content-type: application/json' -d '{"title":"冒烟条例","body_md":"完成任务必须有证据","required":true}' | jq_ 'd["policy"]["id"]')
curl -s -X POST "$BASE/api/v1/call/policy_ack" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"policy_id\":\"$POL\"}" > /dev/null
# 确认其余必读条例（沿用历史库时）
for P in $(curl -s -X POST "$BASE/api/v1/call/policy_read" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d '{}' | python3 -c "import sys,json;d=json.load(sys.stdin);print(' '.join(p['id'] for p in d['data']['policies'] if p['required'] and not p['acked']))"); do
  curl -s -X POST "$BASE/api/v1/call/policy_ack" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"policy_id\":\"$P\"}" > /dev/null
done

echo "== 5. agent onboard"
ONB=$(curl -s -H "Authorization: Bearer $TOK" "$BASE/api/v1/onboard?session_ref=smoke-run")
echo "  项目 $(echo "$ONB" | jq_ 'len(d["data"]["projects"])') 个；未读提醒 $(echo "$ONB" | jq_ 'd["data"]["reminders_unread"]["total"]')"

echo "== 6. 建项目 + 导入会议（确定性拆分，无 AI）"
KEY="SMOKE$(date +%s | tail -c 5)"
PID=$(curl -s -X POST "$BASE/api/v1/call/project_create" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"key\":\"$KEY\",\"name\":\"冒烟项目\",\"kind\":\"it\"}" | jq_ 'd["data"]["project"]["id"]')
MEETING=$(curl -s -X POST "$BASE/api/v1/call/meeting_import" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"project\":\"$PID\",\"title\":\"冒烟会议\",\"text\":\"1. 完成登录改造，本周内完成\\n2. 接入看板指标\\n3. 输出部署手册\",\"parse_with_ai\":true}")
echo "  会议 $(echo "$MEETING" | jq_ 'd["data"]["meeting_id"]')；生成 $(echo "$MEETING" | jq_ 'len(d["data"]["created_item_ids"])') 条"

echo "== 7. 认领 + 完成（带证据）"
ITEM=$(curl -s -X POST "$BASE/api/v1/call/checklist_list" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"project\":\"$PID\",\"status\":\"open\",\"limit\":1}")
IID=$(echo "$ITEM" | jq_ 'd["data"]["items"][0]["id"]')
SID=$(echo "$ONB" | jq_ 'd["data"]["session_id"]')
curl -s -X POST "$BASE/api/v1/call/claim_item" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"item_id\":\"$IID\",\"session_id\":\"$SID\"}" > /dev/null
RES=$(curl -s -X POST "$BASE/api/v1/call/checklist_update" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"item_id\":\"$IID\",\"status\":\"done\",\"evidence\":\"smoke: commit deadbeef\"}")
echo "  状态 $(echo "$RES" | jq_ 'd["data"]["item"]["status"]')；进度 $(echo "$RES" | jq_ 'd["data"]["progress"]["done"]')/$(echo "$RES" | jq_ 'd["data"]["progress"]["total"]')"

echo "== 8. 资料登记 + 核验 + 提醒"
curl -s -X POST "$BASE/api/v1/call/file_register" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"project\":\"$PID\",\"label\":\"部署手册\",\"path\":\"~/x/DEPLOY.md\",\"verify\":true}" > /dev/null
REM=$(curl -s -X POST "$BASE/api/v1/call/reminders_pull" -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d '{}')
echo "  提醒 $(echo "$REM" | jq_ 'len(d["data"]["reminders"])') 条"

echo "== 9. MCP 冒烟"
node "$(dirname "$0")/mcp-smoke.mjs" "$BASE" "$TOK" "MCP$KEY" | tail -3

rm -f "$SESSION"
echo "冒烟通过 ✅"
