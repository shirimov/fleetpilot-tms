#!/usr/bin/env node
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  const captured = [];

  page.on('request', req => {
    const url = req.url();
    if (url.includes('api.quickmanage.com/api/')) {
      captured.push({
        url,
        method: req.method(),
        headers: req.headers(),
        body: req.postData()
      });
    }
  });

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('/trips') && url.includes('api.quickmanage.com')) {
      try {
        const body = await res.text();
        console.log(`\n=== TRIPS RESPONSE ===\nURL: ${url}\nStatus: ${res.status()}\nBody: ${body.substring(0, 1000)}`);
      } catch {}
    }
  });

  await page.goto('https://app.quickmanage.com', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[type="email"]', 'sh.shirimov@gmail.com');
  await page.fill('input[type="password"]', 'Turkmen1991@');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // Switch to Caribe Transport or 1-9 — find the company switcher
  const bodyText = await page.innerText('body');
  console.log('Looking for company switcher...');
  
  // Try clicking company name in header
  try {
    await page.click('text=MARYBEG LLC', { timeout: 3000 });
    await page.waitForTimeout(2000);
    const dropdownText = await page.innerText('body');
    const companyLines = dropdownText.split('\n').filter(l => 
      l.includes('Caribe') || l.includes('1-9') || l.includes('Tecca') || l.includes('Transport')
    );
    console.log('Company dropdown:', companyLines.slice(0, 10));
    
    // Click Caribe
    await page.click('text=Caribe Transport Inc', { timeout: 3000 }).catch(() => {});
    await page.click('text=1-9 Transportation', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('No company switcher found:', e.message);
  }

  // Navigate to trips
  await page.goto('https://app.quickmanage.com/dashboard/trips', { 
    waitUntil: 'domcontentloaded', timeout: 20000 
  }).catch(() => {});
  await page.waitForTimeout(5000);

  // Print all captured requests to trips
  const tripsReqs = captured.filter(r => r.url.includes('/trips'));
  console.log('\n=== TRIPS REQUESTS MADE ===');
  tripsReqs.forEach(r => {
    console.log(`${r.method} ${r.url}`);
    if (r.body) console.log('Body:', r.body.substring(0, 300));
    const relevantHeaders = Object.entries(r.headers)
      .filter(([k]) => k.toLowerCase().includes('auth') || k.toLowerCase().includes('csrf') || k.toLowerCase().includes('xsrf') || k === 'content-type')
      .reduce((a, [k,v]) => ({ ...a, [k]: v }), {});
    console.log('Auth headers:', JSON.stringify(relevantHeaders));
    console.log('---');
  });

  await page.screenshot({ path: '/tmp/qm-trips-page.png' });
  await browser.close();
}

run().catch(e => console.error(e.message));
