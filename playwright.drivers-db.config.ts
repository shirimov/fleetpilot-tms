import { defineConfig } from "playwright/test";
export default defineConfig({
  testDir: "./tests/integration",
  testMatch: "drivers-database.spec.ts",
  workers: 1,
  fullyParallel: false,
  reporter: "line",
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:3124" },
});
