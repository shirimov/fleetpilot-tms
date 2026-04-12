#!/usr/bin/env node
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  let authToken = null;
  page.on('request', req => {
    const auth = req.headers()['authorization'];
    if (auth) authToken = auth;
  });

  const apiData = {};
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api.quickmanage.com/api/carriers')) {
      try { apiData.carriers = await response.json(); } catch {}
    }
  });

  await page.goto('https://app.quickmanage.com', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[type="email"]', 'sh.shirimov@gmail.com');
  await page.fill('input[type="password"]', 'Turkmen1991@');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);

  // Get all carriers
  const carriers = await page.evaluate(async () => {
    const r = await fetch('https://api.quickmanage.com/api/carriers', { credentials: 'include' });
    return await r.json();
  });

  console.log('=== ALL CARRIERS ===');
  const carrierList = carriers.data || [];
  carrierList.forEach(c => console.log(`- ${c.carrier_name} | ID: ${c.id} | MC: ${c.mc_number}`));

  // For each carrier, get trip stats
  console.log('\n=== TRIPS BY CARRIER (last 30 days) ===');
  const start = new Date(); start.setDate(start.getDate() - 30);
  const end = new Date();
  const startStr = start.toISOString();
  const endStr = end.toISOString();

  for (const carrier of carrierList) {
    const trips = await page.evaluate(async ({ id, startStr, endStr }) => {
      const r = await fetch(
        `https://api.quickmanage.com/api/trips/es?carrier_id=${id}&start_date=${startStr}&end_date=${endStr}&limit=1000&page=1`,
        { credentials: 'include', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
      );
      return await r.json();
    }, { id: carrier.id, startStr, endStr });

    const data = trips.data || trips;
    const tripList = Array.isArray(data) ? data : (data.trips || data.items || []);
    
    let totalGross = 0;
    let completedCount = 0;
    tripList.forEach(t => {
      if (t.status === 'COMPLETED' || t.status === 'completed') {
        totalGross += parseFloat(t.rate || t.gross || t.total_rate || 0);
        completedCount++;
      }
    });

    console.log(`\n${carrier.carrier_name}:`);
    console.log(`  Total trips returned: ${tripList.length}`);
    console.log(`  Completed: ${completedCount}`);
    console.log(`  Gross: $${totalGross.toLocaleString()}`);
    
    if (tripList.length > 0) {
      console.log(`  Sample trip keys: ${Object.keys(tripList[0]).join(', ')}`);
      console.log(`  Sample: ${JSON.stringify(tripList[0]).substring(0, 300)}`);
    } else {
      console.log(`  Raw response: ${JSON.stringify(trips).substring(0, 400)}`);
    }
  }

  await browser.close();
}

run().catch(console.error);
