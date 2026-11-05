import { listPolicies } from "@/lib/services/policies";
import { listProjects } from "@/lib/services/projects";
import { PoliciesClient } from "./policies-client";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const policies = listPolicies();
  const projects = listProjects({}).map((p) => ({ id: p.id, name: p.name }));
  return <PoliciesClient initial={JSON.parse(JSON.stringify(policies))} projects={projects} />;
}