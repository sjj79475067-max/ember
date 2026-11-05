import { notFound } from "next/navigation";
import { projectDetail } from "@/lib/services/progress";
import { listProjects } from "@/lib/services/projects";
import { ProjectClient } from "./project-client";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = projectDetail(id);
  if (!d) notFound();
  const projects = listProjects({ includeArchived: false }).map((p) => ({ id: p.id, key: p.key, name: p.name }));
  return <ProjectClient data={JSON.parse(JSON.stringify(d))} projects={projects} />;
}