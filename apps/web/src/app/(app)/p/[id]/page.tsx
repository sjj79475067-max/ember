import { notFound } from "next/navigation";
import { projectDetail } from "@/lib/services/progress";
import { ProjectClient } from "./project-client";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = projectDetail(id);
  if (!d) notFound();
  return <ProjectClient data={JSON.parse(JSON.stringify(d))} />;
}
