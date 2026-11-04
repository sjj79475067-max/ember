import { db, s } from "@/lib/db";
import { newId, nowSec } from "@/lib/id";

export type Actor = { type: "user" | "agent" | "system"; name: string };

export function audit(actor: Actor, action: string, entity: string, entityId: string, diff: unknown = {}, extra?: { requestId?: string; ip?: string }) {
  db.insert(s.auditLog).values({
    id: newId("aud"),
    actorType: actor.type,
    actorName: actor.name,
    action,
    entity,
    entityId,
    diffJson: JSON.stringify(diff ?? {}),
    requestId: extra?.requestId ?? "",
    ip: extra?.ip ?? "",
    createdAt: nowSec(),
  }).run();
}
