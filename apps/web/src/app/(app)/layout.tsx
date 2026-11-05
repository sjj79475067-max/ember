import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { HoverHint } from "@/components/hover-hint";
import { countOpen, refreshReminders } from "@/lib/services/reminders";
import { pendingDraftCount } from "@/lib/capture/service";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  let unread = 0;
  let captures = 0;
  try {
    refreshReminders();
    unread = countOpen();
    captures = pendingDraftCount();
  } catch {}
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar user={{ name: user.name, email: user.email }} unread={unread} captures={captures} />
      <main className="min-w-0 flex-1 pb-14 md:pb-0">{children}</main>
      <HoverHint />
    </div>
  );
}
