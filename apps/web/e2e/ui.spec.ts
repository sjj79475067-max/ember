import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
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
