import { defineConfig } from 'playwright/test';

const database = new URL(process.env.DATABASE_URL ?? 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || !database.pathname.endsWith('_test')) {
  throw new Error('Fuel workflow requires a dedicated local *_test database.');
}

export default defineConfig({
  testDir: './tests/ui',
  testMatch: 'fuel-reconciliation.spec.ts',
  workers: 1,
  timeout: 60000,
  reporter: 'line',
  outputDir: '.data/fuel-workflow-results',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  webServer: {
    // Run npm run build with PLAYWRIGHT=1 first; exercise the compiled application.
    command: 'npm run start -- --hostname 127.0.0.1 --port 3100',
    env: { PLAYWRIGHT: '1', EMAIL_AUTH_ENABLED: 'true', AUTH_URL: 'http://127.0.0.1:3100', AUTH_SECRET: 'fleetpilot-playwright-only-not-production', AUTH_TRUST_HOST: 'true', TELEGRAM_ENABLED: 'false' },
    url: 'http://127.0.0.1:3100/login',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
