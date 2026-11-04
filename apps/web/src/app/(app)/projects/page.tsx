import { listProjects } from "@/lib/services/projects";
import { ProjectsClient } from "./projects-client";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const projects = listProjects({ includeArchived: true });
  const sp = await searchParams;
  return <ProjectsClient initial={JSON.parse(JSON.stringify(projects))} openNew={sp.new === "1"} />;
}
