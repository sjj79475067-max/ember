import { redirect } from "next/navigation";
import { hasOwner } from "@/lib/bootstrap";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");
  const initialized = hasOwner();
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--color-bg)] p-6">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-[var(--color-brand)]/15 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-[var(--color-brand)] text-xl font-bold text-white shadow-lg shadow-[var(--color-brand)]/30">管</div>
          <h1 className="text-2xl font-semibold tracking-tight">管你屁事 · 事务进度中心</h1>
          <p className="mt-1.5 text-sm text-[var(--color-muted)]">{initialized ? "登录以管理你的项目与 agent 协作" : "首次使用：创建管理员账号"}</p>
        </div>
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-6 shadow-xl shadow-black/[0.03]">
          <LoginForm initialized={initialized} />
        </div>
      </div>
    </div>
  );
}
