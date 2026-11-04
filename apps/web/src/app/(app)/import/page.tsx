import { listProjects } from "@/lib/services/projects";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const projects = listProjects({}).map((p) => ({ id: p.id, key: p.key, name: p.name }));
  const sp = await searchParams;
  return <ImportClient projects={projects} initialProject={sp.project} />;
}
