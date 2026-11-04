import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer } from "@/lib/auth";
import { getSessionUser } from "@/lib/auth";
import type { Actor } from "@/lib/audit";
import { newId } from "@/lib/id";

export type Ctx = { actor: Actor; ip: string; requestId: string; tokenId?: string; sessionId?: string; isAgent: boolean };

export class ApiError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) return NextResponse.json({ ok: false, error: e.message, ...(e.extra ?? {}) }, { status: e.status });
  const any = e as { status?: number; message?: string };
  if (any?.status && any.status >= 400 && any.status < 600) return NextResponse.json({ ok: false, error: any.message ?? "错误" }, { status: any.status });
  console.error("[api]", e);
  return NextResponse.json({ ok: false, error: "服务器内部错误" }, { status: 500 });
}

export async function withAgent(req: NextRequest, handler: (ctx: Ctx) => Promise<Response> | Response, opts: { write?: boolean } = {}) {
  const requestId = req.headers.get("x-request-id") ?? newId("req");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const auth = authenticateBearer(req.headers.get("authorization"));
  try {
    if (auth) {
      if (opts.write && !auth.scopes.includes("write")) throw new ApiError(403, "该 Token 没有写权限（缺少 write scope）");
      return await handler({
        actor: { type: "agent", name: auth.agentName }, ip, requestId, tokenId: auth.tokenId,
        sessionId: req.headers.get("x-agent-session") ?? undefined, isAgent: true,
      });
    }
    const user = await getSessionUser();
    if (!user) throw new ApiError(401, "未认证：请提供 Authorization: Bearer <agent token>，或以网页登录会话访问");
    if (opts.write && user.role === "client") throw new ApiError(403, "只读账号不能写操作");
    return await handler({ actor: { type: "user", name: user.name }, ip, requestId, isAgent: false });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function parseBody<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "请求体必须是 JSON");
  }
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new ApiError(422, "参数校验失败", { issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  return r.data;
}
