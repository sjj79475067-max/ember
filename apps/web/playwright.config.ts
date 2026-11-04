import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", screenshot: "only-on-failure" },
  reporter: [["list"]],
});
