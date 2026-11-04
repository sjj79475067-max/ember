import { listFiles } from "@/lib/services/files";
import { listProjects } from "@/lib/services/projects";
import { FilesClient } from "./files-client";

export const dynamic = "force-dynamic";

export default async function FilesPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const files = listFiles({});
  const projects = listProjects({}).map((p) => ({ id: p.id, name: p.name, key: p.key }));
  const sp = await searchParams;
  return <FilesClient initial={JSON.parse(JSON.stringify(files))} projects={projects} focus={sp.focus} />;
}
