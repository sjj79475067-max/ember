import { NextRequest } from "next/server";
import { z } from "zod";
import { createOwner, hasOwner } from "@/lib/bootstrap";
import { createSession } from "@/lib/auth";
import { parseBody, errorResponse } from "@/lib/http/api";

const schema = z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(8, "密码至少 8 位") });

export async function POST(req: NextRequest) {
  try {
    if (hasOwner()) return Response.json({ ok: false, error: "系统已初始化" }, { status: 409 });
    const body = await parseBody(req, schema);
    const u = createOwner(body.email, body.name, body.password);
    await createSession(u.id);
    return Response.json({ ok: true, user: u });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET() {
  return Response.json({ initialized: hasOwner() });
}
