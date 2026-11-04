import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtDate(sec?: number | null, withTime = false) {
  if (!sec) return "—";
  const d = new Date(sec * 1000);
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return withTime ? `${s} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : s;
}

export function relTime(sec?: number | null) {
  if (!sec) return "—";
  const diff = Date.now() / 1000 - sec;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return fmtDate(sec);
}

export function daysLeft(sec?: number | null) {
  if (!sec) return null;
  return Math.ceil((sec - Date.now() / 1000) / 86400);
}

export const KIND_LABEL: Record<string, string> = { it: "IT 项目", admin: "事务", client: "客户", knowledge: "资料库" };
export const STATUS_LABEL: Record<string, string> = { todo: "待办", doing: "进行中", blocked: "阻塞", done: "已完成", dropped: "已放弃", changed: "已变更" };
export const REM_KIND_LABEL: Record<string, string> = { due: "即将到期", overdue: "已逾期", blocked: "阻塞", policy: "条例待确认", stale_file: "资料待核验", review: "待复核", digest: "摘要" };
