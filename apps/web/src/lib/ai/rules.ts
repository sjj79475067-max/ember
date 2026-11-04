/**
 * 无 AI 时的确定性事务抽取（也作为 AI 输出为空时的兜底）。
 * 目标是"从杂乱的会议记录里挑出要去做的事"，宁可少提取，也不要噪音。
 */

const META_PREFIX = /^(参会|参与|出席|时间|地点|会议|主题|议程|主持人|记录人|会议时间|会议地点|与会人员|会议主题|议程|日期|记录|整理)[:：]/;
const CLOSING = /^(谢谢|谢谢大家|辛苦了|大家辛苦|先这样|好的|收到|以上|散会|再见|完毕|结束|没问题|嗯|ok|OK)[。！!.\s]*$/;
const ACTION_CUE = /(负责|需|要|待|完成|提交|输出|跟进|确认|给出|准备|整理|安排|落实|对接|更新|修复|上线|发布|采购|申报|办理|评审|测试|部署|归档|签|发送|提供|通知|核对|检查|推进|评估|复盘)/;
const NOISE = /^(下载|点击|链接|http|www|@|#|\[|图|截图)/;
const OWNER_RE = /(?:由|请|@)([一-龥A-Za-z]{1,8})(?:负责|跟进|完成|处理|确认)/;

export type RuleItem = { title: string; detailMd?: string; doneDefinition?: string; dueAt?: number | null; priority?: "P0" | "P1" | "P2" };

export function extractDeterministic(text: string, now = Date.now()): { title: string; summary: string; items: RuleItem[] } {
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map((l) => l.trim()).filter(Boolean);
  const title = deriveTitle(lines);
  const items: RuleItem[] = [];
  const seen = new Set<string>();
  let inSection = false;

  for (const line of lines) {
    const cleaned = line
      .replace(/^[-*•·>]\s*/, "")
      .replace(/^\d+[.、)）]\s*/, "")
      .replace(/^[（(]\d+[)）]\s*/, "")
      .replace(/^\[[ xX✓]\]\s*/, "")
      .trim();
    if (!cleaned) continue;
    if (META_PREFIX.test(cleaned)) continue;
    if (CLOSING.test(cleaned)) continue;
    if (NOISE.test(cleaned)) continue;
    if (/^#+\s/.test(line)) { inSection = /(待办|行动|任务|Action|TODO|事项|结论)/i.test(line); continue; }
    const isBullet = /^([-*•·>]|\d+[.、)）]|\[[ xX✓]\])/.test(line);
    const cjk = (cleaned.match(/[一-龥]/g) ?? []).length;
    if (cjk < 6 && cleaned.length < 12) continue;
    const hasCue = ACTION_CUE.test(cleaned);
    const bulletOrNumbered = /^([-*•·>]|\d+[.、)）]|\[\s?[xX✓]?\s?\])/.test(line);
    if (bulletOrNumbered && cjk >= 4 && cleaned.length >= 6 && !META_PREFIX.test(cleaned)) {
      const t0 = stripDue(cleaned, now).slice(0, 120);
      if (t0 && !seen.has(t0)) {
        seen.add(t0);
        const owner0 = cleaned.match(OWNER_RE)?.[1];
        items.push({ title: t0, detailMd: owner0 ? `负责人：${owner0}` : "", doneDefinition: `完成：${t0.slice(0, 40)}`, dueAt: parseDue(cleaned, now), priority: /(紧急|立即|今天|明天|截止)/.test(cleaned) ? "P0" : "P1" });
        if (items.length >= 30) break;
        continue;
      }
    }
    const mentionedOwner = OWNER_RE.test(cleaned) || /负责/.test(cleaned) || /@\S+/.test(cleaned);
    if (!isBullet && !inSection && !hasCue && !mentionedOwner) continue;
    if (!hasCue && !mentionedOwner && !isBullet) continue;

    const due = parseDue(cleaned, now);
    const owner = cleaned.match(OWNER_RE)?.[1];
    const t = stripDue(cleaned, now).replace(/\s{2,}/g, " ").slice(0, 120);
    if (seen.has(t)) continue;
    seen.add(t);
    items.push({
      title: t,
      detailMd: owner ? `负责人：${owner}` : "",
      doneDefinition: `完成：${t.slice(0, 40)}${t.length > 40 ? "…" : ""}`,
      dueAt: due,
      priority: /(紧急|立即|今天|明天|截止)/.test(cleaned) ? "P0" : "P1",
    });
    if (items.length >= 30) break;
  }
  if (!items.length) {
    // 没有明显可执行项时，把结构化的短行作为"待确认事项"给出，而不是空手而归
    for (const line of lines.slice(0, 10)) {
      const c = line.replace(/^[-*•·>\d.、)）]\s*/, "").trim();
      if (c.length >= 4 && c.length <= 120 && !META_PREFIX.test(c) && !CLOSING.test(c)) {
        items.push({ title: c.slice(0, 120), doneDefinition: "", dueAt: null, priority: "P2" });
      }
    }
  }
  return { title, summary: makeSummary(items, lines), items };
}

