import Link from "next/link";
import { listMeetings } from "@/lib/services/meetings";
import { db, s } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/utils";
import { Upload } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const meetings = listMeetings(undefined, 100);
  const projects = db.select().from(s.projects).all();
  const pname = (id: string) => projects.find((p) => p.id === id)?.name ?? "—";
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">会议档案</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">所有来源的会议记录，统一归档、统一抽取事务。</p>
        </div>
        <Link href="/import" className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3.5 py-2 text-sm font-medium text-white hover:brightness-110"><Upload className="size-4" /> 导入</Link>
      </header>
      <div className="flex flex-col gap-2.5">
        {meetings.length === 0 && <div className="rounded-xl border border-dashed border-[var(--color-line)] p-10 text-center text-sm text-[var(--color-muted)]">还没有会议档案。<Link href="/import" className="text-[var(--color-brand)] hover:underline">导入第一份</Link></div>}
        {meetings.map((m) => (
          <Link key={m.id} href={`/meetings/${m.id}`}>
            <Card className="transition-shadow hover:shadow-md"><CardContent className="flex items-start gap-4 p-4">
              <div className="w-14 shrink-0 text-center">
                <p className="text-lg font-semibold tabular-nums">{new Date(m.heldAt * 1000).getDate()}</p>
                <p className="text-[10px] text-[var(--color-muted)]">{new Date(m.heldAt * 1000).getMonth() + 1} 月</p>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{m.title}</p>
                  <Badge>{m.source}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-[var(--color-muted)]">{m.summaryMd || m.minutesMd.slice(0, 120)}</p>
                <p className="mt-1 text-[11px] text-[var(--color-muted)]">{pname(m.projectId)} · {fmtDate(m.heldAt, true)}</p>
              </div>
            </CardContent></Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
