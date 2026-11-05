import { db, s } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { Actor } from "@/lib/audit";
import { addItems, type ItemInput } from "./items";
import { companyProjectId } from "./affairs-common";

/** 给采购 / 合作 / 行程 / 台账挂待办事项：项目取对象的项目，没有就放「公司日常」 */
export function addOwnedItems(ownerType: "purchase" | "deal" | "trip" | "asset", ownerId: string, list: ItemInput[], actor: Actor) {
  const table = { purchase: s.purchases, deal: s.deals, trip: s.trips, asset: s.assets }[ownerType];
  const row = db.select().from(table).where(eq(table.id, ownerId)).get() as { projectId?: string | null } | undefined;
  if (!row) throw Object.assign(new Error("对象不存在"), { status: 404 });
  const pid = row.projectId ?? companyProjectId();
  const kind = { purchase: "purchase", deal: "doc", trip: "task", asset: "account" }[ownerType];
  return addItems(pid, list.map((x) => ({ kind, ...x, ownerType, ownerId, sourceRef: `${ownerType}:${ownerId}` })), actor);
}
