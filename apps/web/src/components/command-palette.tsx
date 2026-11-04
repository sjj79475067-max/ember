"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { FileText, FolderKanban, Search, Plus, Upload, Plug } from "lucide-react";

type Hit = { type: string; id: string; title: string; snippet: string; url: string };

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); onOpenChange(true); }
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || q.trim().length < 1) { setHits([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}&limit=30`).catch(() => null);
      if (res?.ok) setHits((await res.json()).data?.hits ?? []);
    }, 160);
    return () => clearTimeout(t);
  }, [q, open]);

  function go(url: string) { onOpenChange(false); router.push(url); }

  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="命令面板" shouldFilter={false}
      className="fixed left-1/2 top-[18%] z-50 w-[min(640px,92vw)] -translate-x-1/2 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4">
        <Search className="size-4 text-[var(--color-muted)]" />
        <Command.Input value={q} onValueChange={setQ} placeholder="搜索项目、任务、会议、笔记… 或输入动作"
          className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-[var(--color-muted)]" autoFocus />
        <kbd className="rounded border border-[var(--color-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]">ESC</kbd>
      </div>
      <Command.List className="max-h-[420px] overflow-y-auto p-2">
        <Command.Empty className="py-8 text-center text-sm text-[var(--color-muted)]">没有结果</Command.Empty>
        <Command.Group heading="动作" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-[var(--color-muted)]">
          <Item onSelect={() => go("/projects?new=1")} icon={<Plus className="size-4" />} label="新建项目" />
          <Item onSelect={() => go("/import")} icon={<Upload className="size-4" />} label="导入会议记录 / 历史资料" />
          <Item onSelect={() => go("/connect")} icon={<Plug className="size-4" />} label="接入新 Agent" />
        </Command.Group>
        {hits.length > 0 && (
          <Command.Group heading="结果" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-[var(--color-muted)]">
            {hits.map((h) => (
              <Item key={h.type + h.id} onSelect={() => go(h.url)} icon={h.type === "project" ? <FolderKanban className="size-4" /> : <FileText className="size-4" />}
                label={h.title} sub={`${labelOf(h.type)} · ${h.snippet}`} />
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

function Item({ onSelect, icon, label, sub }: { onSelect: () => void; icon: React.ReactNode; label: string; sub?: string }) {
  return (
    <Command.Item onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm data-[selected=true]:bg-[var(--color-brand-soft)]">
      <span className="text-[var(--color-muted)]">{icon}</span>
      <span className="truncate">{label}</span>
      {sub && <span className="ml-auto truncate text-[11px] text-[var(--color-muted)] max-w-[40%]">{sub}</span>}
    </Command.Item>
  );
}

function labelOf(t: string) {
  return ({ item: "任务", meeting: "会议", note: "笔记", decision: "决定", file: "资料", project: "项目" } as Record<string, string>)[t] ?? t;
}
