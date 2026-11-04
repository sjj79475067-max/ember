import { db, s } from "@/lib/db";
import { SettingsClient } from "./settings-client";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  const providers = db.select().from(s.aiProviders).all().map((p) => ({ id: p.id, label: p.label, kind: p.kind, baseUrl: p.baseUrl, model: p.model, enabled: p.enabled, isDefault: p.isDefault, hasKey: !!p.apiKeyEnc }));
  const usage = db.select().from(s.aiUsage).all();
  const sessions = db.select().from(s.agentSessions).all().slice(-20).reverse();
  return <SettingsClient providers={JSON.parse(JSON.stringify(providers))} usage={{ calls: usage.length, input: usage.reduce((a, u) => a + u.inputTokens, 0), output: usage.reduce((a, u) => a + u.outputTokens, 0) }} sessions={JSON.parse(JSON.stringify(sessions))} user={{ name: user?.name ?? "", email: user?.email ?? "" }} />;
}
