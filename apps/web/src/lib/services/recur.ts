/**
 * 重复事项的规则（公司固定节点用）：
 *   monthly:15        每月 15 日
 *   quarterly:15      每季首月（1/4/7/10 月）15 日 —— 季度申报期
 *   yearly:05-31      每年 5 月 31 日
 * 截止时间统一取当天 18:00（本地时间）。
 */
export const RECUR_RE = /^(monthly:(\d{1,2})|quarterly:(\d{1,2})|yearly:(\d{2})-(\d{2}))$/;

export function validRecur(rule: string) {
  return !rule || RECUR_RE.test(rule);
}

function at18(y: number, m: number, d: number) {
  // m: 0-11；日期超出当月天数时取月末（例如 monthly:31 在 2 月）
  const last = new Date(y, m + 1, 0).getDate();
  return Math.floor(new Date(y, m, Math.min(d, last), 18, 0, 0).getTime() / 1000);
}

/** 严格晚于 after 的下一次截止时间 */
export function nextOccurrence(rule: string, after: number): number | null {
  const m = rule.match(RECUR_RE);
  if (!m) return null;
  const a = new Date(after * 1000);
  if (m[2]) {
    const d = Number(m[2]);
    for (let k = 0; k < 14; k++) {
      const t = at18(a.getFullYear(), a.getMonth() + k, d);
      if (t > after) return t;
    }
  }
  if (m[3]) {
    const d = Number(m[3]);
    for (let k = 0; k < 16; k++) {
      const mm = a.getMonth() + k;
      if (((mm % 12) + 12) % 12 % 3 !== 0) continue;
      const t = at18(a.getFullYear(), mm, d);
      if (t > after) return t;
    }
  }
  if (m[4]) {
    const mon = Number(m[4]) - 1, d = Number(m[5]);
    for (let k = 0; k < 3; k++) {
      const t = at18(a.getFullYear() + k, mon, d);
      if (t > after) return t;
    }
  }
  return null;
}

export function describeRecur(rule: string) {
  const m = rule.match(RECUR_RE);
  if (!m) return "";
  if (m[2]) return `每月 ${m[2]} 日`;
  if (m[3]) return `每季度首月 ${m[3]} 日`;
  return `每年 ${Number(m[4])} 月 ${Number(m[5])} 日`;
}