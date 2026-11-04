import { cn } from "@/lib/utils";
export function Badge({ className, tone = "default", ...p }: React.ComponentProps<"span"> & { tone?: "default" | "ok" | "warn" | "danger" | "brand" }) {
  const tones = {
    default: "bg-[var(--color-line)]/60 text-[var(--color-fg)]",
    ok: "bg-[var(--color-ok)]/12 text-[var(--color-ok)]",
    warn: "bg-[var(--color-warn)]/15 text-[oklch(0.5_0.12_70)]",
    danger: "bg-[var(--color-danger)]/12 text-[var(--color-danger)]",
    brand: "bg-[var(--color-brand-soft)] text-[var(--color-brand)]",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium", tones[tone], className)} {...p} />;
}
