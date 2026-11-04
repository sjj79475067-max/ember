import Link from "next/link";
import { notFound } from "next/navigation";
import { getMeeting } from "@/lib/services/meetings";
import { db, s } from "@/lib/db";
import { eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDate, STATUS_LABEL } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = getMeeting(id);
  if (!m) notFound();
  const project = db.select().from(s.projects).where(eq(s.projects.id, m.projectId)).get();
  const attachments: Array<{ name: string; url?: string; path?: string; kind?: string }> = JSON.parse(m.attachments || "[]");
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <div className="mb-1 flex items-center gap-2 text-xs text-[var(--color-muted)]">
        <Link href="/meetings" className="hover:underline">会议档案</Link><span>/</span>
        {project && <Link href={`/p/${project.id}`} className="hover:underline">{project.name}</Link>}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge>{m.source}</Badge>
        <Badge>{fmtDate(m.heldAt, true)}</Badge>
        {m.participants && <Badge>参与：{m.participants}</Badge>}
      </div>

      {m.summaryMd && (
        <Card className="mt-5 border-[var(--color-brand)]/25 bg-[var(--color-brand-soft)]/40">
          <CardContent className="p-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-brand)]">摘要</p>
            <p className="whitespace-pre-wrap text-[13.5px] leading-7">{m.summaryMd}</p>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <h2 className="mb-2 text-sm font-semibold text-[var(--color-muted)]">原文</h2>
          <div className="whitespace-pre-wrap rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-4 text-[13px] leading-7">{m.minutesMd}</div>
          {attachments.length > 0 && (
            <>
              <h2 className="mb-2 mt-5 text-sm font-semibold text-[var(--color-muted)]">附件</h2>
              <div className="flex flex-wrap gap-2">
                {attachments.map((a, i) => (
                  <a key={i} href={a.url || "#"} target="_blank" rel="noreferrer" className="rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-xs hover:bg-[var(--color-brand-soft)]">{a.name}</a>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-[var(--color-muted)]">衍生事务（{m.items.length}）</h2>
          <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]">
            {m.items.length === 0 && <p className="p-4 text-sm text-[var(--color-muted)]">未生成任务。</p>}
            {m.items.map((it) => (
              <div key={it.id} className="border-b border-[var(--color-line)] p-3 last:border-0">
                <p className={`text-[13px] ${it.status === "done" ? "text-[var(--color-muted)] line-through" : ""}`}>{it.title}</p>
                <div className="mt-1 flex gap-1.5">
                  <Badge tone={it.status === "done" ? "ok" : it.status === "blocked" ? "danger" : it.status === "changed" ? "warn" : "default"}>{STATUS_LABEL[it.status]}</Badge>
                  {it.dueAt && <Badge>{fmtDate(it.dueAt)}</Badge>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
