"use client";
import { useEffect, useState } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { Calendar, Link2 } from "lucide-react";
import { KIND_LABEL } from "@/lib/labels";
import { fmtDate } from "@/lib/utils";

export type KItem = { id: string; title: string; status: string; kind: string; priority: string; dueAt: number | null; claimedBy: string; version: number; mustMeet: number; waiting: boolean; needsReview: number };

const COLS = [
  { id: "todo", label: "待办" },
  { id: "doing", label: "进行中" },
  { id: "blocked", label: "阻塞" },
  { id: "changed", label: "已变更" },
  { id: "done", label: "已完成" },
] as const;

/** 状态看板：拖到「已完成」会要求填完成证据，拖到「阻塞」会要求写原因 —— 规则和 agent 一样 */
export default function Kanban({ items, onMove }: { items: KItem[]; onMove: (item: KItem, to: string) => Promise<boolean> }) {
  const [local, setLocal] = useState(items);
  useEffect(() => setLocal(items), [items]);
  const now = Date.now() / 1000;

  async function onDragEnd(r: DropResult) {
    if (!r.destination || r.destination.droppableId === r.source.droppableId) return;
    const it = local.find((x) => x.id === r.draggableId);
    if (!it) return;
    const to = r.destination.droppableId;
    const before = local;
    setLocal(local.map((x) => (x.id === it.id ? { ...x, status: to } : x)));
    const ok = await onMove(it, to);
    if (!ok) setLocal(before);
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLS.map((c) => {
          const list = local.filter((i) => i.status === c.id);
          return (
            <Droppable droppableId={c.id} key={c.id}>
              {(p, snap) => (
                <div ref={p.innerRef} {...p.droppableProps} className={`flex w-64 shrink-0 flex-col rounded-xl border p-2 transition-colors ${snap.isDraggingOver ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]/30" : "border-[var(--color-line)] bg-[var(--color-line)]/15"}`}>
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-[13px] font-semibold">{c.label}</span>
                    <span className="text-[11px] text-[var(--color-muted)]">{list.length}</span>
                  </div>
                  <div className="flex min-h-24 flex-col gap-2">
                    {list.map((it, idx) => (
                      <Draggable draggableId={it.id} index={idx} key={it.id}>
                        {(dp, ds) => (
                          <div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps}
                            className={`rounded-lg border bg-[var(--color-card)] p-2.5 text-[13px] shadow-sm ${ds.isDragging ? "rotate-1 shadow-lg" : ""} ${it.waiting && it.status !== "done" ? "border-[var(--color-warn)]/60" : "border-[var(--color-line)]"}`}>
                            <p className={it.status === "done" ? "text-[var(--color-muted)] line-through" : "font-medium"}>{it.mustMeet ? "★ " : ""}{it.title}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10.5px] text-[var(--color-muted)]">
                              <span className="rounded bg-[var(--color-line)]/60 px-1">{KIND_LABEL[it.kind] ?? it.kind}</span>
                              {it.priority === "P0" && <span className="rounded bg-[var(--color-danger)]/15 px-1 text-[var(--color-danger)]">P0</span>}
                              {it.dueAt && <span className={it.dueAt < now && it.status !== "done" ? "text-[var(--color-danger)]" : ""}><Calendar className="inline size-3" /> {fmtDate(it.dueAt)}</span>}
                              {it.waiting && it.status !== "done" && <span className="text-[var(--color-warn)]"><Link2 className="inline size-3" /> 等前置</span>}
                              {it.claimedBy && <span className="text-[var(--color-brand)]">认领中</span>}
                              {it.needsReview === 1 && <span className="text-[var(--color-danger)]">待核实</span>}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {p.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          );
        })}
      </div>
    </DragDropContext>
  );
}