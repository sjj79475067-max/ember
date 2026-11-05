import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

beforeAll(async () => {
  process.env.DATABASE_URL = "file:" + path.join(mkdtempSync(path.join(tmpdir(), "ember-test-")), "t.db");
  const { sqlite } = await import("@/lib/db");
  const fs = await import("node:fs");
  const dir = path.join(process.cwd(), "drizzle");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const txt = fs.readFileSync(path.join(dir, f), "utf8");
    for (const chunk of txt.split("--> statement-breakpoint")) if (chunk.trim()) sqlite.exec(chunk);
  }
});

const agent = { type: "agent" as const, name: "test-agent" };
const user = { type: "user" as const, name: "owner" };

describe("条例限制与门禁", () => {
  it("agent 提议的条例是待批准，不拦截任何操作", async () => {
    const { upsertPolicy, policyGate } = await import("@/lib/services/policies");
    const p = upsertPolicy({ title: "agent 提议", bodyMd: "正文", required: true, appliesToTools: "checklist_add" }, agent);
    expect(p.status).toBe("pending");
    expect(policyGate(null, "checklist_add", "any-agent")).toBeNull();
  });

  it("必读条例必须限定到具体工具，除非显式 scope_mode=all", async () => {
    const { upsertPolicy } = await import("@/lib/services/policies");
    expect(() => upsertPolicy({ title: "不限工具", bodyMd: "x", required: true }, user)).toThrow(/applies_to_tools/);
    const p = upsertPolicy({ title: "全站", bodyMd: "x", required: true, scopeMode: "all" }, user);
    expect(p.scopeMode).toBe("all");
  });

  it("正文长度上限", async () => {
    const { upsertPolicy } = await import("@/lib/services/policies");
    expect(() => upsertPolicy({ title: "长", bodyMd: "a".repeat(2001) }, user)).toThrow(/2000/);
  });

  it("只有生效且被门禁覆盖的写操作会被拦截；读操作不拦", async () => {
    const { upsertPolicy, policyGate } = await import("@/lib/services/policies");
    const p = upsertPolicy({ title: "改任务要证据", bodyMd: "x", required: true, appliesToTools: "checklist_update" }, user);
    const hit = (t: string) => (policyGate(null, t, "a1")?.policies ?? []).some((x) => x.id === p.id);
    expect(hit("checklist_update")).toBe(true);
    expect(hit("checklist_add")).toBe(false);
    expect(hit("project_list")).toBe(false);
  });

  it("agent 不能批准、不能废止", async () => {
    const { upsertPolicy, approvePolicy, retirePolicy } = await import("@/lib/services/policies");
    const p = upsertPolicy({ title: "待批", bodyMd: "x", required: true, appliesToTools: "checklist_add" }, agent);
    expect(() => approvePolicy(p.id, agent)).toThrow(/批准/);
    expect(() => retirePolicy(p.id, agent)).toThrow(/网页/);
    const a = approvePolicy(p.id, user);
    expect(a.status).toBe("active");
  });

  it("改写内容升版本并让原有确认失效", async () => {
    const { upsertPolicy, ackPolicy, policyGate } = await import("@/lib/services/policies");
    const p = upsertPolicy({ title: "版本", bodyMd: "v1", required: true, appliesToTools: "meeting_import" }, user);
    ackPolicy(p.id, "ag");
    const hit = () => (policyGate(null, "meeting_import", "ag")?.policies ?? []).some((x) => x.id === p.id);
    expect(hit()).toBe(false);
    upsertPolicy({ id: p.id, title: "版本", bodyMd: "v2", required: true, appliesToTools: "meeting_import" }, user);
    expect(hit()).toBe(true);
  });

  it("过期条例自动失效", async () => {
    const { upsertPolicy, policyGate } = await import("@/lib/services/policies");
    const p = upsertPolicy({ title: "过期", bodyMd: "x", required: true, appliesToTools: "note_save", expiresAt: Math.floor(Date.now() / 1000) - 60 }, user);
    console.log("GATE", JSON.stringify(policyGate(null, "note_save", "nobody")), p.id);
    expect((policyGate(null, "note_save", "nobody")?.policies ?? []).some((x) => x.id === p.id)).toBe(false);
  });
});

describe("收件箱与项目隔离", () => {
  it("未指定项目的内容进入收件箱，计为待分拣", async () => {
    const { getInbox, createProject } = await import("@/lib/services/projects");
    const { addItems, progressFor, moveItem } = await import("@/lib/services/items");
    const inbox = getInbox();
    const p = createProject({ key: "T1", name: "测试项目一" }, user);
    const r = addItems(inbox.id, [{ title: "未归属任务" }], agent);
    expect(progressFor(p.id).total).toBe(0);
    const mv = moveItem(r.ids[0], p.id, agent);
    expect(mv.project.key).toBe("T1");
    expect(progressFor(p.id).total).toBe(1);
  });

  it("项目代号不区分大小写，且不存在的项目会报错而不是误写", async () => {
    const { createProject, resolveProjectOrNull } = await import("@/lib/services/projects");
    createProject({ key: "CLIENT-X", name: "客户X" }, user);
    expect(resolveProjectOrNull("client-x")?.key).toBe("CLIENT-X");
    expect(() => resolveProjectOrNull("NOPE")).toThrow(/找不到项目/);
  });

  it("重复代号被拒绝", async () => {
    const { createProject } = await import("@/lib/services/projects");
    expect(() => createProject({ key: "t1", name: "重复" }, user)).toThrow(/重复/);
  });
});
