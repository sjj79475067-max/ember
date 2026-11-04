import { describe, it, expect } from "vitest";
import { extractDeterministic } from "../ai/rules";

const MESSY = `2025-11-03 性能评审会
参会人：张总、李工、王工
会议时间：14:00-15:30
地点：三楼会议室
议题：Q4 性能优化
- 张总负责 11月10日前给出压测方案
- 李工负责接口层缓存改造，本周内完成
- 需确认 CDN 采购预算
- 王工作业面同步到看板
先这样吧。
谢谢大家。
图：性能曲线截图`;

describe("extractDeterministic", () => {
  it("只提取可执行事务，不把参会人和客套话当成任务", () => {
    const r = extractDeterministic(MESSY, new Date("2025-11-03T10:00:00").getTime());
    const titles = r.items.map((i) => i.title).join("|");
    expect(titles).not.toContain("参会人");
    expect(titles).not.toContain("谢谢");
    expect(titles).not.toContain("先这样");
    expect(titles).not.toContain("地点");
    expect(r.items.length).toBeGreaterThanOrEqual(3);
    expect(titles).toContain("压测方案");
    expect(titles).toContain("缓存改造");
  });

  it("解析中文日期与相对日期", () => {
    const now = new Date("2025-11-03T10:00:00").getTime();
    const r = extractDeterministic("- 张总负责 11月10日前给出压测方案\n- 李工负责接口层缓存改造，本周内完成", now);
    expect(r.items[0].dueAt).toBeTruthy();
    expect(new Date(r.items[0].dueAt! * 1000).getMonth()).toBe(10);
    expect(r.items[1].dueAt).toBeTruthy();
  });

  it("提取负责人", () => {
    const r = extractDeterministic("- 由李工负责核对合同条款\n- 王工负责部署上线", Date.now());
    expect(r.items.some((i) => i.detailMd?.includes("李工") || i.title.includes("李工"))).toBe(true);
  });

  it("空内容不崩", () => {
    expect(() => extractDeterministic("", Date.now())).not.toThrow();
  });
});
