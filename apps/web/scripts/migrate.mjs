import fs from "node:fs";
import path from "node:path";

const { createRequire } = await import("node:module");
const appDir = process.env.APP_DIR ?? process.cwd();
const Database = createRequire(appDir + "/package.json")("better-sqlite3");

const file = (process.env.DATABASE_URL ?? "file:" + path.join(appDir, "data/ember.db")).replace(/^file:/, "");
fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
const db = new Database(file);
db.pragma("journal_mode = WAL");
const dir = path.resolve(process.env.MIGRATIONS_DIR ?? path.join(appDir, "drizzle"));
db.exec("create table if not exists __migrations (tag text primary key, applied_at integer)");
const tags = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
let applied = 0;
for (const tag of tags) {
  if (db.prepare("select 1 from __migrations where tag=?").get(tag)) continue;
  const sqlText = fs.readFileSync(path.join(dir, tag), "utf8");
  db.exec("BEGIN");
  try {
    for (const chunk of sqlText.split("--> statement-breakpoint")) {
      const s = chunk.trim();
      if (s) db.exec(s);
    }
    db.prepare("insert into __migrations (tag, applied_at) values (?, ?)").run(tag, Math.floor(Date.now() / 1000));
    db.exec("COMMIT");
    applied++;
    console.log("applied", tag);
  } catch (e) {
    db.exec("ROLLBACK");
    console.error("failed", tag, e.message);
    process.exit(1);
  }
}
console.log(`migrations ok (${tags.length} total, ${applied} new)`);
