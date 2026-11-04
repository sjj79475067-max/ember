import { NextRequest } from "next/server";
import { buildManifest } from "@/lib/agent/manifest";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const base = process.env.APP_URL || new URL(req.url).origin;
  return Response.json(buildManifest(base), {
    headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" },
  });
}
