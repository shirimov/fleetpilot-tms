import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --webpack --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/tasks',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
