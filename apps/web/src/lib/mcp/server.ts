import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { tools, toolsByName } from "./registry";
import type { Ctx } from "@/lib/http/api";
import { listProjects } from "@/lib/services/projects";

export function buildServer(ctx: Ctx) {
  const server = new Server(
    { name: "ember", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "你是连接【Ember 事务进度中心】的 agent。第一步必须调用 onboard 工具，它会告诉你：你是谁、活跃项目与进度、未读提醒、必读条例、你认领的任务与标准工作流。" +
        "原则：一切进度以中心数据为准，不要凭记忆；完成事项必须带 evidence；会议记录用 meeting_import 归档并自动抽取事务；资料只登记位置不存本体；收工前 checklist_verify 并 session_end。",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: zodToJsonSchema(t.input as never, { $refStrategy: "none" }) as { type: "object" },
      annotations: { readOnlyHint: !t.write, destructiveHint: false, idempotentHint: true },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const def = toolsByName.get(req.params.name);
    if (!def) return { isError: true, content: [{ type: "text", text: `未知工具：${req.params.name}。可用工具：${tools.map((t) => t.name).join(", ")}` }] };
    try {
      if (def.write && ctx.isAgent && !(ctx.scopes ?? []).includes("write"))
        throw Object.assign(new Error("该 Token 只有只读权限，不能执行写操作"), { status: 403 });
      const parsed = def.input.parse(req.params.arguments ?? {});
      const out = await def.handler(parsed, ctx);
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    } catch (e) {
      const err = e as Error & { status?: number; issues?: unknown; policy_gate?: unknown };
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message, status: err.status ?? 500, issues: err.issues, policy_gate: err.policy_gate }) }],
      };
    }
  });

  return server;
}

export function projectIndex() {
  return listProjects({}).map((p) => ({ key: p.key, name: p.name, progress: p.progress }));
}
