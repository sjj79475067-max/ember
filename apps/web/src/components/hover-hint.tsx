"use client";
import { useEffect, useState } from "react";

/**
 * 全局悬停提示：鼠标停在带 title / aria-label 的按钮或链接上 0.3 秒，显示说明。
 * 比浏览器自带提示快、样式统一；只对鼠标生效（手机上按钮都有文字）。
 */
export function HoverHint() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: HTMLElement | null = null;
    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (current?.dataset.hint && !current.getAttribute("title")) current.setAttribute("title", current.dataset.hint);
      current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("button[title],a[title],button[aria-label],a[aria-label],[data-hint]");
      if (el === current) return;
      hide();
      if (!el) return;
      const text = el.getAttribute("title") || el.dataset.hint || el.getAttribute("aria-label") || "";
      if (!text) return;
      // 暂存 title，避免浏览器自带提示叠在一起
      if (el.getAttribute("title")) { el.dataset.hint = el.getAttribute("title")!; el.removeAttribute("title"); }
      current = el;
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        const below = r.top < 40;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
      }, 300);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);
  if (!tip) return null;
  const left = Math.max(8, Math.min(tip.x, (typeof window !== "undefined" ? window.innerWidth : 1000) - 8));
  return (
    <div role="tooltip" style={{ left, top: tip.y, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}
      className="pointer-events-none fixed z-[100] max-w-60 rounded-md bg-[var(--color-fg)] px-2 py-1 text-[11px] leading-4 text-[var(--color-bg)] shadow-md">
      {tip.text}
    </div>
  );
}
