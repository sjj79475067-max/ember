"use client";
import { useMemo } from "react";
import { ReactFlow, Background, Controls, MarkerType, type Node, type Edge, Handle, Position, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { KIND_LABEL } from "@/lib/labels";

export type GraphItem = { id: string; title: string; status: string; kind: string; milestone: string | null; mustMeet: boolean; overdue: boolean; external?: boolean };
export type GraphDep = { blockerId: string; blockedId: string; violated: boolean };

const W = 220, H = 64;

function layout(items: GraphItem[], deps: GraphDep[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 18, ranksep: 56, marginx: 12, marginy: 12 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const it of items) g.setNode(it.id, { width: W, height: H });
  for (const d of deps) if (g.hasNode(d.blockerId) && g.hasNode(d.blockedId)) g.setEdge(d.blockerId, d.blockedId);
  dagre.layout(g);
  return items.map((it) => {
    const n = g.node(it.id);
    return { id: it.id, x: (n?.x ?? 0) - W / 2, y: (n?.y ?? 0) - H / 2 };
  });
}

function ItemNode({ data }: NodeProps<Node<GraphItem & { waiting: boolean }>>) {
  const d = data;
  const tone = d.status === "done" ? "border-[var(--color-ok)] bg-[var(--color-ok)]/10"
    : d.status === "blocked" || d.overdue ? "border-[var(--color-danger)] bg-[var(--color-danger)]/10"
    : d.waiting ? "border-[var(--color-warn)] bg-[var(--color-warn)]/10"
    : d.status === "doing" ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]"
    : "border-[var(--color-line)] bg-[var(--color-card)]";
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 shadow-sm ${tone} ${d.external ? "border-dashed" : ""}`} style={{ width: W, height: H }}>
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-[var(--color-muted)]" />
      <p className="line-clamp-2 text-[12px] font-medium leading-4">{d.mustMeet && "★ "}{d.title}</p>
      <p className="mt-0.5 truncate text-[10px] text-[var(--color-muted)]">
        {KIND_LABEL[d.kind] ?? d.kind}{d.milestone ? ` · ${d.milestone}` : ""} · {d.status === "done" ? "完成" : d.status === "doing" ? "进行中" : d.status === "blocked" ? "阻塞" : d.waiting ? "等前置" : "待办"}{d.external ? " · 其他项目" : ""}
      </p>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-[var(--color-muted)]" />
    </div>
  );
}

const nodeTypes = { item: ItemNode };

/** 依赖图：从左到右是先后顺序；红线 = 排期冲突，橙色节点 = 还在等前置，★ = 阶段必过项 */
export default function DepGraph({ items, deps, height = 520 }: { items: GraphItem[]; deps: GraphDep[]; height?: number }) {
  const { nodes, edges } = useMemo(() => {
    const status = new Map(items.map((i) => [i.id, i.status]));
    const waiting = new Set(deps.filter((d) => !["done", "dropped"].includes(status.get(d.blockerId) ?? "")).map((d) => d.blockedId));
    const pos = layout(items, deps);
    const nodes: Node[] = items.map((it) => {
      const p = pos.find((x) => x.id === it.id)!;
      return { id: it.id, type: "item", position: { x: p.x, y: p.y }, data: { ...it, waiting: waiting.has(it.id) }, draggable: true };
    });
    const edges: Edge[] = deps.map((d) => {
      const doneBlocker = status.get(d.blockerId) === "done";
      const color = d.violated ? "var(--color-danger)" : doneBlocker ? "var(--color-ok)" : "var(--color-muted)";
      return {
        id: `${d.blockerId}->${d.blockedId}`, source: d.blockerId, target: d.blockedId, animated: !doneBlocker && !d.violated,
        style: { stroke: color, strokeWidth: d.violated ? 2 : 1.2 }, markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      };
    });
    return { nodes, edges };
  }, [items, deps]);

  if (!items.length) return <p className="py-10 text-center text-sm text-[var(--color-muted)]">还没有依赖关系。在事项上设置「前置事项」，或套用模板自动生成备案链。</p>;
  return (
    <div style={{ height }} className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.3} proOptions={{ hideAttribution: true }} nodesConnectable={false}>
        <Background gap={16} size={1} color="var(--color-line)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}