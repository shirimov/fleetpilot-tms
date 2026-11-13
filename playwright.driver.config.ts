import {defineConfig} from 'playwright/test';

// Uses the already verified production build. Explicit local synthetic DB is
// checked inside the spec; no auth bypass or response mocking is enabled.
export default defineConfig({
 testDir:'./tests/ui',testMatch:'driver-pool.spec.ts',workers:1,reporter:'line',
 use:{baseURL:'http://127.0.0.1:3100',trace:'off',launchOptions:{
  chromiumSandbox:true,
  ...(process.env.DRIVER_TEST_CHROME_PATH?{executablePath:process.env.DRIVER_TEST_CHROME_PATH}:{}),
 }},
 webServer:{
  command:'EMAIL_AUTH_ENABLED=true AUTH_URL=http://127.0.0.1:3100 AUTH_SECRET=fleetpilot-playwright-only-not-production AUTH_TRUST_HOST=true npm run start -- --hostname 127.0.0.1 --port 3100',
  url:'http://127.0.0.1:3100/login',reuseExistingServer:false,timeout:30000,
 },
});
