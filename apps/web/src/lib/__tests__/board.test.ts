import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

beforeAll(async () => {
  process.env.DATABASE_URL = "file:" + path.join(mkdtempSync(path.join(tmpdir(), "ember-board-")), "t.db");
  const { sqlite } = await import("@/lib/db");
  const dir = path.join(process.cwd(), "drizzle");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const chunk of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) if (chunk.trim()) sqlite.exec(chunk);
  }
});

const user = { type: "user" as const, name: "owner" };
const agent = { type: "agent" as const, name: "ag" };

async function mkProject(key: string) {
  const { createProject } = await import("@/lib/services/projects");
  return createProject({ key, name: key }, user);
}

describe("模板", () => {
  it("App 模板建出阶段、资质事项与依赖，且可重复套用不重复建", async () => {
    const { applyTemplate } = await import("@/lib/services/templates");
    const { projectBoard } = await import("@/lib/services/board");
    const p = await mkProject("TAPP");
    const r1 = applyTemplate(p.id, "app", user);
    expect(r1.milestones).toBe(4);
    expect(r1.items).toBeGreaterThan(15);
    expect(r1.deps).toBeGreaterThan(5);
    const r2 = applyTemplate(p.id, "app", user);
    expect(r2.items).toBe(0);
    expect(r2.milestones).toBe(0);
    const b = projectBoard(p.id);
    expect(b.current?.name).toBe("设计");
    expect(b.release?.name).toBe("上线");
    expect(b.release?.ready).toBe(false);
    expect(b.byKind.some((k) => k.kind === "compliance")).toBe(true);
    // 「提交各商店审核」在等备案、软著等前置
    expect(b.attention.waiting.some((w) => w.title.includes("商店审核"))).toBe(true);
  });

  it("未知模板报错", async () => {
    const { applyTemplate } = await import("@/lib/services/templates");
    const p = await mkProject("TBAD");
    expect(() => applyTemplate(p.id, "nope", user)).toThrow(/没有模板/);
  });
});

describe("阶段与发版就绪", () => {
  it("必过项全部完成才算可放行；待核实不算完成", async () => {
    const { saveMilestone } = await import("@/lib/services/milestones");
    const { addItems, updateItem } = await import("@/lib/services/items");
    const { projectBoard } = await import("@/lib/services/board");
    const p = await mkProject("TREADY");
    const m = saveMilestone({ projectId: p.id, name: "v1", kind: "release" }, user);
    const r = addItems(p.id, [{ title: "ICP 备案", mustMeet: true, milestoneId: m.id, kind: "compliance" }, { title: "写官网文案", milestoneId: m.id }], user);
    expect(projectBoard(p.id).release?.ready).toBe(false);
    updateItem(r.ids[0], { status: "done", evidence: "已对接云厂商" }, agent); // 进度式证据 → 待核实
    expect(projectBoard(p.id).release?.ready).toBe(false);
    updateItem(r.ids[0], { status: "done", evidence: "拿到备案号 京ICP备2026000001号，已登记" }, user);
    const b = projectBoard(p.id);
    expect(b.release?.ready).toBe(true);
    expect(b.release?.mustDone).toBe(1);
  });

  it("阶段门只能由用户决定；放行后自动激活下一阶段并记一条决定", async () => {
    const { saveMilestone, decideGate, listMilestones } = await import("@/lib/services/milestones");
    const { db, s } = await import("@/lib/db");
    const p = await mkProject("TGATE");
    const a = saveMilestone({ projectId: p.id, name: "开发", status: "active" }, user);
    saveMilestone({ projectId: p.id, name: "测试" }, user);
    expect(() => decideGate(a.id, "go", "可以", agent)).toThrow(/只能由用户/);
    decideGate(a.id, "go", "核心功能演示通过", user);
    const ms = listMilestones(p.id);
    expect(ms.find((x) => x.name === "开发")?.status).toBe("done");
    expect(ms.find((x) => x.name === "测试")?.status).toBe("active");
    expect(db.select().from(s.decisions).all().some((d) => d.title.includes("开发") && d.title.includes("放行"))).toBe(true);
  });

  it("资质办理周期不够时提前标风险", async () => {
    const { saveMilestone } = await import("@/lib/services/milestones");
    const { addItems } = await import("@/lib/services/items");
    const { projectBoard } = await import("@/lib/services/board");
    const p = await mkProject("TLEAD");
    const m = saveMilestone({ projectId: p.id, name: "上线", dueAt: Math.floor(Date.now() / 1000) + 5 * 86400 }, user);
    addItems(p.id, [{ title: "App 备案", mustMeet: true, milestoneId: m.id, leadTimeDays: 20, kind: "compliance" }], user);
    const b = projectBoard(p.id);
    expect(b.phases[0].leadRisk.length).toBe(1);
    expect(b.health.suggested).toBe("at_risk");
  });
});

