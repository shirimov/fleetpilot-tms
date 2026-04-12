#!/usr/bin/env node
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  const apiData = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api.quickmanage.com/api/')) {
      try {
        const json = await response.json();
        apiData.push({ url, data: json });
      } catch {}
    }
  });

  try {
    await page.goto('https://app.quickmanage.com', { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('input[type="email"]', 'sh.shirimov@gmail.com');
    await page.fill('input[type="password"]', 'Turkmen1991@');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    console.log('URL after login:', page.url());

    // Find and list all companies
    const companyData = apiData.filter(d => d.url.includes('carrier') || d.url.includes('compan') || d.url.includes('organization'));
    console.log('\n=== Companies/Carriers ===');
    companyData.forEach(d => console.log(d.url, '\n', JSON.stringify(d.data).substring(0, 300)));

    // Try trips endpoint directly for each known carrier
    const carrierIds = ['45f349d6-5bd2-469f-883c-c4037184d806'];
    
    // Check if there's a company switcher
    const bodyText = await page.innerText('body');
    const companyMatches = bodyText.match(/Caribe|1-9 Transportation|Tecca|Panther/gi);
    console.log('\nCompanies visible on page:', companyMatches ? [...new Set(companyMatches)] : 'none');

    // Navigate to trips page
    await page.goto('https://app.quickmanage.com/dashboard/trips', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);

    const tripsData = apiData.filter(d => d.url.includes('/trips'));
    console.log('\n=== Trips API calls ===');
    tripsData.forEach(d => console.log(d.url, '\n', JSON.stringify(d.data).substring(0, 1000)));

    // Try to find company list API
    const res = await page.evaluate(async () => {
      try {
        const r = await fetch('https://api.quickmanage.com/api/carriers', { credentials: 'include' });
        return await r.json();
      } catch(e) { return { error: e.message }; }
    });
    console.log('\n=== Carriers list ===', JSON.stringify(res).substring(0, 500));

    // Screenshot
    await page.screenshot({ path: '/tmp/qm-trips.png' });
    console.log('\nScreenshot: /tmp/qm-trips.png');

    // Print all API calls made
    console.log('\n=== All API calls ===');
    apiData.forEach(d => {
      const preview = JSON.stringify(d.data).substring(0, 200);
      if (!preview.includes('{}') && !preview.includes('"data":{}')) {
        console.log(d.url);
        console.log(preview);
        console.log('---');
      }
    });

  } finally {
    await browser.close();
  }
}

run().catch(console.error);
