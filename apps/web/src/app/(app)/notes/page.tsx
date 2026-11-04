import { listNotes } from "@/lib/services/notes";
import { listProjects } from "@/lib/services/projects";
import { NotesClient } from "./notes-client";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const notes = listNotes({ limit: 200 });
  const projects = listProjects({}).map((p) => ({ id: p.id, name: p.name, key: p.key }));
  return <NotesClient initial={JSON.parse(JSON.stringify(notes))} projects={projects} />;
}