describe("需求闭环", () => {
  it("有未完成事项不能标完成；事项全部完成后需求自动关闭", async () => {
    const { saveRequirement, getRequirement } = await import("@/lib/services/requirements");
    const { addItems, updateItem } = await import("@/lib/services/items");
    const p = await mkProject("TREQ");
    const r = saveRequirement({ projectId: p.id, title: "支持微信登录" }, user);
    expect(r.code).toBe("R-001");
    saveRequirement({ id: r.id, projectId: p.id, status: "accepted" }, user);
    const it = addItems(p.id, [{ title: "接入微信开放平台登录", requirementId: r.id }], user);
    expect(() => saveRequirement({ id: r.id, projectId: p.id, status: "done" }, user)).toThrow(/没完成/);
    updateItem(it.ids[0], { status: "doing" }, user);
    expect(getRequirement(r.id)?.status).toBe("in_progress");
    updateItem(it.ids[0], { status: "done", evidence: "扫码登录真机测试通过，回调地址已配置" }, user);
    expect(getRequirement(r.id)?.status).toBe("done");
    // 事项被重新打开 → 需求回到进行中
    updateItem(it.ids[0], { status: "todo" }, user);
    expect(getRequirement(r.id)?.status).toBe("in_progress");
  });

  it("放弃必须写原因；agent 放弃需用户确认", async () => {
    const { saveRequirement, confirmDrop } = await import("@/lib/services/requirements");
    const p = await mkProject("TDROP");
    const r = saveRequirement({ projectId: p.id, title: "做一个小游戏" }, user);
    expect(() => saveRequirement({ id: r.id, projectId: p.id, status: "dropped" }, agent)).toThrow(/原因/);
    const d = saveRequirement({ id: r.id, projectId: p.id, status: "dropped", closeReason: "本期不做，和核心业务无关" }, agent);
    expect(d.closeConfirmed).toBe(0);
    expect(() => confirmDrop(r.id, true, agent)).toThrow(/用户/);
    const back = confirmDrop(r.id, false, user);
    expect(back.status).toBe("accepted");
  });

  it("同名未关闭需求不重复建", async () => {
    const { saveRequirement } = await import("@/lib/services/requirements");
    const p = await mkProject("TDUP");
    saveRequirement({ projectId: p.id, title: "导出 Excel" }, user);
    expect(() => saveRequirement({ projectId: p.id, title: "导出 Excel" }, agent)).toThrow(/已有同名/);
  });
});

describe("依赖", () => {
  it("环检测、等待中、违约", async () => {
    const { addItems, updateItem } = await import("@/lib/services/items");
    const { addDep, waitingOn, depsFor } = await import("@/lib/services/deps");
    const p = await mkProject("TDEP");
    const now = Math.floor(Date.now() / 1000);
    const r = addItems(p.id, [
      { title: "ICP 备案办理", dueAt: now + 20 * 86400 },
      { title: "正式上线", dueAt: now + 10 * 86400 },
      { title: "公安联网备案" },
    ], user);
    const [icp, launch, gongan] = r.ids;
    addDep(icp, launch, user);
    addDep(icp, gongan, user);
    expect(() => addDep(launch, icp, user)).toThrow(/循环/);
    expect(waitingOn(launch).map((w) => w.blockerTitle)).toEqual(["ICP 备案办理"]);
    expect(depsFor([launch]).find((d) => d.blockedId === launch)?.violated).toBe(true);
    updateItem(icp, { status: "done", evidence: "备案号已下发，登记在资料" }, user);
    expect(waitingOn(launch).length).toBe(0);
  });

  it("事项升级新版本时依赖跟着转移", async () => {
    const { addItems, supersedeItem } = await import("@/lib/services/items");
    const { addDep, waitingOn } = await import("@/lib/services/deps");
    const p = await mkProject("TSUP");
    const r = addItems(p.id, [{ title: "隐私政策 v1" }, { title: "提交商店审核" }], user);
    addDep(r.ids[0], r.ids[1], user);
    const sp = supersedeItem(r.ids[0], { title: "隐私政策 v2（补充第三方 SDK 清单）" }, user);
    expect(waitingOn(r.ids[1]).map((w) => w.blockerId)).toEqual([sp.next.id]);
  });
});

describe("健康度", () => {
  it("没有更新时用系统建议，发更新后以更新为准", async () => {
    const { projectBoard, postProjectUpdate } = await import("@/lib/services/board");
    const p = await mkProject("THEALTH");
    const b1 = projectBoard(p.id);
    expect(b1.health.source).toBe("system");
    expect(b1.health.updateMissing).toBe(true);
    postProjectUpdate({ projectId: p.id, health: "at_risk", progressMd: "完成登录", blockersMd: "等备案", nextMd: "做支付" }, user);
    const b2 = projectBoard(p.id);
    expect(b2.health.source).toBe("update");
    expect(b2.health.value).toBe("at_risk");
  });
});