"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Plus, Trash2, Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { toast } from "sonner";

type Row = { title: string; detail_md?: string; done_definition?: string; done?: boolean; priority?: string; due_at?: number | null };

export function MeetingItemsClient({ meetingId, initial }: { meetingId: string; initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkId, setLinkId] = useState("");
  const [editing, setEditing] = useState(false);

  async function post(action: string, extra: Record<string, unknown> = {}) {
    const r = await fetch(`/api/ui/meetings/${meetingId}/items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) }).then((x) => x.json());
    if (!r.ok) { toast.error(r.error ?? "失败"); return null; }
    return r;
  }

  async function draft() {
    setBusy("draft");
    const r = await post("preview");
    setBusy(null);
    if (!r) return;
    setRows(r.items ?? []);
    setEditing(true);
    toast.success(r.fromSnapshot ? "已载入之前保存的清单" : "已按会议内容整理出草稿，请逐条确认");
  }

  async function saveTasks() {
    const todo = rows.filter((x) => x.title.trim() && !x.done);
    if (!todo.length) return toast.error("没有待办条目");
    setBusy("save");
    const r = await post("save", { items: rows });
    setBusy(null);
    if (!r) return;
    toast.success(r.created ? `已生成 ${r.created} 条任务` : "已有相同任务，未重复生成");
    setRows([]);
    router.refresh();
  }

  async function saveSnapshot() {
    setBusy("snap");
    const r = await post("snapshot", { items: rows.filter((x) => x.title.trim()) });
    setBusy(null);
    if (r) toast.success("清单已保存到这条会议（未生成任务）");
  }

  async function link() {
    if (!linkId.trim()) return toast.error("请填写任务 id");
    setBusy("link");
    const r = await fetch(`/api/ui/meetings/${meetingId}/link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item_id: linkId.trim() }) }).then((x) => x.json());
    setBusy(null);
    if (!r.ok) return toast.error(r.error ?? "失败");
    toast.success("已关联"); setLinkId(""); router.refresh();
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-muted)]">清单</h2>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={draft} disabled={busy !== null}>{busy === "draft" ? "整理中…" : <><Sparkles /> {rows.length ? "重新整理" : "整理清单"}</>}</Button>
        </div>
      </div>

      {rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--color-line)] p-4 text-[12px] leading-5 text-[var(--color-muted)]">
          这条会议只归档、不自动生成任务。需要清单时点「整理清单」按会议内容抽一版草稿，自己改完再「生成任务」；或者让 agent 读这条会议后帮你整理（agent 会用 <code>meeting_draft_items</code> 拿草稿再核对落库）。
        </p>
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex flex-col gap-2">
              {rows.map((r, i) => (
                <div key={i} className="rounded-lg border border-[var(--color-line)] p-2.5">
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={!!r.done} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, done: e.target.checked } : x))} title="已办事项（生成后归档为已完成）" className="mt-1.5" />
                    <div className="grid min-w-0 flex-1 gap-1.5">
                      <Input value={r.title} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder="做什么" className="h-8 text-[13px]" />
                      <Input value={r.done_definition ?? ""} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, done_definition: e.target.value } : x))} placeholder="怎样算完成（可留空，之后补）" className="h-7 text-[12px]" />
                      {editing && r.done && <Textarea rows={2} value={r.detail_md ?? ""} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, detail_md: e.target.value } : x))} placeholder="已办结论（作为完成证据）" className="text-[12px]" />}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {r.done ? <Badge tone="ok">已办</Badge> : <Badge>{r.priority ?? "P1"}</Badge>}
                      <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-line)]/50" title="删除这条"><Trash2 className="size-3.5" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setRows([...rows, { title: "", done: false }])} className="mt-2 inline-flex items-center gap-1 text-[12px] text-[var(--color-brand)]"><Plus className="size-3.5" /> 加一条</button>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRows([])}>清空</Button>
              <Button variant="outline" size="sm" onClick={saveSnapshot} disabled={busy !== null}><Check /> 只保存清单</Button>
              <Button size="sm" onClick={saveTasks} disabled={busy !== null}><Check /> 生成任务</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-3 rounded-xl border border-[var(--color-line)] p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium"><Link2 className="size-3.5" /> 关联已有任务</p>
        <div className="flex gap-2">
          <Input value={linkId} onChange={(e) => setLinkId(e.target.value)} placeholder="粘贴任务 id（任务详情里可见）" className="h-8 font-mono text-[12px]" />
          <Button size="sm" variant="outline" onClick={link} disabled={busy !== null}>关联</Button>
        </div>
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">如果这件事本来就有任务条目，关联过来即可，不要重复新建。</p>
      </div>
      
    </div>
  );
}