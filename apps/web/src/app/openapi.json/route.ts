import { NextRequest } from "next/server";
import { zodToJsonSchema } from "zod-to-json-schema";
import { tools } from "@/lib/mcp/registry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = process.env.APP_URL || new URL(req.url).origin;
  const paths: Record<string, unknown> = {
    "/api/v1/onboard": {
      get: {
        operationId: "onboard",
        summary: "开始工作：身份、项目、提醒、条例、工作流",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "ok" } },
      },
    },
    "/api/health": { get: { operationId: "health", summary: "健康检查", responses: { "200": { description: "ok" } } } },
  };
  for (const t of tools) {
    if (t.name === "onboard") continue;
    paths[`/api/v1/call/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.title,
        description: t.description,
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: zodToJsonSchema(t.input as never, { $refStrategy: "none" }) } } },
        responses: { "200": { description: "统一信封 { ok, data, hints, reminders_unread, policy_gate }" } },
      },
    };
  }
  return Response.json({
    openapi: "3.1.0",
    info: { title: "Ember 事务进度中心 API", version: "1.0.0", description: "Agent 优先的事务进度与资料定位中心。先 GET /api/v1/onboard。" },
    servers: [{ url: base }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Ember API Token（ember_ 开头）" } } },
    paths,
  });
}
