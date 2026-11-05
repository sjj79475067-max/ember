import { db, s } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { newId, nowSec } from "@/lib/id";
import type { Actor } from "@/lib/audit";
import { audit } from "@/lib/audit";
import { rejectSecrets, toCents, toYuan, daysUntil } from "./affairs-common";

export const ASSET_KINDS = ["credential", "account", "domain", "cert", "contract", "subscription", "device"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** 过期后的真实后果：让提醒说清楚「不续会怎样」 */
export const EXPIRY_CONSEQUENCE: Record<string, string> = {
  domain: "域名过期后网站和邮箱立即不可用；.cn 通常有约 30 天宽限期可原价续费，之后进入赎回期（费用高），再之后被删除可能被抢注。",
  cert: "证书过期后浏览器会拦截访问、小程序/App 接口请求失败。",
  credential: "资质过期或被注销会导致下架、无法上线或被通报，需重新办理（周期以月计）。",
  account: "开发者账号/商户号过期会导致应用下架、无法收款或无法发版。",
  contract: "合同到期后权利义务终止，续约、续费或结项请提前确认。",
  subscription: "订阅到期后服务停止，数据可能在宽限期后删除。",
  device: "保修到期后维修需自费。",
};

export type AssetInput = {
  id?: string; kind?: string; name?: string; identifier?: string; authority?: string; owner?: string; projectId?: string | null;
  validFrom?: number | null; validUntil?: number | null; renewRule?: string; remindDays?: string; status?: string;
  sourceItemId?: string; secretRef?: string; notesMd?: string; costYuan?: number | null;
};

export function assetView(a: typeof s.assets.$inferSelect) {
  const d = daysUntil(a.validUntil);
  const remind = a.remindDays.split(",").map((x) => Number(x.trim())).filter((x) => x > 0);
  const maxRemind = remind.length ? Math.max(...remind) : 30;
  const state = a.status === "revoked" ? "revoked" : d == null ? "active" : d < 0 ? "expired" : d <= maxRemind ? "expiring" : "active";
  return { ...a, cost: toYuan(a.cost), daysLeft: d, state, consequence: EXPIRY_CONSEQUENCE[a.kind] ?? "" };
}

export function listAssets(opts: { kind?: string; projectId?: string; state?: string } = {}) {
  let rows = db.select().from(s.assets).orderBy(asc(s.assets.validUntil)).all().map(assetView);
  if (opts.kind) rows = rows.filter((r) => r.kind === opts.kind);
  if (opts.projectId) rows = rows.filter((r) => r.projectId === opts.projectId);
  if (opts.state) rows = rows.filter((r) => r.state === opts.state);
  // 有到期日的排前面（按剩余天数），长期有效的排后面
  return rows.sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
}

export function saveAsset(input: AssetInput, actor: Actor) {
  rejectSecrets({ name: input.name, identifier: input.identifier, notes: input.notesMd, renew_rule: input.renewRule, owner: input.owner });
  if (input.kind && !(ASSET_KINDS as readonly string[]).includes(input.kind)) throw Object.assign(new Error(`类型只能是：${ASSET_KINDS.join(", ")}`), { status: 422 });
  if (input.remindDays && !/^\s*\d+(\s*,\s*\d+)*\s*$/.test(input.remindDays)) throw Object.assign(new Error("提醒天数写成逗号分隔的数字，如 30,14,7"), { status: 422 });
  const at = nowSec();
  if (input.id) {
    const cur = db.select().from(s.assets).where(eq(s.assets.id, input.id)).get();
    if (!cur) throw Object.assign(new Error("台账不存在"), { status: 404 });
    const set: Record<string, unknown> = { updatedAt: at };
    const map: Array<[keyof AssetInput, string]> = [["kind", "kind"], ["name", "name"], ["identifier", "identifier"], ["authority", "authority"], ["owner", "owner"], ["projectId", "projectId"], ["validFrom", "validFrom"], ["validUntil", "validUntil"], ["renewRule", "renewRule"], ["remindDays", "remindDays"], ["status", "status"], ["secretRef", "secretRef"], ["notesMd", "notesMd"]];
    for (const [k, col] of map) if (input[k] !== undefined) set[col] = input[k];
    if (input.costYuan !== undefined) set.cost = toCents(input.costYuan);
    db.update(s.assets).set(set).where(eq(s.assets.id, input.id)).run();
    audit(actor, "asset.update", "asset", input.id, { ...input });
    return assetView(db.select().from(s.assets).where(eq(s.assets.id, input.id)).get()!);
  }
  if (!input.name?.trim()) throw Object.assign(new Error("台账名称不能为空"), { status: 422 });
  // 同类型同编号视为同一个东西，避免重复登记
  if (input.identifier?.trim()) {
    const dup = db.select().from(s.assets).all().find((a) => a.kind === (input.kind ?? "account") && a.identifier === input.identifier!.trim());
    if (dup) throw Object.assign(new Error(`已登记过「${dup.name}」（${dup.identifier}），请传 id 更新`), { status: 409, existing: dup });
  }
  const id = newId("ast");
  db.insert(s.assets).values({
    id, kind: input.kind ?? "account", name: input.name.trim().slice(0, 120), identifier: (input.identifier ?? "").trim(),
    authority: input.authority ?? "", owner: input.owner ?? "", projectId: input.projectId ?? null,
    validFrom: input.validFrom ?? null, validUntil: input.validUntil ?? null, renewRule: input.renewRule ?? "",
    remindDays: input.remindDays ?? "30,14,7", status: input.status ?? "active", sourceItemId: input.sourceItemId ?? "",
    secretRef: input.secretRef ?? "", notesMd: input.notesMd ?? "", cost: toCents(input.costYuan), createdAt: at, updatedAt: at,
  }).run();
  audit(actor, "asset.create", "asset", id, { name: input.name, kind: input.kind });
  return assetView(db.select().from(s.assets).where(eq(s.assets.id, id)).get()!);
}

/** 资质/账号类事项办完后登记到台账：带上项目、来源与证据里的编号 */
export function assetFromItem(itemId: string, extra: AssetInput, actor: Actor) {
  const it = db.select().from(s.items).where(eq(s.items.id, itemId)).get();
  if (!it) throw Object.assign(new Error("事项不存在"), { status: 404 });
  const kind = extra.kind ?? (it.kind === "compliance" ? "credential" : it.kind === "contract" ? "contract" : "account");
  return saveAsset({
    kind, name: extra.name ?? it.title.replace(/^(办理|申请|开通|购买|注册)/, ""), projectId: it.projectId, sourceItemId: it.id,
    notesMd: extra.notesMd ?? (it.evidence ? `办理证据：${it.evidence}` : ""), ...extra,
  }, actor);
}