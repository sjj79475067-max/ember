import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

beforeAll(async () => {
  process.env.DATABASE_URL = "file:" + path.join(mkdtempSync(path.join(tmpdir(), "ember-cap-")), "t.db");
  process.env.EMBER_DISABLE_CHANNELS = "1";
  const { sqlite } = await import("@/lib/db");
  const dir = path.join(process.cwd(), "drizzle");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const chunk of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) if (chunk.trim()) sqlite.exec(chunk);
  }
  const { createProject, updateProject, ensureInbox } = await import("@/lib/services/projects");
  ensureInbox();
  createProject({ key: "NOTE", name: "记账App" }, user);
  updateProject("NOTE", { aliases: "记账" } as never, user);
  createProject({ key: "SITE", name: "官网" }, user);
});

const user = { type: "user" as const, name: "owner" };
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10);
const ymd = (sec: number | null) => (sec ? new Date(sec * 1000).toLocaleDateString("sv-SE") : null);

describe("口语日期", () => {
  it("今天/明天/后天/周X/下周X/X月X号/N天后/月底", async () => {
    const { parseCnDate } = await import("@/lib/capture/parse");
    const now = at(2026, 11, 6); // 周五
    expect(ymd(parseCnDate("明天给报价", now))).toBe("2026-11-07");
    expect(ymd(parseCnDate("后天", now))).toBe("2026-11-08");
    expect(ymd(parseCnDate("周三前", now))).toBe("2026-11-11");
    expect(ymd(parseCnDate("下周三", now))).toBe("2026-11-11");
    expect(ymd(parseCnDate("周五", now))).toBe("2026-11-06");
    expect(ymd(parseCnDate("12月3号交", now))).toBe("2026-12-03");
    expect(ymd(parseCnDate("3天后", now))).toBe("2026-11-09");
    expect(ymd(parseCnDate("月底前", now))).toBe("2026-11-30");
    expect(ymd(parseCnDate("20号", now))).toBe("2026-11-20");
    expect(parseCnDate("有空再说", now)).toBeNull();
  });
});

describe("规则整理（没配 AI）", () => {
  it("一句话多件事拆开、按名称/别名认项目、认不出留空、识别采购/在等", async () => {
    const { parseByRules } = await import("@/lib/capture/parse");
    const { getProject } = await import("@/lib/services/projects");
    const note = getProject("NOTE")!, site = getProject("SITE")!;
    const d = parseByRules("记账那边明天把隐私政策写完；官网首页改版下周三上线。买个Type-C扩展坞预算300元。等王经理回复报价", at(2026, 11, 6));
    expect(d.length).toBe(4);
    expect(d[0].projectId).toBe(note.id);
    expect(parseByRules("记账 App 加导出功能")[0].projectId).toBe(note.id); // 空格不影响
    expect(parseByRules("记账app加导出功能")[0].projectId).toBe(note.id);
    expect(ymd(d[0].dueAt)).toBe("2026-11-07");
    expect(d[1].projectId).toBe(site.id);
    expect(d[2].type).toBe("purchase");
    expect(d[2].fields.budgetYuan).toBe(300);
    expect(d[3].waitingFor).toBe("王经理");
    expect(d[3].projectId).toBeNull();
  });

  it("说的是已有事项的进展/办完了 → progress，不新建", async () => {
    const { addItems } = await import("@/lib/services/items");
    const { getProject } = await import("@/lib/services/projects");
    const { parseByRules } = await import("@/lib/capture/parse");
    const r = addItems(getProject("NOTE")!.id, [{ title: "ICP 备案" }], user);
    const d = parseByRules("记账的ICP 备案审核通过了");
    expect(d[0].type).toBe("progress");
    expect(d[0].targetItemId).toBe(r.ids[0]);
    expect(d[0].done).toBe(true);
  });

  it("长文按会议归档", async () => {
    const { parseByRules } = await import("@/lib/capture/parse");
    const long = "会议：官网改版\n" + "讨论了首页结构，确定用三栏布局，下周给设计稿。".repeat(20);
    const d = parseByRules(long);
    expect(d.length).toBe(1);
    expect(d[0].type).toBe("meeting");
  });
});

