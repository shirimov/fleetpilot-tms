import { defineConfig } from 'playwright/test';
import { assertDisposableIsolation } from './assert-isolation';

const selected = process.env.DISPOSABLE_CASE;
if (selected !== 'tasks' && selected !== 'fuel') throw new Error('DISPOSABLE_CASE_REFUSED');
assertDisposableIsolation(selected);
const cases = {
  tasks: 'task-authenticated-acceptance.case.ts',
  fuel: 'fuel-authenticated-acceptance.case.ts',
} as const;
export default defineConfig({
  testDir: '.',
  testMatch: cases[selected],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  timeout: 90_000,
  globalTimeout: 180_000,
  outputDir: '/tmp/disposable-results',
  reporter: [['line'], ['json', { outputFile: '/tmp/disposable-report.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: { chromiumSandbox: true },
  },
  webServer: {
    command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/tasks',
    reuseExistingServer: false,
    timeout: 60_000,
    // Inherit ONLY the host's env -i allowlist, including the exact DB URL.
    env: Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
  },
});
