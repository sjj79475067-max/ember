import { db, s } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { newId, nowSec } from "@/lib/id";

export function hasOwner() {
  return !!db.select({ id: s.users.id }).from(s.users).get();
}

export function createOwner(email: string, name: string, password: string) {
  if (hasOwner()) throw Object.assign(new Error("系统已初始化"), { status: 409 });
  const id = newId("usr");
  db.insert(s.users).values({ id, email: email.toLowerCase(), name, passwordHash: hashPassword(password), role: "owner", createdAt: nowSec(), updatedAt: nowSec() }).run();
  return { id, email, name };
}

export function seedDefaults() {
  // 全局条例模板（默认不用；由用户创建）
  const exist = db.select().from(s.projects).get();
  if (exist) return;
}
