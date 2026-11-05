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
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
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
