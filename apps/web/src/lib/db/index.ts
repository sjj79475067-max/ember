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
  // 先设等待，再切 WAL：多个进程同时打开新库时（构建时的多个 worker）不会直接报 locked
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

const g = (globalForDb.__emberDb ??= create());
export const sqlite = g.sqlite;
export const db = g.db;
export * as s from "./schema";