function deriveTitle(lines: string[]): string {
  const head = lines.find((l) => /^#+\s/.test(l));
  if (head) return head.replace(/^#+\s*/, "").slice(0, 40);
  const first = lines.find((l) => !META_PREFIX.test(l) && l.length >= 4);
  if (first) return first.replace(/^[-*•·>\d.、)）\s]+/, "").slice(0, 30);
  return "会议记录";
}

function makeSummary(items: RuleItem[], lines: string[]): string {
  const participants = lines.find((l) => /^(参会|参与|出席|与会人员)[:：]/.test(l));
  const parts = [];
  if (participants) parts.push(participants.replace(/[:：]\s*/, "："));
  parts.push(`提取到 ${items.length} 项待办事务。`);
  const withDue = items.filter((i) => i.dueAt).length;
  if (withDue) parts.push(`其中 ${withDue} 项有明确截止时间。`);
  return parts.join(" ");
}

function parseDue(text: string, nowMs: number): number | null {
  const iso = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 18, 0, 0);
    return isNaN(+d) ? null : Math.floor(+d / 1000);
  }
  const md = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (md) {
    const nowY = new Date(nowMs).getFullYear();
    let d = new Date(nowY, Number(md[1]) - 1, Number(md[2]), 18, 0, 0);
    if (+d < nowMs) d = new Date(nowY + 1, Number(md[1]) - 1, Number(md[2]), 18, 0, 0);
    return Math.floor(+d / 1000);
  }
  const rel = text.match(/(今天|明天|后天|本周|下周|月底|下月)/);
  if (rel) {
    const base = new Date(nowMs);
    if (rel[1] === "今天") return Math.floor(nowMs / 1000) + 86400;
    if (rel[1] === "明天") return Math.floor(nowMs / 1000) + 2 * 86400;
    if (rel[1] === "后天") return Math.floor(nowMs / 1000) + 3 * 86400;
    if (rel[1] === "本周") { const d = new Date(base); d.setDate(d.getDate() + (5 - d.getDay())); d.setHours(18, 0, 0, 0); return Math.floor(+d / 1000); }
    if (rel[1] === "下周") { const d = new Date(base); d.setDate(d.getDate() + (7 - d.getDay() + 5)); d.setHours(18, 0, 0, 0); return Math.floor(+d / 1000); }
    if (rel[1] === "月底") return Math.floor(new Date(base.getFullYear(), base.getMonth() + 1, 0, 18).getTime() / 1000);
    if (rel[1] === "下月") return Math.floor(new Date(base.getFullYear(), base.getMonth() + 1, 28, 18).getTime() / 1000);
  }
  return null;
}

function stripDue(text: string, _nowMs: number): string {
  return text
    .replace(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日号]?/g, "")
    .replace(/\d{1,2}月\d{1,2}[日号]/g, "")
    .replace(/(今天|明天|后天|本周[一二三四五六日天]?|下周[一二三四五六日天]?|月底前?|下月)/g, "")
    .replace(/[（(]\s*[)）]/g, "")
    .trim();
}
