import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import fs from "node:fs";
import path from "node:path";

const globalForDb = globalThis as unknown as { __emberDb?: ReturnType<typeof create> };

function create() {
  const raw = (process.env.DATABASE_URL ?? "file:./data/ember.db").replace(/^file:/, "");
  const file = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

const g = (globalForDb.__emberDb ??= create());
export const sqlite = g.sqlite;
export const db = g.db;
export * as s from "./schema";
