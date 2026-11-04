import { chat, getDefaultProvider } from "./provider";
import { extractDeterministic } from "./rules";

export type ExtractedItem = { title: string; detailMd?: string; doneDefinition?: string; dueAt?: number | null; priority?: "P0" | "P1" | "P2" | "P3" };

export async function isAiReady() {
  return !!getDefaultProvider();
}

const PROMPT = `你是我的事务助理。给你一段杂乱的会议记录 / 对话 / 文档，请整理为结构化事务。

只输出 JSON，不要解释，格式：
{
  "title": "会议或文档的简短标题（中文，≤30字）",
  "summary": "3-6 句中文摘要，包含结论与关键背景",
  "items": [
    {"title": "一条可执行的具体事务（动词开头，≤60字）",
     "detailMd": "必要细节：谁做、做什么、关键约束（可为空）",
     "doneDefinition": "怎样算完成，可验收（可为空）",
     "priority": "P0|P1|P2",
     "dueHint": "如 '2026-11-30' 或 '两周内' 或 ''"}
  ]
}
规则：
- 只提取"要去做的事"，不把闲聊、已完成的背景叙述写进 items。
- 若原文明示了截止日期，换算成日期写进 dueHint；没写就留空，不要编造。
- 合并重复事项；拆分过于笼统的事项。
- 最多 25 条。`;

export async function extractMeeting(text: string, fallbackTitle = "会议记录") {
  try {
    const r = await chat([
      { role: "system", content: PROMPT },
      { role: "user", content: text.slice(0, 60000) },
    ], { json: true, feature: "meeting_extract", maxTokens: 4096 });
    const json = JSON.parse(stripFence(r.text));
    const items: ExtractedItem[] = (json.items ?? []).slice(0, 25).map((i: Record<string, unknown>) => ({
      title: String(i.title ?? "").slice(0, 200),
      detailMd: typeof i.detailMd === "string" ? i.detailMd : "",
      doneDefinition: typeof i.doneDefinition === "string" ? i.doneDefinition : "",
      priority: ["P0", "P1", "P2", "P3"].includes(String(i.priority)) ? (i.priority as "P0") : "P1",
      dueAt: parseDue(i.dueHint),
    })).filter((i: ExtractedItem) => i.title);
    if (!items.length) {
      // AI 没抽到可执行项时退回确定性规则，避免"导入后一片空白"
      const fb = extractDeterministic(text, Date.now());
      return { title: fb.title || fallbackTitle, summary: json.summary || fb.summary, items: fb.items };
    }
    return { title: typeof json.title === "string" && json.title ? json.title : fallbackTitle, summary: String(json.summary ?? ""), items };
  } catch {
    return null;
  }
}

function stripFence(t: string) {
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : t).trim();
}

function parseDue(hint: unknown): number | null {
  if (typeof hint !== "string" || !hint.trim()) return null;
  const iso = hint.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) {
    const d = new Date(iso[0] + "T18:00:00");
    return isNaN(+d) ? null : Math.floor(+d / 1000);
  }
  const days = hint.match(/(\d+)\s*(天|日)/);
  if (days) return Math.floor(Date.now() / 1000) + parseInt(days[1], 10) * 86400;
  const weeks = hint.match(/(\d+)\s*(周|星期)/);
  if (weeks) return Math.floor(Date.now() / 1000) + parseInt(weeks[1], 10) * 7 * 86400;
  return null;
}
