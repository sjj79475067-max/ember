"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { REM_KIND_LABEL } from "@/lib/utils";
import { toast } from "sonner";

type R = { id: string; title: string; bodyMd: string; kind: string; severity: string; status: string; projectId: string | null; createdAt: number };

export function InboxClient({ initial, projects }: { initial: R[]; projects: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const shown = filter === "open" ? rows.filter((r) => r.status === "open" || r.status === "snoozed") : rows;

  async function act(ids: string[], action: "ack" | "snooze" | "done") {
    const r = await fetch("/api/ui/reminders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, action }) }).then((x) => x.json());
    if (!r.ok) return toast.error(r.error ?? "失败");
    setRows((prev) => prev.map((x) => ids.includes(x.id) ? { ...x, status: action === "ack" ? "acked" : action === "snooze" ? "snoozed" : "done" } : x));
    router.refresh();
  }
  async function ackAll() {
    const ids = rows.filter((r) => r.status === "open").map((r) => r.id);
    if (ids.length) await act(ids, "ack");
    toast.success("已全部标记已读");
  }

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">提醒</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">到期、逾期、阻塞、条例与资料核验。Agent 每次连接会自动收到这些提醒。</p>
        </div>
        <Button variant="outline" size="sm" onClick={ackAll}><Check /> 全部已读</Button>
      </header>
      <div className="mb-3 flex gap-1 rounded-lg bg-[var(--color-line)]/40 p-0.5 text-xs w-fit">
        {([["open", "待处理"], ["all", "全部"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 ${filter === k ? "bg-[var(--color-card)] font-medium shadow-sm" : "text-[var(--color-muted)]"}`}>{l}</button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]">
        {shown.length === 0 && <p className="p-10 text-center text-sm text-[var(--color-muted)]">收件箱是空的，很好。</p>}
        {shown.map((r) => {
          const pn = projects.find((p) => p.id === r.projectId)?.name;
          const dim = r.status !== "open";
          return (
            <div key={r.id} className={`flex items-start gap-3 border-b border-[var(--color-line)] p-3.5 last:border-0 ${dim ? "opacity-55" : ""}`}>
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${r.severity === "P0" ? "bg-[var(--color-danger)]" : r.severity === "P1" ? "bg-[var(--color-warn)]" : "bg-[var(--color-muted)]"}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.title}</p>
                {r.bodyMd && <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">{r.bodyMd}</p>}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge>{REM_KIND_LABEL[r.kind] ?? r.kind}</Badge>
                  <Badge tone={r.severity === "P0" ? "danger" : r.severity === "P1" ? "warn" : "default"}>{r.severity}</Badge>
                  {pn && <Badge tone="brand">{pn}</Badge>}
                  {r.status !== "open" && <Badge>{r.status === "acked" ? "已读" : r.status === "snoozed" ? "已延后" : "已完成"}</Badge>}
                </div>
              </div>
              {r.status === "open" && (
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => act([r.id], "ack")} title="已读" className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-line)]/60"><Check className="size-4" /></button>
                  <button onClick={() => act([r.id], "snooze")} title="延后 24 小时" className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-line)]/60"><Clock className="size-4" /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
