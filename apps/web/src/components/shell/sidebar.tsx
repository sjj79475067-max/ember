"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, FolderKanban, CalendarCheck, Files, Bell, Settings, Plug, Search, LogOut, ScrollText, BookOpen, Newspaper, Layers, Briefcase, Sun, Target, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";

const NAV = [
  { href: "/today", label: "今日", icon: Sun },
  { href: "/capture", label: "随手记", icon: PenLine },
  { href: "/", label: "总览", icon: LayoutDashboard },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/affairs", label: "事务", icon: Briefcase },
  { href: "/meetings", label: "会议档案", icon: CalendarCheck },
  { href: "/review", label: "每周复盘", icon: Target },
  { href: "/brief", label: "简报", icon: Newspaper },
  { href: "/matrix", label: "智能体", icon: Layers },
  { href: "/files", label: "资料位置", icon: Files },
  { href: "/inbox", label: "提醒", icon: Bell },
  { href: "/policies", label: "条例", icon: ScrollText },
  { href: "/notes", label: "知识库", icon: BookOpen },
];

const NAV2 = [
  { href: "/connect", label: "接入 Agent", icon: Plug },
  { href: "/settings", label: "设置", icon: Settings },
];

export function Sidebar({ user, unread, captures = 0 }: { user: { name: string; email: string }; unread: number; captures?: number }) {
  const path = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <>
      <MobileNav path={path} unread={unread} captures={captures} onSearch={() => setPaletteOpen(true)} />
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-card)]/60 px-3 py-4 md:flex">
        <Link href="/" className="mb-4 flex items-center gap-2 px-2">
          <img src="/logo.svg" alt="管你屁事" className="size-8 rounded-lg" />
          <span className="font-semibold tracking-tight">管你屁事</span>
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
                {n.href === "/capture" && captures > 0 && <span className="ml-auto rounded-full bg-[var(--color-brand)] px-1.5 text-[10px] font-semibold leading-4 text-white">{captures}</span>}
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

function MobileNav({ path, unread, captures, onSearch }: { path: string; unread: number; captures: number; onSearch: () => void }) {
  const ITEMS = [
    { href: "/today", label: "今日", icon: Sun },
    { href: "/capture", label: "随手记", icon: PenLine },
    { href: "/projects", label: "项目", icon: FolderKanban },
    { href: "/affairs", label: "事务", icon: Briefcase },
    { href: "/inbox", label: "提醒", icon: Bell },
    { href: "/settings", label: "设置", icon: Settings },
  ];
  return (
    <>
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-card)] px-3 md:hidden">
        <Link href="/" className="flex items-center gap-1.5">
          <img src="/logo.svg" alt="管你屁事" className="size-6 rounded-md" />
          <span className="text-sm font-semibold">管你屁事</span>
        </Link>
        <button onClick={onSearch} title="搜索" aria-label="搜索" className="ml-auto rounded-md p-1.5 text-[var(--color-muted)]"><Search className="size-4" /></button>
        <ThemeToggle />
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-stretch justify-around border-t border-[var(--color-line)] bg-[var(--color-card)]/95 backdrop-blur md:hidden">
        {ITEMS.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] ${active ? "text-[var(--color-brand)]" : "text-[var(--color-muted)]"}`}>
              <n.icon className="size-[18px]" />
              {n.label}
              {n.href === "/inbox" && unread > 0 && <span className="absolute right-[22%] top-1.5 size-1.5 rounded-full bg-[var(--color-danger)]" />}
              {n.href === "/capture" && captures > 0 && <span className="absolute right-[22%] top-1.5 size-1.5 rounded-full bg-[var(--color-brand)]" />}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
