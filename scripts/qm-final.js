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
  const cookies = await context.cookies();
  const csrfCookie = cookies.find(c => c.name === 'XSRF-TOKEN-PROD');
  const csrf = csrfCookie?.value || '';

  // Get all carriers
  const carriersRes = await page.evaluate(async ({ tok, csrf }) => {
    const r = await fetch('https://api.quickmanage.com/api/carriers', {
      headers: { 'Authorization': tok, 'X-XSRF-TOKEN': csrf, 'X-CSRF-TOKEN': csrf }
    });
    return r.json();
  }, { tok: token, csrf });

  const carriers = carriersRes.data || [];

  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  let grandWeek = 0, grandMonth = 0, grandYear = 0, grandTrips = 0;

  for (const carrier of carriers) {
    const res = await page.evaluate(async ({ carrierId, tok, csrf, startDate, endDate }) => {
      const r = await fetch(
        `https://api.quickmanage.com/api/trips/es?carrier_id=${carrierId}&start_date=${startDate}&end_date=${endDate}&limit=2000&page=1`,
        {
          method: 'POST',
          headers: {
            'Authorization': tok,
            'X-XSRF-TOKEN': csrf,
            'X-CSRF-TOKEN': csrf,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        }
      );
      return r.json();
    }, { carrierId: carrier.id, tok: token, csrf, startDate: yearStart.toISOString(), endDate: now.toISOString() });

    const trips = res.data || [];
    if (!trips.length) continue;

    let weekGross = 0, monthGross = 0, yearGross = 0;
    let weekCount = 0, monthCount = 0, yearCount = 0;

    trips.forEach(t => {
      const rate = parseFloat(t.rate || t.total_rate || t.gross || t.driver_gross || 0);
      const d = new Date(t.pickup_date || t.start_date || t.created_at);
      yearGross += rate; yearCount++;
      if (d >= monthStart) { monthGross += rate; monthCount++; }
      if (d >= weekStart) { weekGross += rate; weekCount++; }
    });

    if (yearCount > 0) {
      grandWeek += weekGross; grandMonth += monthGross; grandYear += yearGross; grandTrips += yearCount;
      const fmt = n => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
      console.log(`📦 ${carrier.carrier_name}`);
      console.log(`   Week: ${weekCount} trips | ${fmt(weekGross)}  |  Month: ${monthCount} | ${fmt(monthGross)}  |  YTD: ${yearCount} | ${fmt(yearGross)}`);
      // debug first trip
      const t0 = trips[0];
      console.log(`   Sample: rate=${t0.rate} total_rate=${t0.total_rate} gross=${t0.gross} status=${t0.status} date=${t0.pickup_date||t0.start_date||t0.created_at}`);
    }
  }

  const fmt = n => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  console.log('\n' + '='.repeat(55));
  console.log('🚛 ALL COMPANIES COMBINED');
  console.log(`   This week:  ${fmt(grandWeek)}`);
  console.log(`   This month: ${fmt(grandMonth)}`);
  console.log(`   YTD:        ${grandTrips} trips | ${fmt(grandYear)}`);

  await browser.close();
}

run().catch(e => console.error(e.message));
