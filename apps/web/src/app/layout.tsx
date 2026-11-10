import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { ThemeScript } from "@/components/theme-script";

export const metadata: Metadata = {
  title: "你管我 · 贴身管家式事务中心",
  description: "Agent 优先的贴身管家式事务进度中心 — 让所有 AI Agent 知道自己在做什么、还有哪些没做完、资料在哪里",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><ThemeScript /></head>
      <body>
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
