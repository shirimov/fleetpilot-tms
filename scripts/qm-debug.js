#!/usr/bin/env node
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://app.quickmanage.com', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[type="email"]', 'sh.shirimov@gmail.com');
  await page.fill('input[type="password"]', 'Turkmen1991@');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  const token = 'Bearer ' + await page.evaluate(() => localStorage.getItem('token'));

  // Get all 11 carriers
  const carriersRes = await page.evaluate(async (tok) => {
    const r = await fetch('https://api.quickmanage.com/api/carriers', { headers: { 'Authorization': tok } });
    return r.json();
  }, token);

  const carriers = carriersRes.data || [];
  console.log('Carriers:', carriers.map(c => c.carrier_name).join(', '));

  // Try first active carrier — no body filter, just get any trips
  const c = carriers[0];
  console.log(`\nTrying ${c.carrier_name} (${c.id})`);

  // Try different endpoints
  const endpoints = [
    `https://api.quickmanage.com/api/trips/es?carrier_id=${c.id}&limit=5&page=1`,
    `https://api.quickmanage.com/api/trips?carrier_id=${c.id}&limit=5`,
    `https://api.quickmanage.com/api/trips/es?carrier_id=${c.id}&limit=5`,
  ];

  for (const url of endpoints) {
    const res = await page.evaluate(async ({ url, tok }) => {
      const r = await fetch(url, {
        method: url.includes('/es') ? 'POST' : 'GET',
        headers: { 'Authorization': tok, 'Content-Type': 'application/json' },
        body: url.includes('/es') ? JSON.stringify({}) : undefined
      });
      const text = await r.text();
      return text.substring(0, 600);
    }, { url, tok: token });
    console.log(`\n${url}\n${res}`);
  }

  await browser.close();
}

run().catch(e => console.error(e.message));
