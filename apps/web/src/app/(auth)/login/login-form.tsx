"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm({ initialized }: { initialized: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const url = initialized ? "/api/auth/login" : "/api/auth/setup";
      const body = initialized ? { email, password } : { email, name, password };
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "登录失败");
      router.replace("/");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-[var(--color-muted)]">邮箱</span>
        <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
      </label>
      {!initialized && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-muted)]">你的名字</span>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="用于标注操作记录" />
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-[var(--color-muted)]">密码</span>
        <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={initialized ? "输入密码" : "至少 8 位"} autoComplete={initialized ? "current-password" : "new-password"} />
      </label>
      {err && <p className="text-sm text-[var(--color-danger)]">{err}</p>}
      <Button type="submit" disabled={loading} size="lg" className="mt-2">
        {loading ? "处理中…" : initialized ? "登录" : "创建并进入"}
      </Button>
    </form>
  );
}
