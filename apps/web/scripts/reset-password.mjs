#!/usr/bin/env node
/**
 * 重置管理员密码（忘记密码时的应急入口）。
 * 本机模式：node scripts/reset-password.mjs <新密码> [邮箱]
 * 容器模式：docker compose exec web node apps/web/scripts/reset-password.mjs <新密码> [邮箱]
 */
import { createRequire } from "node:module";
import { scryptSync, randomBytes } from "node:crypto";
import path from "node:path";

const appDir = process.env.APP_DIR ?? process.cwd();
const require = createRequire(path.join(appDir, "package.json"));
const Database = require("better-sqlite3");

const [, , password, emailArg] = process.argv;
if (!password || password.length < 8) {
  console.error("用法：node scripts/reset-password.mjs <新密码(至少8位)> [邮箱]");
  process.exit(1);
}
const file = (process.env.DATABASE_URL ?? "file:" + path.join(appDir, "data/ember.db")).replace(/^file:/, "");
const db = new Database(file);
const users = db.prepare("select id, email, role from users").all();
if (!users.length) {
  console.error("库里还没有任何账号——直接打开网页，首次进入会创建管理员。");
  process.exit(1);
}
const target = emailArg ? users.find((u) => u.email.toLowerCase() === emailArg.toLowerCase()) : users.find((u) => u.role === "owner") ?? users[0];
if (!target) {
  console.error(`找不到账号 ${emailArg}。现有账号：${users.map((u) => u.email).join(", ")}`);
  process.exit(1);
}
const salt = randomBytes(16).toString("hex");
const hash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
db.prepare('update users set "passwordHash" = ?, "updatedAt" = ? where id = ?').run(hash, Math.floor(Date.now() / 1000), target.id);
// 让旧会话全部失效
try { db.prepare("delete from sessions where userId = ?").run(target.id); } catch {}
console.log(`已重置 ${target.email} 的密码，并注销其所有已登录会话。`);
