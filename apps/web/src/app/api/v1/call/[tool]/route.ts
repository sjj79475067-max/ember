import { NextRequest } from "next/server";
import { withAgent } from "@/lib/http/api";
import { toolsByName } from "@/lib/mcp/registry";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest, ctx: { params: Promise<{ tool: string }> }) {
  const { tool } = await ctx.params;
  const def = toolsByName.get(tool);
  if (!def) {
    return Response.json({ ok: false, error: `未知工具：${tool}。可用：${[...toolsByName.keys()].join(", ")}` }, { status: 404 });
  }
  return withAgent(req, async (c) => {
    let input: unknown = {};
    if (req.method === "GET") input = Object.fromEntries(new URL(req.url).searchParams.entries());
    else {
      try { input = await req.json(); } catch { input = {}; }
    }
    const parsed = def.input.safeParse(coerce(input));
    if (!parsed.success) {
      return Response.json({ ok: false, error: "参数校验失败", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422 });
    }
    const out = await def.handler(parsed.data, c);
    return Response.json(out);
  }, { write: def.write });
}

function coerce(v: unknown) {
  if (typeof v !== "object" || v === null) return v;
  const o = { ...(v as Record<string, unknown>) };
  for (const [k, val] of Object.entries(o)) {
    if (typeof val === "string" && /^[\[{]/.test(val.trim())) {
      try { o[k] = JSON.parse(val); } catch {}
    }
  }
  return o;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
