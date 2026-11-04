import { cookies } from "next/headers";
import { createHmac, randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { db, s } from "@/lib/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";

const COOKIE = "ember_session";
const SESSION_TTL = 60 * 60 * 24 * 14;
const secret = () => process.env.SESSION_SECRET ?? "dev-secret-change-me";

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt:${salt}:${key}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, salt, key] = stored.split(":");
  if (alg !== "scrypt" || !salt || !key) return false;
  const calc = scryptSync(pw, salt, 64);
  const exp = Buffer.from(key, "hex");
  return calc.length === exp.length && timingSafeEqual(calc, exp);
}

export function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  db.insert(s.sessions).values({ id: newId("ses"), userId, tokenHash, expiresAt: nowSec() + SESSION_TTL, createdAt: nowSec() }).run();
  const jar = await cookies();
  jar.set(COOKIE, `${token}.${sign(token)}`, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL, secure: process.env.NODE_ENV === "production",
  });
}

export async function destroySession() {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (raw) {
    const [token, sig] = raw.split(".");
    if (token && sig && sign(token) === sig) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      db.delete(s.sessions).where(eq(s.sessions.tokenHash, tokenHash)).run();
    }
  }
  jar.delete(COOKIE);
}

export type CurrentUser = { id: string; name: string; email: string; role: string };

export async function getSessionUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const [token, sig] = raw.split(".");
  if (!token || !sig || sign(token) !== sig) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = db.select({ user: s.users })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.tokenHash, tokenHash), gt(s.sessions.expiresAt, nowSec())))
    .get();
  if (!row) return null;
  return { id: row.user.id, name: row.user.name, email: row.user.email, role: row.user.role };
}

// ---------- Agent token ----------
export function hashToken(t: string) {
  return createHash("sha256").update(t).digest("hex");
}

export function mintApiToken(name: string, agentType: string, scopes = "read,write") {
  const raw = `ember_${randomBytes(24).toString("base64url")}`;
  const prefix = raw.slice(0, 12);
  const id = newId("tok");
  const owner = db.select().from(s.users).limit(1).get();
  if (!owner) throw new Error("no owner user");
  db.insert(s.apiTokens).values({
    id, userId: owner.id, name, agentType, prefix, hash: hashToken(raw), scopes, createdAt: nowSec(),
  }).run();
  return { id, raw, prefix };
}

export function authenticateBearer(header: string | null): { tokenId: string; userId: string; agentName: string; agentType: string; scopes: string[] } | null {
  if (!header?.startsWith("Bearer ")) return null;
  const raw = header.slice(7).trim();
  const hash = hashToken(raw);
  const row = db.select().from(s.apiTokens).where(and(eq(s.apiTokens.hash, hash), isNull(s.apiTokens.revokedAt))).get();
  if (!row) return null;
  db.update(s.apiTokens).set({ lastUsedAt: nowSec() }).where(eq(s.apiTokens.id, row.id)).run();
  return { tokenId: row.id, userId: row.userId, agentName: row.name, agentType: row.agentType, scopes: row.scopes.split(",") };
}
