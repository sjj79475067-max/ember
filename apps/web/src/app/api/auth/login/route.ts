import { NextRequest } from "next/server";
import { z } from "zod";
import { db, s } from "@/lib/db";
import { eq } from "drizzle-orm";
import { verifyPassword, createSession } from "@/lib/auth";
import { parseBody, errorResponse, ApiError } from "@/lib/http/api";

const schema = z.object({ email: z.string(), password: z.string() });
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await parseBody(req, schema);
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    const key = `${ip}:${email.toLowerCase()}`;
    const a = attempts.get(key);
    if (a && a.n >= 8 && Date.now() < a.until) throw new ApiError(429, "尝试次数过多，请 5 分钟后再试");
    const u = db.select().from(s.users).where(eq(s.users.email, email.toLowerCase())).get();
    if (!u || !verifyPassword(password, u.passwordHash)) {
      attempts.set(key, { n: (a?.n ?? 0) + 1, until: Date.now() + 5 * 60_000 });
      throw new ApiError(401, "邮箱或密码不正确");
    }
    attempts.delete(key);
    await createSession(u.id);
    return Response.json({ ok: true, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  } catch (e) {
    return errorResponse(e);
  }
}
