#!/usr/bin/env node
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  let token = null;
  let allCarriers = null;

  page.on('response', async (response) => {
    const url = response.url();
    const authHeader = response.request().headers()['authorization'];
    if (authHeader && !token) {
      token = authHeader;
      console.log('Got token:', token.substring(0, 50) + '...');
    }
    if (url.includes('/api/carriers')) {
      try {
        const json = await response.json();
        allCarriers = json;
        console.log('Carriers response:', JSON.stringify(json).substring(0, 1000));
      } catch {}
    }
    if (url.includes('/api/trips')) {
      try {
        const json = await response.json();
        console.log('Trips URL:', url);
        console.log('Trips data:', JSON.stringify(json).substring(0, 500));
      } catch {}
    }
  });

  await page.goto('https://app.quickmanage.com', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[type="email"]', 'sh.shirimov@gmail.com');
  await page.fill('input[type="password"]', 'Turkmen1991@');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // Check localStorage for token
  const storage = await page.evaluate(() => {
    const items = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      items[key] = localStorage.getItem(key);
    }
    return items;
  });
  console.log('\nLocalStorage keys:', Object.keys(storage));
  const tokenKey = Object.keys(storage).find(k => k.includes('token') || k.includes('auth') || k.includes('jwt'));
  if (tokenKey) console.log('Token from storage:', storage[tokenKey].substring(0, 100));

  // Try switching companies
  await page.goto('https://app.quickmanage.com/dashboard/overview', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Look for company switcher
  const bodyText = await page.innerText('body').catch(() => '');
  const lines = bodyText.split('\n').filter(l => l.trim().length > 2).slice(0, 50);
  console.log('\nTop of page text:', lines.join(' | '));

  await page.screenshot({ path: '/tmp/qm-overview.png' });
  console.log('\nScreenshot saved');

  await browser.close();
}

run().catch(e => console.error(e.message));
