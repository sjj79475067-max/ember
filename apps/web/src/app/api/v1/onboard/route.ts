import { NextRequest } from "next/server";
import { withAgent } from "@/lib/http/api";
import { toolsByName } from "@/lib/mcp/registry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAgent(req, async (c) => {
    const params = new URL(req.url).searchParams;
    const def = toolsByName.get("onboard")!;
    const out = await def.handler({ session_ref: params.get("session_ref") ?? undefined, machine: params.get("machine") ?? undefined }, c);
    return Response.json(out);
  });
}
