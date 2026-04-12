#!/usr/bin/env node
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  let token = null;
  page.on('response', async (response) => {
    const auth = response.request().headers()['authorization'];
    if (auth && !token) token = auth;
  });

  await page.goto('https://app.quickmanage.com', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[type="email"]', 'sh.shirimov@gmail.com');
  await page.fill('input[type="password"]', 'Turkmen1991@');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // Get token from localStorage
  token = await page.evaluate(() => localStorage.getItem('token'));
  token = 'Bearer ' + token;

  // Get all carriers
  const carriersRes = await page.evaluate(async (tok) => {
    const r = await fetch('https://api.quickmanage.com/api/carriers', {
      headers: { 'Authorization': tok, 'Content-Type': 'application/json' }
    });
    return r.json();
  }, token);

  const carriers = carriersRes.data || [];
  console.log(`Found ${carriers.length} carriers\n`);

  // Date ranges
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  let grandTotalWeek = 0, grandTotalMonth = 0, grandTotalYear = 0, grandTripsYear = 0;

  for (const carrier of carriers) {
    // Fetch completed trips for this year
    const tripsRes = await page.evaluate(async ({ carrierId, tok, startDate, endDate }) => {
      const r = await fetch(
        `https://api.quickmanage.com/api/trips/es?carrier_id=${carrierId}&start_date=${startDate}&end_date=${endDate}&limit=2000&page=1`,
        {
          method: 'POST',
          headers: { 'Authorization': tok, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: ['COMPLETED'] })
        }
      );
      return r.json();
    }, { carrierId: carrier.id, tok: token, startDate: yearStart.toISOString(), endDate: now.toISOString() });

    const trips = tripsRes.data || [];
    if (!trips.length) continue;

    let weekGross = 0, monthGross = 0, yearGross = 0;
    let weekTrips = 0, monthTrips = 0, yearTrips = 0;

    trips.forEach(t => {
      const rate = parseFloat(t.rate || t.total_rate || t.gross_pay || 0);
      const tripDate = new Date(t.pickup_date || t.created_at || t.date);

      yearGross += rate; yearTrips++;
      if (tripDate >= monthStart) { monthGross += rate; monthTrips++; }
      if (tripDate >= weekStart) { weekGross += rate; weekTrips++; }
    });

    if (yearTrips > 0) {
      grandTotalWeek += weekGross;
      grandTotalMonth += monthGross;
      grandTotalYear += yearGross;
      grandTripsYear += yearTrips;

      console.log(`📦 ${carrier.carrier_name}`);
      console.log(`   This week:  ${weekTrips} trips | $${weekGross.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})}`);
      console.log(`   This month: ${monthTrips} trips | $${monthGross.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})}`);
      console.log(`   This year:  ${yearTrips} trips | $${yearGross.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})}`);
      // Sample to see field names
      if (trips[0]) console.log(`   Sample fields: ${Object.keys(trips[0]).slice(0,10).join(', ')}`);
      console.log('');
    }
  }

  console.log('='.repeat(50));
  console.log('🚛 GRAND TOTAL (ALL COMPANIES)');
  console.log(`   This week:  $${grandTotalWeek.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})}`);
  console.log(`   This month: $${grandTotalMonth.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})}`);
  console.log(`   This year:  ${grandTripsYear} trips | $${grandTotalYear.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})}`);

  await browser.close();
}

run().catch(e => console.error(e.message));
