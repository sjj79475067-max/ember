import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

beforeAll(async () => {
  process.env.DATABASE_URL = "file:" + path.join(mkdtempSync(path.join(tmpdir(), "ember-sec-")), "t.db");
  const { sqlite } = await import("@/lib/db");
  const dir = path.join(process.cwd(), "drizzle");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const chunk of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) if (chunk.trim()) sqlite.exec(chunk);
  }
});

const user = { type: "user" as const, name: "owner" };
const agent = { type: "agent" as const, name: "ag" };
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

async function setup(key: string) {
  const { createProject } = await import("@/lib/services/projects");
  return createProject({ key, name: `项目${key}` }, user);
}

describe("在等别人", () => {
  it("写 waitingFor 自动记交出日期与 3 天后催；到期进该催；清空即结束；完成清掉等待", async () => {
    const p = await setup("SWA");
    const { addItems, updateItem } = await import("@/lib/services/items");
    const { waitingList } = await import("@/lib/services/secretary");
    const { db, s } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const r = addItems(p.id, [{ title: "ICP 备案提交管局" }, { title: "等客户确认报价" }], user);
    const a = updateItem(r.ids[0], { waitingFor: "管局审核" }, agent).item;
    expect(a.delegatedAt).toBeGreaterThan(now() - 5);
    expect(a.followUpAt! - a.delegatedAt!).toBe(3 * DAY);
    expect(waitingList().find((w) => w.id === a.id)?.nudge).toBe(false);
    db.update(s.items).set({ followUpAt: now() - 10 }).where(eq(s.items.id, a.id)).run();
    expect(waitingList()[0].id).toBe(a.id);
    expect(waitingList()[0].nudge).toBe(true);
    const cleared = updateItem(a.id, { waitingFor: "" }, user).item;
    expect(cleared.followUpAt).toBeNull();
    updateItem(r.ids[1], { waitingFor: "王经理" }, user);
    const done = updateItem(r.ids[1], { status: "done", evidence: "客户已书面确认报价 12 万" }, user).item;
    expect(done.waitingFor).toBe("");
    expect(waitingList().some((w) => w.id === r.ids[1])).toBe(false);
  });

  it("到催办日生成提醒", async () => {
    const p = await setup("SWR");
    const { addItems, updateItem } = await import("@/lib/services/items");
    const { refreshReminders } = await import("@/lib/services/reminders");
    const { db, s } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const r = addItems(p.id, [{ title: "等供应商发货" }], user);
    updateItem(r.ids[0], { waitingFor: "京东" }, user);
    db.update(s.items).set({ followUpAt: now() - 60 }).where(eq(s.items.id, r.ids[0])).run();
    refreshReminders();
    const rem = db.select().from(s.reminders).all().find((x) => x.targetId === r.ids[0] && x.title.startsWith("该催了"));
    expect(rem).toBeTruthy();
  });
});

