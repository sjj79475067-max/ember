import { headers } from "next/headers";
import { listAssets } from "@/lib/services/assets";
import { listPurchases } from "@/lib/services/purchases";
import { listDeals, listContacts } from "@/lib/services/crm";
import { listTrips } from "@/lib/services/trips";
import { agenda, listFeeds } from "@/lib/services/calendar";
import { listProjects } from "@/lib/services/projects";
import { AffairsClient } from "./affairs-client";

export const dynamic = "force-dynamic";

export default async function AffairsPage({ searchParams }: { searchParams: Promise<{ tab?: string; m?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const [y, m] = (sp.m ?? `${now.getFullYear()}-${now.getMonth() + 1}`).split("-").map(Number);
  const from = Math.floor(new Date(y, m - 1, 1).getTime() / 1000) - 7 * 86400;
  const to = Math.floor(new Date(y, m, 1).getTime() / 1000) + 14 * 86400;
  const h = await headers();
  const base = process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const data = {
    assets: listAssets(), purchases: listPurchases({}), deals: listDeals({}), contacts: listContacts(), trips: listTrips({}),
    events: agenda(from, to), feeds: listFeeds(), month: { y, m }, base,
    projects: listProjects({}).map((p) => ({ id: p.id, key: p.key, name: p.name })),
  };
  return <AffairsClient data={JSON.parse(JSON.stringify(data))} initialTab={sp.tab} />;
}
