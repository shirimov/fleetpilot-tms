#!/usr/bin/env node
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();

  let tripsResponseData = null;

  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/trips/es') || url.includes('/trips/weekly') || url.includes('/trips/stats')) {
      try {
        const json = await res.json();
        console.log(`TRIPS API: ${url}`);
        console.log(JSON.stringify(json).substring(0, 1000));
        tripsResponseData = json;
      } catch {}
    }
  });

  await page.goto('https://app.quickmanage.com', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[type="email"]', 'sh.shirimov@gmail.com');
  await page.fill('input[type="password"]', 'Turkmen1991@');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // Switch to 1-9 Transportation
  await page.click('text=MARYBEG LLC').catch(() => {});
  await page.waitForTimeout(1000);
  await page.click('text=1-9 Transportation Inc').catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/qm-19.png' });

  // Go to trips list page — click in sidebar
  const links = await page.$$('a');
  const linkTexts = await Promise.all(links.map(l => l.innerText().catch(() => '')));
  console.log('Nav links:', linkTexts.filter(t => t.trim()).slice(0, 30).join(' | '));

  // Try clicking Trips in sidebar
  await page.click('a:has-text("Trips")').catch(() => {});
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/qm-trips.png' });

  // Get page text and find dollar amounts
  const text = await page.innerText('body');
  const dollarAmounts = [...text.matchAll(/\$[\d,]+(\.\d{2})?/g)].map(m => m[0]);
  const weekAmounts = [...text.matchAll(/Week\s*\d+[^\n]*\$[\d,]+/gi)].map(m => m[0]);

  console.log('\n=== Dollar amounts on page ===');
  console.log([...new Set(dollarAmounts)].slice(0, 30).join(', '));
  
  console.log('\n=== Week references ===');
  console.log(weekAmounts.join('\n'));

  // Print lines with revenue info
  const lines = text.split('\n').filter(l => 
    l.includes('$') || l.includes('gross') || l.includes('Gross') || 
    l.includes('Total') || l.includes('Week') || l.includes('Revenue')
  );
  console.log('\n=== Relevant lines ===');
  lines.slice(0, 40).forEach(l => console.log(l.trim()));

  // Now switch to Caribe
  await page.goto('https://app.quickmanage.com/dashboard/overview', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.click('text=1-9 Transportation Inc').catch(() => {});
  await page.waitForTimeout(1000);
  await page.click('text=Caribe Transport Inc').catch(() => {});
  await page.waitForTimeout(3000);
  await page.click('a:has-text("Trips")').catch(() => {});
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/qm-caribe.png' });

  const text2 = await page.innerText('body');
  const dollars2 = [...text2.matchAll(/\$[\d,]+(\.\d{2})?/g)].map(m => m[0]);
  console.log('\n=== Caribe dollar amounts ===');
  console.log([...new Set(dollars2)].slice(0, 30).join(', '));

  await browser.close();
}

run().catch(e => console.error(e.message));
