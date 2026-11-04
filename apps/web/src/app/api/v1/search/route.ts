import { NextRequest } from "next/server";
import { withAgent } from "@/lib/http/api";
import { search } from "@/lib/services/search";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAgent(req, async () => {
    const p = new URL(req.url).searchParams;
    const q = p.get("q") ?? "";
    if (!q.trim()) return Response.json({ ok: true, data: { hits: [] } });
    return Response.json({ ok: true, data: { hits: search(q, { types: p.get("types")?.split(",").filter(Boolean), limit: Number(p.get("limit") ?? 20) }) } });
  });
}
