import { NextRequest } from "next/server";
import { tools } from "@/lib/mcp/registry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = process.env.APP_URL || new URL(req.url).origin;
  const lines = [
    "# Ember · 事务进度中心（Agent 接入说明）",
    "",
    `> 一个自托管、Agent 优先的个人事务进度与资料定位中心。权威数据源：项目、任务清单、会议档案、决策、笔记、资料位置、提醒、条例。`,
    `> 不要在本地另存一份进度记忆；一切以中心为准。`,
    "",
    "## 接入方式（二选一）",
    "",
    "### A. MCP（推荐，Claude Code / Codex / Cursor / Cline…）",
    "```",
    `claude mcp add --transport http ember ${base}/api/mcp --header "Authorization: Bearer <TOKEN>"`,
    "```",
    `Streamable HTTP，无状态。Token 在 ${base}/connect 生成（ember_ 开头）。`,
    "",
    "### B. HTTP（任何能发请求的 agent）",
    "```",
    `curl -H "Authorization: Bearer <TOKEN>" "${base}/api/v1/onboard"`,
    `curl -X POST -H "Authorization: Bearer <TOKEN>" -H "content-type: application/json" \\`,
    `  -d '{"project":"IT","title":"...","text":"..."}' "${base}/api/v1/call/meeting_import"`,
    "```",
    `机器可读能力清单：${base}/.well-known/agent.json ；OpenAPI：${base}/openapi.json`,
    "",
    "## 第一步（必须）",
    `调用 onboard：\`${base}/api/v1/onboard\` 或 MCP 工具 onboard。`,
    "返回：你的身份与会话 id、活跃项目与进度、未读提醒、未确认的必读条例、你认领的任务、别人在做的任务、最近会议、标准工作流。",
    "",
    "## 统一协议（Ember Activity Protocol v1）",
    "- 所有返回信封：`{ ok, data, hints[], reminders_unread{total,byKind}, policy_gate{blocked,policies[]} }`",
    "- 项目可用 `key`（如 IT、ADMIN）或 id 指代；任务/会议/资料用 id。",
    "- `status=done` 必须带 `evidence`；`status=changed` 在 note 写清变更；`status=blocked` 必带 `block_reason`。",
    "- 写操作建议带 `expected_version`，冲突返回 409 与最新数据，请重读后再提交。",
    "- 文件不存中心：`file_register` 登记路径/链接；位置变了必须重新登记。",
    "- 同内容重复导入按指纹去重，可安全重试。",
    "- 归属不明不要猜：`checklist_add` 省略 project、`meeting_import`/`ingest_history` 不指定项目 → 进「收件箱」，等确认归属后 `item_move` 分拣。",
    "- 条例：agent 只能 `policy_write` 提议（进入待批准，不拦截任何操作）；只有用户在网页批准后才生效。agent 不能批准或废止条例。",
    "",
    "## 工具一览",
    ...tools.map((t) => `- **${t.name}**（${t.write ? "写" : "读"}）${t.title} — ${t.description.split("。")[0]}`),
    "",
    "## 标准工作流",
    "1. onboard → 2. 读/确认条例(policy_read/policy_ack) → 3. 定项目 → 4. checklist_list → 5. claim_item",
    "→ 6. 做事、记录(meeting_import / note_save / decision_record / file_register) → 7. checklist_update 带 evidence",
    "→ 8. checklist_verify 补 gaps → 9. session_end 写总结。",
    "",
    `完整说明：${base}/llms-full.txt`,
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" } });
}
