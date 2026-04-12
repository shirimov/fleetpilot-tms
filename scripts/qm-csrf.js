#!/usr/bin/env node
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  let csrfToken = null;
  let realTripsUrl = null;
  let realTripsBody = null;

  // Intercept the actual trips request that QM makes
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/api/trips')) {
      const headers = req.headers();
      if (headers['x-csrf-token']) csrfToken = headers['x-csrf-token'];
      if (headers['x-xsrf-token']) csrfToken = headers['x-xsrf-token'];
      realTripsUrl = url;
      try { realTripsBody = req.postData(); } catch {}
      console.log('Trips request URL:', url);
      console.log('Headers:', JSON.stringify(headers).substring(0, 500));
      console.log('Body:', realTripsBody?.substring(0, 300));
    }
  });

  await page.goto('https://app.quickmanage.com', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[type="email"]', 'sh.shirimov@gmail.com');
  await page.fill('input[type="password"]', 'Turkmen1991@');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // Navigate to trips page to trigger the real request
  await page.goto('https://app.quickmanage.com/dashboard/trips', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(5000);

  console.log('\nCSRF token found:', csrfToken);

  // Check cookies for CSRF
  const cookies = await context.cookies();
  const csrfCookie = cookies.find(c => c.name.toLowerCase().includes('csrf') || c.name.toLowerCase().includes('xsrf'));
  console.log('CSRF cookie:', csrfCookie);

  await page.screenshot({ path: '/tmp/qm-trips-page.png' });
  await browser.close();
}

run().catch(e => console.error(e.message));
