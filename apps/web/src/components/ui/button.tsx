import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-brand)] text-white shadow-sm hover:brightness-110",
        secondary: "bg-[var(--color-brand-soft)] text-[var(--color-fg)] hover:brightness-[0.97]",
        outline: "border border-[var(--color-line)] bg-[var(--color-card)] hover:bg-[var(--color-brand-soft)]/50",
        ghost: "hover:bg-[var(--color-brand-soft)]/60",
        danger: "bg-[var(--color-danger)] text-white hover:brightness-110",
        link: "text-[var(--color-brand)] underline-offset-4 hover:underline",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3 text-[13px]", lg: "h-11 px-6", icon: "size-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({ className, variant, size, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
export { buttonVariants };
