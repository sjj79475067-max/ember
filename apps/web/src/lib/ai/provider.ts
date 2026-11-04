import { db, s } from "@/lib/db";
import { eq } from "drizzle-orm";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { newId, nowSec } from "@/lib/id";

const encKey = () => createHash("sha256").update(process.env.AI_ENCRYPTION_KEY || process.env.SESSION_SECRET || "dev").digest();

export function encryptKey(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const out = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${out.toString("base64url")}`;
}

export function decryptKey(enc: string): string {
  if (!enc) return "";
  const [ivB, tagB, dataB] = enc.split(".");
  if (!ivB || !tagB || !dataB) return "";
  const d = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB, "base64url"));
  d.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([d.update(Buffer.from(dataB, "base64url")), d.final()]).toString("utf8");
}

export type ProviderRow = typeof s.aiProviders.$inferSelect;

export function getDefaultProvider(): ProviderRow | null {
  const rows = db.select().from(s.aiProviders).where(eq(s.aiProviders.enabled, 1)).all();
  return rows.find((r) => r.isDefault) ?? rows[0] ?? null;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function chat(messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number; feature?: string } = {}) {
  const p = getDefaultProvider();
  if (!p) throw new Error("未配置 AI Provider");
  const key = decryptKey(p.apiKeyEnc);
  const started = Date.now();
  let text = "";
  let inputTokens = 0, outputTokens = 0;
  if (p.kind === "anthropic") {
    const res = await fetch(`${p.baseUrl || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: p.model, max_tokens: opts.maxTokens ?? 4096,
        system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || undefined,
        messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    text = data.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
    inputTokens = data.usage?.input_tokens ?? 0;
    outputTokens = data.usage?.output_tokens ?? 0;
  } else {
    const base = (p.baseUrl || "https://api.openai.com").replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: p.model, messages, max_tokens: opts.maxTokens ?? 4096,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`${p.label} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    text = data.choices?.[0]?.message?.content ?? "";
    inputTokens = data.usage?.prompt_tokens ?? 0;
    outputTokens = data.usage?.completion_tokens ?? 0;
  }
  db.insert(s.aiUsage).values({ id: newId("aiu"), providerId: p.id, feature: opts.feature ?? "chat", inputTokens, outputTokens, ms: Date.now() - started, ok: 1, createdAt: nowSec() }).run();
  return { text, provider: p.label, model: p.model, inputTokens, outputTokens };
}

export async function testProvider(p: ProviderRow) {
  const started = Date.now();
  const key = decryptKey(p.apiKeyEnc);
  try {
    if (p.kind === "anthropic") {
      const res = await fetch(`${p.baseUrl || "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: p.model, max_tokens: 16, messages: [{ role: "user", content: "回复 ok" }] }),
      });
      return { ok: res.ok, ms: Date.now() - started, message: res.ok ? "连接成功" : `HTTP ${res.status}` };
    }
    const base = (p.baseUrl || "https://api.openai.com").replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: p.model, max_tokens: 16, messages: [{ role: "user", content: "回复 ok" }] }),
    });
    return { ok: res.ok, ms: Date.now() - started, message: res.ok ? "连接成功" : `HTTP ${res.status}: ${(await res.text()).slice(0, 120)}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, message: (e as Error).message };
  }
}
