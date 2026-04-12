#!/usr/bin/env node
const { chromium } = require('playwright');

// Carrier IDs found
const CARRIERS = {
  '1-9 Transportation Inc': '3fa9f398-e5dd-49b6-8528-18217b9e9411',
  'Caribe Transport Inc':   '964e6cf7-9d60-4aba-af76-4212a6e28071',
  'TECCA LLC':              null, // will find
};

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  const revenueData = {};
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/reports') || url.includes('/api/revenue') || url.includes('/api/payroll') || url.includes('/api/statements') || url.includes('/api/trips/es')) {
      try {
        const body = await res.text();
        console.log(`RESPONSE: ${url}\n${body.substring(0, 800)}\n---`);
      } catch {}
    }
  });

  await page.goto('https://app.quickmanage.com', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[type="email"]', 'sh.shirimov@gmail.com');
  await page.fill('input[type="password"]', 'Turkmen1991@');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  const token = 'Bearer ' + await page.evaluate(() => localStorage.getItem('token'));

  // Switch to 1-9 Transportation
  await page.click('text=MARYBEG LLC').catch(() => {});
  await page.waitForTimeout(1000);
  await page.click('text=1-9 Transportation Inc').catch(() => {});
  await page.waitForTimeout(2000);

  // Navigate to reports page
  const reportUrls = [
    '/dashboard/reports',
    '/dashboard/payroll',
    '/dashboard/revenue',
    '/dashboard/statements',
  ];

  for (const path of reportUrls) {
    await page.goto('https://app.quickmanage.com' + path, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }

  // Try the reports API directly with auth token
  const carrierId = '3fa9f398-e5dd-49b6-8528-18217b9e9411';
  const yearStart = new Date(2026, 0, 1).toISOString();
  const now = new Date().toISOString();

  const reportEndpoints = [
    `https://api.quickmanage.com/api/reports/revenue?carrier_id=${carrierId}&start_date=${yearStart}&end_date=${now}`,
    `https://api.quickmanage.com/api/reports?carrier_id=${carrierId}&type=revenue&start_date=${yearStart}&end_date=${now}`,
    `https://api.quickmanage.com/api/trips/report?carrier_id=${carrierId}&start_date=${yearStart}&end_date=${now}`,
    `https://api.quickmanage.com/api/statements/report?carrier_id=${carrierId}&start_date=${yearStart}&end_date=${now}`,
  ];

  for (const url of reportEndpoints) {
    const res = await page.evaluate(async ({ url, tok }) => {
      const r = await fetch(url, { headers: { 'Authorization': tok } });
      return { status: r.status, body: await r.text() };
    }, { url, tok: token });
    console.log(`\nGET ${url}\nStatus: ${res.status}\n${res.body.substring(0, 500)}`);
  }

  await browser.close();
}

run().catch(e => console.error(e.message));
