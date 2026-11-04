import { cn } from "@/lib/utils";
export function Input({ className, ...p }: React.ComponentProps<"input">) {
  return <input className={cn("h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-3 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-2 focus:ring-[var(--color-brand)]/30", className)} {...p} />;
}
export function Textarea({ className, ...p }: React.ComponentProps<"textarea">) {
  return <textarea className={cn("w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] p-3 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-2 focus:ring-[var(--color-brand)]/30", className)} {...p} />;
}
