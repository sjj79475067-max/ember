#!/usr/bin/env node
// 只读打印 Ember 维护账本（EMBER 项目的决定 / 问题 / 需求）。
// 默认从正式容器 ember-web-1 复制一份数据库到临时目录再读，不写任何东西。
// 用法：node scripts/maintainer-brief.mjs [数据库文件路径]
import { execSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("apps/web/package.json"));
const Database = require("better-sqlite3");

let file = process.argv[2];
let tmp;
if (!file) {
  tmp = mkdtempSync(path.join(tmpdir(), "ember-brief-"));
  file = path.join(tmp, "ember.db");
  try {
    execSync(`docker cp ember-web-1:/app/data/ember.db ${file}`, { stdio: "ignore" });
    try { execSync(`docker cp ember-web-1:/app/data/ember.db-wal ${file}-wal`, { stdio: "ignore" }); } catch {}
  } catch {
    console.error("读不到正式实例的数据库（容器 ember-web-1 没在运行？）。可以传数据库路径：node scripts/maintainer-brief.mjs <path>");
    process.exit(1);
  }
}
if (!existsSync(file)) { console.error("数据库不存在：" + file); process.exit(1); }
const db = new Database(file, { readonly: true });
const p = db.prepare("select * from projects where key = 'EMBER'").get();
if (!p) { console.log("还没有 EMBER 项目（新版本启动后会自动创建）。"); process.exit(0); }

const items = db.prepare("select * from items where projectId = ?").all(p.id);
const open = items.filter((i) => ["todo", "doing", "blocked", "changed"].includes(i.status))
  .map((i) => ({ ...i, times: (i.detailMd.match(/【/g) ?? []).length + 1 }))
  .sort((a, b) => a.priority.localeCompare(b.priority) || b.times - a.times);
const decisions = db.prepare("select * from decisions where projectId = ? and status != 'superseded' order by createdAt desc").all(p.id);
const reqs = db.prepare("select * from requirements where projectId = ? order by code").all(p.id);

console.log("# Ember 维护账本\n");
console.log("## 已定的决定（不要推翻重做；要改先问用户）");
for (const d of decisions) console.log(`- ${d.title}\n  原因：${d.rationaleMd}${d.impact ? `\n  注意：${d.impact}` : ""}`);
console.log("\n## 没解决的问题");
if (!open.length) console.log("（无）");
for (const i of open) console.log(`- [${i.priority}] ${i.title}（被报 ${i.times} 次，${i.id}）\n  ${i.detailMd.split("\n").slice(-4).join("\n  ")}`);
console.log("\n## 需求");
for (const r of reqs) console.log(`- ${r.code} [${r.status}] ${r.title}`);
db.close();
if (tmp) rmSync(tmp, { recursive: true, force: true });
