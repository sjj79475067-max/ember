import { NextRequest } from "next/server";
import { zodToJsonSchema } from "zod-to-json-schema";
import { tools } from "@/lib/mcp/registry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = process.env.APP_URL || new URL(req.url).origin;
  const parts = [
    "# Ember 事务进度中心 · 完整 Agent 手册",
    "",
    `服务地址：${base}`,
    "鉴权：`Authorization: Bearer ember_xxx`（在 /connect 生成）。MCP 端点 /api/mcp（Streamable HTTP，无状态）；REST 通用调用 /api/v1/call/{tool}。",
    "",
    "## 协议约定（Ember Activity Protocol v1）",
    "- 信封：`{ok, data, hints[], reminders_unread{total, byKind}, policy_gate{blocked, policies[]}}`。",
    "- policy_gate.blocked=true 时，写操作会被 403 拦截：先 policy_read 再 policy_ack。",
    "- 时间均为 Unix 秒。",
    "- 任务状态：todo / doing / blocked / done / dropped / changed。",
    "- 完成必须证据：evidence 写清『做了什么 + 在哪可验证（链接/路径/命令）』。",
    "- 认领：claim_item 后任务变 doing；他人已认领时返回 conflict（2 小时无心跳自动失效），需先问用户。",
    "- 会话：onboard 返回 session_id；长任务每 20–30 分钟 sync 一次；收工 session_end 写总结并释放认领。",
    "",
    "## 工具（含输入 schema）",
  ];
  for (const t of tools) {
    parts.push(
      "",
      `### ${t.name} — ${t.title}${t.write ? "（写）" : "（读）"}`,
      t.description,
      "```json",
      JSON.stringify(zodToJsonSchema(t.input as never, { $refStrategy: "none" }), null, 2),
      "```",
      `调用：POST ${base}/api/v1/call/${t.name}`,
    );
  }
  parts.push(
    "",
    "## 场景配方",
    "### 开完会，把会议记录归档并生成清单",
    "meeting_import({project:'IT', title:'周会', text:'<原文，可含飞书/腾讯会议转写>', source:'feishu'}) → 自动摘要 + 抽取 items + 建立会议档案。若你已整理好条目，直接传 items。",
    "",
    "### 补录过去与 agent 的对话",
    "ingest_history({project:'ADMIN', text:'<对话摘录>', kind:'meeting', create_items:true}) → 按指纹去重，重复调用安全。",
    "",
    "### 做完一批事，核销",
    "checklist_list({project:'IT', status:'open'}) → 逐条 checklist_update({item_id, status:'done', evidence:'commit abc123 / 文件路径 / 测试命令'}) → checklist_verify({project:'IT'}) 检查 gaps。",
    "",
    "### 资料位置",
    "file_register({project:'IT', label:'部署手册', machine:'macmini', path:'~/projects/x/DEPLOY.md', archive_to:'github', verify:true})；移动后 file_register 同路径更新或 file_verify({result:'moved', new_path})。",
    "",
    "### 到期与条例提醒",
    "onboard/sync/任意写工具返回 reminders_unread；reminders_pull 拉全量；reminder_ack 处理。条例必读：policy_read → policy_ack。",
    "",
    "## 错误码",
    "- 401 未认证；403 无权限 / 条例门禁；404 不存在；409 版本冲突或认领冲突；422 参数不合法（issues 有明细）；429 太频繁。",
  );
  return new Response(parts.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" } });
}
