"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...p }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2 max-h-[90vh] overflow-y-auto",
          className,
        )}
        {...p}
      >
        {children}
        <DialogPrimitive.Close title="关闭" aria-label="关闭" className="absolute right-4 top-4 rounded-md p-1 text-[var(--color-muted)] opacity-70 hover:opacity-100 hover:bg-[var(--color-line)]/50">
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export function DialogHeader({ className, ...p }: React.ComponentProps<"div">) { return <div className={cn("flex flex-col gap-1", className)} {...p} />; }
export function DialogTitle({ className, ...p }: React.ComponentProps<typeof DialogPrimitive.Title>) { return <DialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...p} />; }
export function DialogDescription({ className, ...p }: React.ComponentProps<typeof DialogPrimitive.Description>) { return <DialogPrimitive.Description className={cn("text-sm text-[var(--color-muted)]", className)} {...p} />; }
export function DialogFooter({ className, ...p }: React.ComponentProps<"div">) { return <div className={cn("flex justify-end gap-2 pt-2", className)} {...p} />; }