describe("今日与滚动", () => {
  it("计划日已过自动滚到今天并计数；同日不重复滚；3 次进拖延；改日期清零", async () => {
    const p = await setup("STD");
    const { addItems, updateItem } = await import("@/lib/services/items");
    const { todayPlan, staleWork, rollOver, localYmd } = await import("@/lib/services/secretary");
    const { db, s } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const r = addItems(p.id, [{ title: "写隐私政策" }, { title: "搁置的想法" }], user);
    db.update(s.items).set({ plannedFor: localYmd(now() - 2 * DAY), rollCount: 2 }).where(eq(s.items.id, r.ids[0])).run();
    const plan = todayPlan();
    const row = plan.items.find((i) => i.id === r.ids[0])!;
    expect(row.why).toBe("planned");
    expect(row.rollCount).toBe(3);
    expect(rollOver()).toBe(0); // 幂等
    expect(staleWork().find((x) => x.id === r.ids[0])?.reason).toBe("rolled");
    const moved = updateItem(r.ids[0], { plannedFor: localYmd(now() + DAY) }, user).item;
    expect(moved.rollCount).toBe(0);
    // 搁置：P0 也不进今天
    updateItem(r.ids[1], { priority: "P0", deferUntil: now() + 7 * DAY }, user);
    expect(todayPlan().items.some((i) => i.id === r.ids[1])).toBe(false);
  });

  it("排序：逾期在前；在等别人的不进今天；完成后清掉计划", async () => {
    const p = await setup("STO");
    const { addItems, updateItem } = await import("@/lib/services/items");
    const { todayPlan, planToday } = await import("@/lib/services/secretary");
    const r = addItems(p.id, [{ title: "逾期的", dueAt: now() - DAY }, { title: "计划的" }, { title: "等人的", priority: "P0" }], user);
    planToday([r.ids[1]], true, user);
    updateItem(r.ids[2], { waitingFor: "客户" }, user);
    const ids = todayPlan().items.map((i) => i.id);
    expect(ids.indexOf(r.ids[0])).toBeLessThan(ids.indexOf(r.ids[1]));
    expect(ids.includes(r.ids[2])).toBe(false);
    const d = updateItem(r.ids[1], { status: "done", evidence: "已上线到官网，链接 https://x.cn/privacy" }, user).item;
    expect(d.plannedFor).toBe("");
  });

  it("planned_for 格式校验", async () => {
    const p = await setup("STF");
    const { addItems, updateItem } = await import("@/lib/services/items");
    const r = addItems(p.id, [{ title: "随便" }], user);
    expect(() => updateItem(r.ids[0], { plannedFor: "明天" }, user)).toThrow(/YYYY-MM-DD/);
  });
});

describe("需要你拍板", () => {
  it("汇总待批条例、阶段建议、需求放弃、待核实、阻塞", async () => {
    const p = await setup("SDQ");
    const { addItems, updateItem } = await import("@/lib/services/items");
    const { upsertPolicy } = await import("@/lib/services/policies");
    const { saveMilestone } = await import("@/lib/services/milestones");
    const { decisionsQueue } = await import("@/lib/services/secretary");
    upsertPolicy({ title: "提交前跑测试", bodyMd: "每次提交前跑 pnpm test", required: false }, agent);
    saveMilestone({ projectId: p.id, name: "内测", gateProposal: "必过项都完成了，建议放行" }, agent);
    const r = addItems(p.id, [{ title: "接入支付" }, { title: "上架应用商店" }], user);
    updateItem(r.ids[0], { status: "blocked", blockReason: "等商户号下来" }, agent);
    updateItem(r.ids[1], { status: "done", evidence: "已提交审核，在推进中" }, agent);
    const kinds = new Set(decisionsQueue().map((d) => d.kind));
    for (const k of ["policy", "gate", "blocked", "verify"]) expect(kinds.has(k)).toBe(true);
  });
});

describe("每周复盘", () => {
  it("素材统计；agent 起草为草稿；用户确认后 agent 不能改", async () => {
    const p = await setup("SWK");
    const { addItems, updateItem } = await import("@/lib/services/items");
    const { weeklyMaterial, saveWeeklyReview, secretaryOverview } = await import("@/lib/services/secretary");
    const r = addItems(p.id, [{ title: "完成登录页" }, { title: "做注册页" }], user);
    updateItem(r.ids[0], { status: "done", evidence: "登录页已上线，测试账号可登录" }, user);
    const m = weeklyMaterial();
    expect(m.stats.done).toBeGreaterThanOrEqual(1);
    expect(m.done.some((g) => g.projectId === p.id && g.titles.includes("完成登录页"))).toBe(true);
    const d = saveWeeklyReview({ top3: [{ title: "做注册页", itemId: r.ids[1] }, { title: "" }] }, agent);
    expect(d.status).toBe("draft");
    expect(d.top3.length).toBe(1);
    expect(secretaryOverview().top3[0].status).toBe("todo");
    saveWeeklyReview({ top3: [{ title: "做注册页", itemId: r.ids[1] }, { title: "约客户见面" }], notesMd: "这周顺" }, user);
    expect(() => saveWeeklyReview({ top3: [{ title: "改掉" }] }, agent)).toThrow(/agent 不能改/);
    expect(() => saveWeeklyReview({ top3: [{ title: "x", itemId: "itm_nope" }] }, user)).toThrow(/不存在/);
  });
});
