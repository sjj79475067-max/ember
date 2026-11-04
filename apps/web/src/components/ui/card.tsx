import { cn } from "@/lib/utils";
export function Card({ className, ...p }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]", className)} {...p} />;
}
export function CardHeader({ className, ...p }: React.ComponentProps<"div">) { return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...p} />; }
export function CardTitle({ className, ...p }: React.ComponentProps<"h3">) { return <h3 className={cn("text-base font-semibold tracking-tight", className)} {...p} />; }
export function CardContent({ className, ...p }: React.ComponentProps<"div">) { return <div className={cn("p-5 pt-0", className)} {...p} />; }
