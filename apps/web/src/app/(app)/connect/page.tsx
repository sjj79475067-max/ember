import { db, s } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { headers } from "next/headers";
import { ConnectClient } from "./connect-client";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const user = await getSessionUser();
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = process.env.APP_URL || `${proto}://${host}`;
  const tokens = db.select().from(s.apiTokens).all().map((t) => ({ id: t.id, name: t.name, agentType: t.agentType, prefix: t.prefix, lastUsedAt: t.lastUsedAt, revokedAt: t.revokedAt, createdAt: t.createdAt }));
  return <ConnectClient base={base} user={user?.name ?? ""} tokens={JSON.parse(JSON.stringify(tokens))} />;
}
