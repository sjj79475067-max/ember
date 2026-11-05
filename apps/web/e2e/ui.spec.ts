import { test, expect } from "@playwright/test";

// 默认指向开发测试实例（3100），不要对正式实例（3000）跑
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.ADMIN_EMAIL ?? "me@example.com";
const PASS = process.env.ADMIN_PASS ?? "ember12345";

test.use({ storageState: { cookies: [], origins: [] } });

test("登录后能浏览主要页面", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole("button", { name: /登录|创建并进入/ }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 40000 });
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();

  for (const [path, heading] of [
    ["/projects", "项目"],
    ["/meetings", "会议档案"],
    ["/files", "资料位置"],
    ["/inbox", "提醒"],
    ["/policies", "条例"],
    ["/notes", "知识库"],
    ["/connect", "接入 Agent"],
    ["/settings", "设置"],
  ]) {
    await page.goto(`${BASE}${path}`);
    await expect(page.locator("h1").first()).toContainText(heading, { timeout: 10000 });
  }
});

test("命令面板可用 ⌘K 打开并搜索", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole("button", { name: /登录|创建并进入/ }).click();
  await page.waitForURL(`${BASE}/`);
  await page.keyboard.press("Meta+k");
  await expect(page.getByPlaceholder("搜索项目、任务、会议、笔记… 或输入动作")).toBeVisible();
  await page.getByPlaceholder("搜索项目、任务、会议、笔记… 或输入动作").fill("门户");
  await page.waitForTimeout(600);
});

test("深色模式与移动端无横向滚动", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole("button", { name: /登录|创建并进入/ }).click();
  await page.waitForURL(`${BASE}/`);
  await page.evaluate(() => { localStorage.setItem("ember-theme", "dark"); document.documentElement.classList.add("dark"); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/projects`);
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(400);
});

test("项目看板：总览、需求、计划、看板可用，手机宽度不挤压", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole("button", { name: /登录|创建并进入/ }).click();
  await page.waitForURL(`${BASE}/`);
  const key = "E2E" + Date.now().toString().slice(-5);
  const r = await page.request.post(`${BASE}/api/v1/call/project_create`, { data: { key, name: "看板测试", template: "app" } });
  const id = (await r.json()).data.project.id;
  await page.goto(`${BASE}/p/${id}`);
  await expect(page.getByText("能不能发「上线」")).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("ICP 备案").first()).toBeVisible();
  await page.goto(`${BASE}/p/${id}?tab=requirements`);
  await expect(page.getByText("提了就要有着落")).toBeVisible();
  await page.goto(`${BASE}/p/${id}?tab=plan`);
  await page.getByRole("button", { name: "依赖图" }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 20000 });
  await page.goto(`${BASE}/p/${id}?tab=checklist`);
  await page.getByTitle("看板").click();
  await expect(page.getByText("进行中").first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/p/${id}`);
  await expect(page.getByText("能不能发「上线」")).toBeVisible({ timeout: 20000 });
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.querySelector("main")!.getBoundingClientRect().width]);
  expect(w[0]).toBeLessThanOrEqual(392);
  expect(w[1]).toBeGreaterThan(380); // 主内容占满屏宽，不被顶栏挤成一条
});

test("事务页：日历、台账、采购、合作、行程可用", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole("button", { name: /登录|创建并进入/ }).click();
  await page.waitForURL(`${BASE}/`);
  const now = Math.floor(Date.now() / 1000);
  await page.request.post(`${BASE}/api/v1/call/asset_save`, { data: { kind: "domain", name: "e2e 域名", identifier: `e2e${now}.cn`, valid_until: now + 5 * 86400 } });
  await page.request.post(`${BASE}/api/v1/call/purchase_save`, { data: { title: `e2e 键盘 ${now}` } });
  for (const [tab, text] of [["calendar", "接下来"], ["assets", "e2e 域名"], ["purchases", `e2e 键盘 ${now}`], ["deals", "新合作"], ["trips", "新行程"]] as const) {
    await page.goto(`${BASE}/affairs?tab=${tab}`);
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 20000 });
  }
  const ics = await page.request.post(`${BASE}/api/ui/calendar`, { data: { name: "e2e" } });
  const tok = (await ics.json()).token;
  const feed = await page.request.get(`${BASE}/api/calendar/${tok}.ics`);
  expect(feed.status()).toBe(200);
  expect(await feed.text()).toContain("BEGIN:VCALENDAR");
  expect((await page.request.get(`${BASE}/api/calendar/cal_wrong.ics`)).status()).toBe(404);
});

