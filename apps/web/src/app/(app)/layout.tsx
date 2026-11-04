import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { countOpen, refreshReminders } from "@/lib/services/reminders";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  let unread = 0;
  try {
    refreshReminders();
    unread = countOpen();
  } catch {}
  return (
    <div className="flex min-h-screen">
      <Sidebar user={{ name: user.name, email: user.email }} unread={unread} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
