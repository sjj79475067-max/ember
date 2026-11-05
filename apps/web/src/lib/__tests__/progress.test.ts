import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

beforeAll(async () => {
  process.env.DATABASE_URL = "file:" + path.join(mkdtempSync(path.join(tmpdir(), "ember-prog-")), "t.db");
  const { sqlite } = await import("@/lib/db");
  const dir = path.join(process.cwd(), "drizzle");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const chunk of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) if (chunk.trim()) sqlite.exec(chunk);
  }
});

const user = { type: "user" as const, name: "owner" };
const agent = { type: "agent" as const, name: "ag" };

describe("流水账识别", () => {
  it("进度式证据被判为「未完成」", async () => {
    const { looksLikeProgressNotCompletion } = await import("@/lib/services/items");
    expect(looksLikeProgressNotCompletion("提交报价单", "已对接客户采购").progress).toBe(true);
    expect(looksLikeProgressNotCompletion("提交报价单", "跟进中").progress).toBe(true);
    expect(looksLikeProgressNotCompletion("提交报价单", "提交报价单").progress).toBe(true);
    expect(looksLikeProgressNotCompletion("提交报价单", "已提交报价单至客户邮箱，客户确认收到").progress).toBe(false);
    expect(looksLikeProgressNotCompletion("提交报价单", "签署版合同已回传，扫描件在 /docs/c.pdf").progress).toBe(false);
  });

  it("过程性标题会被识别", async () => {
    const { isProgressLikeTitle } = await import("@/lib/services/items");
    expect(isProgressLikeTitle("跟进 A 客户")).toBe(true);
    expect(isProgressLikeTitle("对接").toString()).toBe("true");
    expect(isProgressLikeTitle("提交合同终稿")).toBe(false);
  });

  it("过程性条目合并进已有任务而不是新建", async () => {
    const { createProject } = await import("@/lib/services/projects");
    const { addItems, listItems } = await import("@/lib/services/items");
    const p = createProject({ key: "PROG1", name: "进度测试" }, user);
    addItems(p.id, [{ title: "跟进 A 客户报价" }], agent);
    const r = addItems(p.id, [{ title: "继续跟进 A 客户" }], agent);
    expect(r.ids.length).toBe(0);
    expect(r.merged.length).toBe(1);
    const list = listItems({ projectId: p.id });
    expect(list.items.length).toBe(1);
    expect(list.items[0].detailMd).toContain("进展");
  });

  it("checklist_add 带 expected_version 时把新内容记为进展", async () => {
    const { createProject } = await import("@/lib/services/projects");
    const { addItems, listItems } = await import("@/lib/services/items");
    const p = createProject({ key: "PROG2", name: "版本测试" }, user);
    const a = addItems(p.id, [{ title: "准备投标材料" }], agent);
    const oldVersion = listItems({ projectId: p.id }).items[0].version;
    // 版本已被别人推进（传的版本比当前旧）→ 视为同一件事的进展，合并进去
    const r = addItems(p.id, [{ title: "准备投标材料", detailMd: "已完成资质文件", expectedVersion: oldVersion - 1 }], agent);
    expect(r.ids.length).toBe(0);
    expect(r.merged[0].reason).toMatch(/进展/);
    expect(listItems({ projectId: p.id }).items.length).toBe(1);
    expect(listItems({ projectId: p.id }).items[0].detailMd).toContain("已完成资质文件");
    expect(a.ids.length).toBe(1);
  });

  it("done 但证据像进度 → 标记待核实", async () => {
    const { createProject } = await import("@/lib/services/projects");
    const { addItems, updateItem } = await import("@/lib/services/items");
    const p = createProject({ key: "PROG3", name: "证据测试" }, user);
    const r = addItems(p.id, [{ title: "发送催款函", doneDefinition: "对方签收" }], agent);
    const u = updateItem(r.ids[0], { status: "done", evidence: "已联系对方财务" }, agent);
    expect(u.item.needsReview).toBe(1);
    expect(u.flag).toBe("evidence_is_progress");
  });

  it("进展追加不新建任务；完成的任务不能直接追加进展", async () => {
    const { createProject } = await import("@/lib/services/projects");
    const { addItems, addProgress, updateItem } = await import("@/lib/services/items");
    const p = createProject({ key: "PROG4", name: "进展测试" }, user);
    const r = addItems(p.id, [{ title: "准备投标材料" }], agent);
    addProgress(r.ids[0], "资质文件已盖章", agent, { percent: 40 });
    const after = updateItem(r.ids[0], { status: "done", evidence: "完整标书已上传采购平台，回执号 8821" }, agent).item;
    expect(after.needsReview).toBe(0);
    expect(() => addProgress(r.ids[0], "又补了一页", agent)).toThrow(/已关闭|重新打开/);
  });

  it("版本更迭：旧任务关闭并指向新任务，新任务可继续", async () => {
    const { createProject } = await import("@/lib/services/projects");
    const { addItems, supersedeItem, listItems, verifyChecklist } = await import("@/lib/services/items");
    const p = createProject({ key: "PROG5", name: "更迭测试" }, user);
    const r = addItems(p.id, [{ title: "交付 V1 版方案" }], agent);
    const s = supersedeItem(r.ids[0], { title: "交付 V2 版方案（客户新增合规要求）" }, agent);
    expect(s.old.status).toBe("done");
    expect(s.old.supersededBy).toBe(s.next.id);
    const open = listItems({ projectId: p.id, status: "open" });
    expect(open.items.map((i) => i.title)).toContain("交付 V2 版方案（客户新增合规要求）");
    expect(open.items.map((i) => i.title)).not.toContain("交付 V1 版方案");
    expect(() => supersedeItem(r.ids[0], { title: "再来一次" }, agent)).toThrow(/替换过/);
    expect(verifyChecklist(p.id).gaps.filter((g) => g.id === r.ids[0])).toEqual([]);
  });

  it("verify 能发现重复与缺完成标准", async () => {
    const { createProject } = await import("@/lib/services/projects");
    const { addItems, verifyChecklist } = await import("@/lib/services/items");
    const p = createProject({ key: "PROG6", name: "核对测试" }, user);
    addItems(p.id, [{ title: "整理客户回款台账", doneDefinition: "台账上线" }, { title: "整理客户回款台账" }], agent);
    const v = verifyChecklist(p.id);
    expect(v.gaps.some((g) => g.issue.includes("疑似重复"))).toBe(true);
    expect(v.gaps.some((g) => g.issue.includes("完成标准"))).toBe(true);
  });
});
