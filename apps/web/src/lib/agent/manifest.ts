import { tools } from "@/lib/mcp/registry";

export const API_VERSION = "1.0.0";
export const PROTOCOL = "ember-activity-v1";

export function buildManifest(baseUrl: string) {
  return {
    name: "ember",
    display_name: "Ember 事务进度中心",
    description: "Agent 优先的个人事务进度与资料定位中心：项目/清单/会议档案/资料位置/提醒/条例的统一协议。",
    api_version: API_VERSION,
    protocol: PROTOCOL,
    auth: {
      type: "bearer",
      header: "Authorization: Bearer <token>",
      token_prefix: "ember_",
      obtain: `${baseUrl}/connect`,
      scopes: ["read", "write"],
    },
    endpoints: {
      mcp: `${baseUrl}/api/mcp`,
      mcp_transport: "streamable-http",
      onboard: `${baseUrl}/api/v1/onboard`,
      call: `${baseUrl}/api/v1/call/{tool}`,
      llms: `${baseUrl}/llms.txt`,
      full: `${baseUrl}/llms-full.txt`,
      openapi: `${baseUrl}/openapi.json`,
      health: `${baseUrl}/api/health`,
    },
    first_call: {
      tool: "onboard",
      why: "返回你的身份、活跃项目、未读提醒、必读条例、你认领的任务和标准工作流。做完它再做事。",
    },
    tools: tools.map((t) => ({ name: t.name, title: t.title, description: t.description, write: !!t.write })),
    conventions: {
      ids: "项目可用 key（如 IT）或 id；任务/会议/资料用 id。",
      envelope: "所有返回：{ ok, data, hints[], reminders_unread{total,byKind}, policy_gate{blocked,policies[]} }",
      done_requires_evidence: "checklist_update status=done 必须带 evidence。",
      changed_semantics: "status=changed 表示部分完成或方案变更，需在 note 写清变更内容。",
      files: "中心不存文件本体，只登记位置；位置变化必须重新 file_register。",
      idempotency: "同内容重复导入按指纹去重。",
    },
    changelog: [
      { version: "1.0.0", date: "2026-11-05", notes: "首发：项目/清单/会议/资料/提醒/条例/搜索/会话。" },
    ],
  };
}