test("今日与复盘：加入今天、在等别人、完成、保存复盘", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole("button", { name: /登录|创建并进入/ }).click();
  await page.waitForURL(`${BASE}/`);
  const key = `TD${Date.now().toString(36).slice(-4).toUpperCase()}`;
  const pr = await page.request.post(`${BASE}/api/v1/call/project_create`, { data: { key, name: `今日测试 ${key}` } });
  const pid = (await pr.json()).data.project.id;
  const add = await page.request.post(`${BASE}/api/v1/call/checklist_add`, { data: { project: pid, items: [{ title: `e2e 今天要写的文档 ${key}` }, { title: `e2e 等客户回复 ${key}` }] } });
  const ids = (await add.json()).data.ids as string[];
  await page.goto(`${BASE}/today`);
  await expect(page.locator("h1").first()).toContainText("今日", { timeout: 20000 });
  await page.getByRole("button", { name: "加入今天" }).click();
  await page.getByPlaceholder("搜索事项或项目").fill(key);
  await page.getByRole("button", { name: new RegExp(`e2e 今天要写的文档 ${key}`) }).click();
  await page.getByRole("button", { name: /^加入 1$/ }).click();
  await expect(page.getByRole("link", { name: `e2e 今天要写的文档 ${key}` })).toBeVisible();
  // 在等别人
  await page.request.post(`${BASE}/api/v1/call/checklist_update`, { data: { item_id: ids[1], waiting_for: "e2e 客户" } });
  await page.reload();
  await expect(page.getByText("e2e 客户").first()).toBeVisible();
  // 完成要写结果
  await page.locator("li", { hasText: `e2e 今天要写的文档 ${key}` }).getByTitle("完成").click();
  await page.getByPlaceholder(/已提交并审核通过/).fill("文档已写完并发到群里，链接 https://x.cn/doc");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByRole("link", { name: `e2e 今天要写的文档 ${key}` })).toHaveCount(0, { timeout: 10000 });
  // 复盘
  await page.goto(`${BASE}/review`);
  await expect(page.getByRole("heading", { name: "定下周三件事" })).toBeVisible({ timeout: 20000 });
  await page.getByPlaceholder("写一件事，或从右边选已有事项").first().fill(`e2e 本周重点 ${key}`);
  await page.getByRole("button", { name: "保存复盘" }).click();
  await expect(page.getByText("已确认。可以随时改。")).toBeVisible({ timeout: 10000 });
  await page.goto(`${BASE}/today`);
  await expect(page.getByText(`e2e 本周重点 ${key}`)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/today`);
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(392);
});

test("随手记：网页输入 → 草稿 → 确认落到项目；快捷指令投递", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole("button", { name: /登录|创建并进入/ }).click();
  await page.waitForURL(`${BASE}/`);
  const tag = Date.now().toString(36).slice(-5);
  await page.goto(`${BASE}/capture`);
  await expect(page.locator("h1").first()).toContainText("随手记", { timeout: 20000 });
  await page.getByPlaceholder(/比如：/).fill(`e2e 整理报销单 ${tag}；e2e 给设计师发需求 ${tag}`);
  await page.getByRole("button", { name: "整理" }).click();
  await expect(page.locator(`input[value="e2e 整理报销单 ${tag}"]`)).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "全部确认" }).first().click();
  await expect(page.getByText("已落实").first()).toBeVisible({ timeout: 10000 });
  // 快捷指令投递：没有密钥 401；有密钥进待审
  expect((await page.request.post(`${BASE}/api/capture`, { data: { text: "x" } })).status()).toBe(401);
  const k = await page.request.post(`${BASE}/api/ui/channels`, { data: { action: "key_mint" } });
  const key = (await k.json()).key;
  const r = await page.request.post(`${BASE}/api/capture`, { data: { text: `e2e 快捷指令发来的 ${tag}`, id: `sc-${tag}` }, headers: { authorization: `Bearer ${key}` } });
  expect((await r.json()).message).toMatch(/收到/);
  const again = await page.request.post(`${BASE}/api/capture?key=${key}`, { data: { text: `e2e 快捷指令发来的 ${tag}`, id: `sc-${tag}` } });
  expect(again.status()).toBe(200);
  await page.goto(`${BASE}/capture`);
  await expect(page.locator(`input[value="e2e 快捷指令发来的 ${tag}"]`)).toHaveCount(1, { timeout: 20000 });
  await page.goto(`${BASE}/settings`);
  await expect(page.getByText("飞书机器人", { exact: true })).toBeVisible({ timeout: 20000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/capture`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(392);
});
