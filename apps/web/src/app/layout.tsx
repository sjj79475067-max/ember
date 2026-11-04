import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { ThemeScript } from "@/components/theme-script";

export const metadata: Metadata = {
  title: "Ember · 事务进度中心",
  description: "Agent 优先的项目进度与资料定位中心",
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
