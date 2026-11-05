import { notFound } from "next/navigation";
import { projectDetail } from "@/lib/services/progress";
import { listProjects } from "@/lib/services/projects";
import { projectBoard, listProjectUpdates } from "@/lib/services/board";
import { listRequirements } from "@/lib/services/requirements";
import { listMilestones } from "@/lib/services/milestones";
import { depsFor } from "@/lib/services/deps";
import { listTemplates } from "@/lib/services/templates";
import { db, s } from "@/lib/db";
import { inArray } from "drizzle-orm";
import { ProjectClient } from "./project-client";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = projectDetail(id);
  if (!d) notFound();
  const pid = d.project.id;
  const projects = listProjects({ includeArchived: false }).map((p) => ({ id: p.id, key: p.key, name: p.name }));
  const board = { ...projectBoard(pid), templates: listTemplates() };
  const allIds = [...d.items, ...d.parked].map((i) => i.id);
  const deps = depsFor(allIds);
  // 依赖另一端在别的项目时，也带上节点信息（虚线显示）
  const foreignIds = [...new Set(deps.flatMap((x) => [x.blockerId, x.blockedId]).filter((x) => !allIds.includes(x)))];
  const foreign = foreignIds.length ? db.select().from(s.items).where(inArray(s.items.id, foreignIds)).all() : [];
  const plan = {
    milestones: listMilestones(pid),
    requirements: listRequirements(pid),
    deps: deps.map((x) => ({ blockerId: x.blockerId, blockedId: x.blockedId, violated: x.violated })),
    foreign: foreign.map((i) => ({ id: i.id, title: i.title, status: i.status, kind: i.kind })),
    updates: listProjectUpdates(pid, 10),
  };
  return <ProjectClient data={JSON.parse(JSON.stringify(d))} projects={projects} board={JSON.parse(JSON.stringify(board))} plan={JSON.parse(JSON.stringify(plan))} initialTab={sp.tab} />;
}
