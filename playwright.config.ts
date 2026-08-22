import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'PLAYWRIGHT=1 EMAIL_AUTH_ENABLED=false AUTH_URL=http://127.0.0.1:3100 AUTH_SECRET=fleetpilot-playwright-only-not-production AUTH_TRUST_HOST=true npm run build && PLAYWRIGHT=1 EMAIL_AUTH_ENABLED=true AUTH_URL=http://127.0.0.1:3100 AUTH_SECRET=fleetpilot-playwright-only-not-production AUTH_TRUST_HOST=true npm run start -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/tasks',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
