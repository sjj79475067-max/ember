"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, FolderKanban, CalendarCheck, Files, Bell, Settings, Plug, Search, LogOut, ScrollText, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";

const NAV = [
  { href: "/", label: "总览", icon: LayoutDashboard },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/meetings", label: "会议档案", icon: CalendarCheck },
  { href: "/files", label: "资料位置", icon: Files },
  { href: "/inbox", label: "提醒", icon: Bell },
  { href: "/policies", label: "条例", icon: ScrollText },
  { href: "/notes", label: "知识库", icon: BookOpen },
];

const NAV2 = [
  { href: "/connect", label: "接入 Agent", icon: Plug },
  { href: "/settings", label: "设置", icon: Settings },
];

export function Sidebar({ user, unread }: { user: { name: string; email: string }; unread: number }) {
  const path = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <>
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-card)]/60 px-3 py-4">
        <Link href="/" className="mb-4 flex items-center gap-2 px-2">
          <span className="grid size-8 place-items-center rounded-lg bg-[var(--color-brand)] text-sm font-bold text-white">淬</span>
          <span className="font-semibold tracking-tight">Ember</span>
        </Link>
        <button
          onClick={() => setPaletteOpen(true)}
          className="mb-4 flex h-8 items-center gap-2 rounded-lg border border-[var(--color-line)] px-2.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-brand-soft)]/50"
        >
          <Search className="size-3.5" /> 搜索… <kbd className="ml-auto rounded border border-[var(--color-line)] px-1 text-[10px]">⌘K</kbd>
        </button>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={cn("flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors", active ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]" : "text-[var(--color-fg)]/80 hover:bg-[var(--color-line)]/40")}>
                <n.icon className="size-4" /> {n.label}
                {n.href === "/inbox" && unread > 0 && <span className="ml-auto rounded-full bg-[var(--color-danger)] px-1.5 text-[10px] font-semibold leading-4 text-white">{unread}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="my-3 h-px bg-[var(--color-line)]" />
        <nav className="flex flex-col gap-0.5">
          {NAV2.map((n) => {
            const active = path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={cn("flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors", active ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]" : "text-[var(--color-fg)]/80 hover:bg-[var(--color-line)]/40")}>
                <n.icon className="size-4" /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-2 rounded-lg px-1.5 py-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-brand-soft)] text-xs font-semibold text-[var(--color-brand)]">{user.name.slice(0, 2)}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{user.name}</p>
            <p className="truncate text-[11px] text-[var(--color-muted)]">{user.email}</p>
          </div>
          <ThemeToggle />
          <button onClick={logout} className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-line)]/50" title="退出登录"><LogOut className="size-4" /></button>
        </div>
      </aside>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
