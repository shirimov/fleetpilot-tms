#!/usr/bin/env node
const { chromium } = require('playwright');

async function getWeeklyStats(page, companyName) {
  // Click Market Statistics
  await page.click('text=Market Statistics').catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `/root/.openclaw/workspace/memory/qm-${companyName}-market.png` });

  let text = await page.innerText('body');
  let dollars = [...text.matchAll(/\$[\d,]+(\.\d{2})?/g)].map(m => m[0]);
  let lines = text.split('\n').filter(l => l.includes('$') || l.match(/\d{3,}/)).slice(0, 40);
  console.log(`\n=== ${companyName} - Market Statistics ===`);
  console.log('Amounts:', [...new Set(dollars)].slice(0, 20).join(', '));
  console.log('Lines:', lines.map(l => l.trim()).join('\n'));

  // Click Operations
  await page.click('text=Operations').catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `/root/.openclaw/workspace/memory/qm-${companyName}-ops.png` });

  text = await page.innerText('body');
  dollars = [...text.matchAll(/\$[\d,]+(\.\d{2})?/g)].map(m => m[0]);
  lines = text.split('\n').filter(l => l.includes('$') || l.match(/week|Week|gross|Gross|revenue|Revenue/i)).slice(0, 40);
  console.log(`\n=== ${companyName} - Operations ===`);
  console.log('Amounts:', [...new Set(dollars)].slice(0, 20).join(', '));
  console.log('Lines:', lines.map(l => l.trim()).join('\n'));
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();

  await page.goto('https://app.quickmanage.com', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[type="email"]', 'sh.shirimov@gmail.com');
  await page.fill('input[type="password"]', 'Turkmen1991@');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // 1-9 Transportation
  await page.click('text=MARYBEG LLC').catch(() => {});
  await page.waitForTimeout(1000);
  await page.click('text=1-9 Transportation Inc').catch(() => {});
  await page.waitForTimeout(3000);
  await getWeeklyStats(page, '19');

  // Go back to overview then switch to Caribe
  await page.goto('https://app.quickmanage.com/dashboard/overview', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.click('text=1-9 Transportation Inc').catch(() => {});
  await page.waitForTimeout(500);
  await page.click('text=Caribe Transport Inc').catch(() => {});
  await page.waitForTimeout(3000);
  await getWeeklyStats(page, 'caribe');

  await browser.close();
}

run().catch(e => console.error(e.message));
