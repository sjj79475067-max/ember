import { db, s } from "@/lib/db";
import { eq } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";

/** 金额：对外用「元」，库里存「分」，避免浮点误差 */
export const toCents = (yuan: number | null | undefined) => (yuan == null || Number.isNaN(Number(yuan)) ? null : Math.round(Number(yuan) * 100));
export const toYuan = (cents: number | null | undefined) => (cents == null ? null : cents / 100);

/** 中心不存密码：发现疑似密码直接拒收，提示改写保存位置 */
const SECRET = /(密码|口令|password|passwd|pwd|secret|私钥|private[_ ]?key|api[_ ]?key)\s*[:：=是为]\s*\S{4,}/i;
const KEYLIKE = /\b(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
export function rejectSecrets(fields: Record<string, unknown>) {
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v !== "string" || !v) continue;
    if (SECRET.test(v) || KEYLIKE.test(v)) {
      throw Object.assign(new Error(`「${k}」里像是有密码或密钥。中心不保存密码：请删掉，并在 secret_ref 写保存位置（例如「1Password：苹果开发者账号」）。`), { status: 422 });
    }
  }
}

/** 没有指定项目的公司事务（采购、合作、行程里的待办）放进「公司日常」项目；可在设置里改 */
export function companyProjectId() {
  const set = db.select().from(s.settings).where(eq(s.settings.key, "company_project_id")).get();
  if (set?.value) {
    const p = db.select().from(s.projects).where(eq(s.projects.id, set.value)).get();
    if (p) return p.id;
  }
  const exist = db.select().from(s.projects).where(eq(s.projects.key, "COMPANY")).get();
  const id = exist?.id ?? newId("prj");
  if (!exist) {
    const t = nowSec();
    db.insert(s.projects).values({
      id, key: "COMPANY", name: "公司日常", kind: "admin", status: "active",
      summaryMd: "没有归属具体项目的公司事务：采购、合作准备、行程、报税年报等固定节点。",
      createdAt: t, updatedAt: t,
    }).run();
  }
  db.insert(s.settings).values({ key: "company_project_id", value: id, updatedAt: nowSec() })
    .onConflictDoUpdate({ target: s.settings.key, set: { value: id, updatedAt: nowSec() } }).run();
  return id;
}

/** 挂在事务对象下的事项（采购的比价/下单、合作的准备材料、行程的出行准备） */
export function ownedItems(ownerType: string, ownerId: string) {
  return db.select().from(s.items).where(eq(s.items.ownerId, ownerId)).all().filter((i) => i.ownerType === ownerType);
}

export const DAY = 86400;
export function daysUntil(ts: number | null | undefined, now = nowSec()) {
  return ts == null ? null : Math.ceil((ts - now) / DAY);
}