describe("待审与落库", () => {
  it("收消息只生成草稿；同一条消息不重复；确认后落到项目，幂等", async () => {
    const { ingestEnvelope, confirmDraft } = await import("@/lib/capture/service");
    const { db, s } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const before = db.select().from(s.items).all().length;
    const r = await ingestEnvelope({ channel: "http", externalId: "m1", sender: "x", kind: "text", text: "官网加一个联系我们页面，周三前" });
    expect(r.drafts.length).toBe(1);
    expect(db.select().from(s.items).all().length).toBe(before); // 没确认不落库
    const dup = await ingestEnvelope({ channel: "http", externalId: "m1", sender: "x", kind: "text", text: "官网加一个联系我们页面，周三前" });
    expect(dup.duplicate).toBe(true);
    const c1 = await confirmDraft(r.drafts[0].id, user);
    const c2 = await confirmDraft(r.drafts[0].id, user);
    expect(c2.already).toBe(true);
    const it = db.select().from(s.items).where(eq(s.items.id, c1.draft.resultId)).get()!;
    expect(it.title).toContain("联系我们");
    expect(it.sourceRef).toBe(`capture:${r.capture.id}`);
    expect(c1.href).toContain(it.projectId);
  });

  it("项目拿不准 → 进收件箱；改项目后确认落到所选项目；进展落在原事项", async () => {
    const { ingestEnvelope, confirmDraft } = await import("@/lib/capture/service");
    const { getInbox, getProject } = await import("@/lib/services/projects");
    const { addItems } = await import("@/lib/services/items");
    const { db, s } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const r = await ingestEnvelope({ channel: "web", externalId: "m2", sender: "x", kind: "text", text: "整理一下发票；给张总打电话" });
    const a = await confirmDraft(r.drafts[0].id, user);
    expect(db.select().from(s.items).where(eq(s.items.id, a.draft.resultId)).get()!.projectId).toBe(getInbox().id);
    const b = await confirmDraft(r.drafts[1].id, user, { projectId: getProject("SITE")!.id });
    expect(db.select().from(s.items).where(eq(s.items.id, b.draft.resultId)).get()!.projectId).toBe(getProject("SITE")!.id);
    expect(db.select().from(s.captures).where(eq(s.captures.id, r.capture.id)).get()!.status).toBe("done");

    const t = addItems(getProject("NOTE")!.id, [{ title: "微信支付商户号申请" }], user);
    const p = await ingestEnvelope({ channel: "web", externalId: "m3", sender: "x", kind: "text", text: "记账的微信支付商户号申请已提交，等腾讯审核" });
    expect(p.drafts[0].type).toBe("progress");
    await confirmDraft(p.drafts[0].id, user);
    const after = db.select().from(s.items).where(eq(s.items.id, t.ids[0])).get()!;
    expect(after.detailMd).toContain("已提交");
    expect(after.waitingFor).toBe("腾讯");
    expect(db.select().from(s.items).all().filter((i) => i.title.includes("商户号")).length).toBe(1);
  });

  it("采购/行程/会议各落到对应地方；行程没日期改记一条待办", async () => {
    const { ingestEnvelope, confirmDraft, editDraft } = await import("@/lib/capture/service");
    const { db, s } = await import("@/lib/db");
    const r = await ingestEnvelope({ channel: "web", externalId: "m4", sender: "x", kind: "text", text: "买个显示器预算2000元；去上海出差见客户" });
    const pur = await confirmDraft(r.drafts[0].id, user);
    expect(pur.draft.resultType).toBe("purchase");
    expect(db.select().from(s.purchases).all().some((x) => x.title.includes("显示器"))).toBe(true);
    const trip = await confirmDraft(r.drafts[1].id, user);
    expect(trip.draft.resultType).toBe("item"); // 没出发日期
    const r2 = await ingestEnvelope({ channel: "web", externalId: "m5", sender: "x", kind: "text", text: "下周二去杭州出差见客户" });
    editDraft(r2.drafts[0].id, { type: "trip" });
    const t2 = await confirmDraft(r2.drafts[0].id, user);
    expect(t2.draft.resultType).toBe("trip");
  });

  it("语音没配识别 → 失败并说明原因，不落库", async () => {
    const { ingestEnvelope } = await import("@/lib/capture/service");
    const r = await ingestEnvelope({ channel: "feishu", externalId: "v1", sender: "x", kind: "audio", audio: { data: Buffer.from("x"), mime: "audio/ogg", fileName: "a.opus" } });
    expect(r.capture.status).toBe("failed");
    expect(r.capture.error).toMatch(/语音识别/);
  });
});

