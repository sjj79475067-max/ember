#!/usr/bin/env node
/**
 * ember-mcp —— 给只支持 stdio 的 MCP 客户端使用的桥。
 *   npx ember-mcp --url http://localhost:3000 --token ember_xxx
 *   env: EMBER_URL, EMBER_TOKEN
 * argv 透传：--url <base> --token <token>
 */
const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const base = (get("--url") || process.env.EMBER_URL || "http://localhost:3000").replace(/\/$/, "");
const token = get("--token") || process.env.EMBER_TOKEN || "";
const endpoint = `${base}/api/mcp`;

const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};

let sessionHeader = {};
let buffer = "";
let nextId = 1;

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function forward(msg) {
  const res = await fetch(endpoint, { method: "POST", headers: { ...headers, ...sessionHeader }, body: JSON.stringify(msg) });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionHeader["mcp-session-id"] = sid;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try { send(JSON.parse(data)); } catch {}
    }
  } else {
    const text = await res.text();
    if (!text.trim()) return;
    try { send(JSON.parse(text)); } catch { send({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32000, message: `上游返回非 JSON：${text.slice(0, 200)}` } }); }
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === undefined && msg.method) continue; // 通知类：本地消费即可
    forward(msg).catch((e) => send({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32001, message: `无法连接 ${endpoint}：${e.message}。请检查 --url 与 --token。` } }));
  }
});
process.stdin.on("end", () => process.exit(0));
void nextId;
