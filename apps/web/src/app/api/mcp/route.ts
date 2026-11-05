import { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer } from "@/lib/mcp/server";
import { authenticateBearer, getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const auth = authenticateBearer(req.headers.get("authorization"));
  let actor: { type: "agent" | "user"; name: string };
  let tokenId: string | undefined;
  if (auth) {
    if (!auth.scopes.includes("read")) return Response.json({ jsonrpc: "2.0", error: { code: -32001, message: "Token 无 read 权限" }, id: null }, { status: 403 });
    actor = { type: "agent", name: auth.agentName };
    tokenId = auth.tokenId;
  } else {
    const user = await getSessionUser();
    if (!user) return Response.json({ jsonrpc: "2.0", error: { code: -32001, message: "未认证：需要 Authorization: Bearer <token>" }, id: null }, { status: 401 });
    actor = { type: "user", name: user.name };
  }

  const ctx = {
    actor,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
    requestId: req.headers.get("x-request-id") ?? crypto.randomUUID(),
    tokenId,
    sessionId: req.headers.get("x-agent-session") ?? undefined,
    isAgent: auth != null,
    scopes: auth?.scopes ?? ["read", "write"],
  };

  const server = buildServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "content-type,authorization,mcp-session-id,mcp-protocol-version,x-agent-session" },
  });
}
