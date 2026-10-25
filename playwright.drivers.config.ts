import { defineConfig } from "playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "drivers-redesign.spec.ts",
  workers: 1,
  reporter: "line",
  use: { baseURL: "http://127.0.0.1:3124", trace: "retain-on-failure" },
});