describe("飞书适配器", () => {
  it("卡片：待确认有按钮、不确定有提示、处理后变绿且有查看链接", async () => {
    const { buildReviewCard } = await import("@/lib/capture/feishu");
    const view = { captureId: "cap_1", source: "原话", webUrl: "http://x/capture?id=cap_1", projects: [{ id: "p1", name: "官网" }], drafts: [
      { id: "d1", type: "item", typeLabel: "待办", title: "做首页", projectId: null, projectName: "", confidence: 0, dueAt: null, waitingFor: "", evidence: "原话", status: "pending" },
      { id: "d2", type: "item", typeLabel: "待办", title: "写文案", projectId: "p1", projectName: "官网", confidence: 90, dueAt: null, waitingFor: "", evidence: "", status: "pending" },
    ] };
    const card = JSON.stringify(buildReviewCard(view));
    expect(card).toContain('"schema":"2.0"');
    expect(card).toContain("未定项目");
    expect(card).toContain('{"a":"ok","d":"d1"}');
    expect(card).toContain("全部确认（2）");
    const done = buildReviewCard({ ...view, drafts: view.drafts.map((d) => ({ ...d, status: "confirmed", resultHref: "http://x/p/1" })) });
    expect(done.header.template).toBe("green");
    expect(JSON.stringify(done)).not.toContain('"a":"ok"');
  });

  it("动作解析", async () => {
    const { parseCardAction } = await import("@/lib/capture/feishu");
    expect(parseCardAction({ a: "ok", d: "d1" })).toEqual({ kind: "ok", draftId: "d1" });
    expect(parseCardAction('{"a":"proj","d":"d1"}', "p9")).toEqual({ kind: "proj", draftId: "d1", projectId: "p9" });
    expect(parseCardAction({ a: "all", c: "cap_1" })).toEqual({ kind: "all", captureId: "cap_1" });
    expect(parseCardAction({ a: "proj", d: "d1" })).toBeNull();
    expect(parseCardAction("garbage")).toBeNull();
  });

  it("绑定本人；陌生人消息不处理；本人发消息回审批卡；点确认落库并更新卡片；别人点无效", async () => {
    const { mintBindCode } = await import("@/lib/capture/feishu");
    const { onMessage, onCardAction } = await import("@/lib/capture/feishu-handlers");
    const { db, s } = await import("@/lib/db");
    const sent: Array<{ to: string; input: any }> = [];
    const updated: Array<{ id: string; card: any }> = [];
    const ch = {
      send: async (to: string, input: object) => { sent.push({ to, input }); return { messageId: `om_${sent.length}` }; },
      updateCard: async (id: string, card: object) => { updated.push({ id, card }); },
      downloadResource: async () => Buffer.from(""),
    };
    const msg = (sender: string, content: string, id: string) => ({ messageId: id, chatId: "oc_1", chatType: "p2p", senderId: sender, content, rawContentType: "text", resources: [] });
    await onMessage(msg("ou_me", "官网加个博客", "x0"), ch);
    expect(String(sent.at(-1)?.input.markdown)).toMatch(/还没绑定/);
    const code = mintBindCode();
    await onMessage(msg("ou_me", "绑定 000000", "x1"), ch);
    expect(String(sent.at(-1)?.input.markdown)).toMatch(/不对/);
    await onMessage(msg("ou_me", `绑定 ${code}`, "x2"), ch);
    expect(String(sent.at(-1)?.input.markdown)).toMatch(/绑定成功/);
    const n = sent.length;
    await onMessage({ ...msg("ou_stranger", "删掉所有项目", "x3"), chatType: "group" }, ch);
    expect(sent.length).toBe(n);
    expect(db.select().from(s.captures).all().some((c) => c.externalId === "x3")).toBe(false);
    await onMessage(msg("ou_me", "官网加个博客栏目", "x4"), ch);
    const card = sent.at(-1)!.input.card;
    expect(card).toBeTruthy();
    const cap = db.select().from(s.captures).all().find((c) => c.externalId === "x4")!;
    expect(cap.reviewRef).toBe(`om_${sent.length}`);
    const draft = db.select().from(s.captureDrafts).all().find((d) => d.captureId === cap.id)!;
    await onCardAction({ messageId: cap.reviewRef, operator: { openId: "ou_stranger" }, action: { value: { a: "ok", d: draft.id } } }, ch);
    expect(db.select().from(s.captureDrafts).all().find((d) => d.id === draft.id)!.status).toBe("pending");
    await onCardAction({ messageId: cap.reviewRef, operator: { openId: "ou_me" }, action: { value: { a: "ok", d: draft.id } } }, ch);
    expect(db.select().from(s.captureDrafts).all().find((d) => d.id === draft.id)!.status).toBe("confirmed");
    expect(updated.at(-1)!.card.header.template).toBe("green");
    // 今天
    await onMessage(msg("ou_me", "今天", "x5"), ch);
    expect(String(sent.at(-1)?.input.markdown)).toMatch(/今日/);
  });
});

describe("快捷指令密钥", () => {
  it("生成、校验、作废", async () => {
    const { mintCaptureKey, checkCaptureKey, revokeCaptureKey } = await import("@/lib/capture/http");
    const k = mintCaptureKey();
    expect(checkCaptureKey(k)).toBe(true);
    expect(checkCaptureKey(k + "x")).toBe(false);
    expect(checkCaptureKey(null)).toBe(false);
    revokeCaptureKey();
    expect(checkCaptureKey(k)).toBe(false);
  });
});
