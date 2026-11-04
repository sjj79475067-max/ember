#!/usr/bin/env node
/**
 * MCP 端到端冒烟：initialize → tools/list → onboard → 建项目 → 加清单 → 完成核销。
 * 用法: node scripts/mcp-smoke.mjs <baseUrl> <token> [projectKey]
 */
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const token = process.argv[3];
const key = process.argv[4] ?? `SMOKE${Date.now().toString().slice(-5)}`;
if (!token) { console.error("用法: node scripts/mcp-smoke.mjs <baseUrl> <token> [projectKey]"); process.exit(1); }

let id = 0;
async function rpc(method, params) {
  const res = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${method}: ${data.error.message}`);
  return data.result;
}
const call = async (name, args) => {
  const r = await rpc("tools/call", { name, arguments: args });
  const text = r.content?.[0]?.text ?? "{}";
  const parsed = JSON.parse(text);
  if (r.isError) throw new Error(`${name} 失败：${parsed.error}`);
  return parsed;
};
const step = (n, m) => console.log(`  ✓ ${n}. ${m}`);

(async () => {
  console.log(`MCP 冒烟 @ ${base}`);
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ember-smoke", version: "1" } });
  step(1, `initialize → ${init.serverInfo.name} v${init.serverInfo.version}`);
  const list = await rpc("tools/list", {});
  const bytes = JSON.stringify(list).length;
  step(2, `tools/list → ${list.tools.length} 个工具，约 ${Math.round(bytes / 2.5 / 100) / 10}k tokens（UTF-8 ${bytes}B）`);
  const ob = await call("onboard", { session_ref: `smoke-${Date.now()}`, machine: "smoke-test" });
  step(3, `onboard → 项目 ${ob.data.projects.length} 个，未读提醒 ${ob.data.reminders_unread.total}`);
  const proj = await call("project_create", { key, name: `冒烟项目 ${key}`, kind: "it" });
  step(4, `project_create → ${proj.data.project.key}`);
  const added = await call("checklist_add", { project: key, items: [{ title: "冒烟任务一", done_definition: "冒烟通过" }, { title: "冒烟任务二" }] });
  step(5, `checklist_add → ${added.data.ids.length} 条`);
  const items = await call("checklist_list", { project: key, status: "open" });
  const first = items.data.items[0];
  const done = await call("checklist_update", { item_id: first.id, status: "done", evidence: "mcp-smoke：无需人工验证" });
  step(6, `checklist_update → done=${done.data.item.status}，进度 ${done.data.progress.done}/${done.data.progress.total}`);
  const v = await call("checklist_verify", { project: key });
  step(7, `checklist_verify → ${v.data.gaps.length} 个 gap`);
  const end = await call("session_end", { session_id: ob.data.session_id, summary: "冒烟完成" });
  step(8, `session_end → ${end.data.closed ? "会话已关闭" : "失败"}`);
  console.log("MCP 冒烟全部通过 ✅");
})().catch((e) => { console.error("MCP 冒烟失败 ❌", e.message); process.exit(1); });
