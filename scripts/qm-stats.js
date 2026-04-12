#!/usr/bin/env node
/**
 * QuickManage Stats Scraper
 * Pulls weekly gross for 1-9 Transportation and Caribe Transport
 * Saves to /tmp/qm-stats.json for the TMS dashboard to read
 */
const { chromium } = require('playwright');
const fs = require('fs');

const CARRIERS = {
  '1-9 Transportation Inc': '3fa9f398-e5dd-49b6-8528-18217b9e9411',
  'Caribe Transport Inc':   '964e6cf7-9d60-4aba-af76-4212a6e28071',
};

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();

  const stats = { updatedAt: new Date().toISOString(), companies: [], error: null };

  try {
    await page.goto('https://app.quickmanage.com', { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('input[type="email"]', 'sh.shirimov@gmail.com');
    await page.fill('input[type="password"]', 'Turkmen1991@');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Intercept trips/es responses
    const tripsData = {};
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/trips/es')) {
        try {
          const json = await res.json();
          const match = url.match(/carrier_id=([^&]+)/);
          if (match) tripsData[match[1]] = json.data || [];
        } catch {}
      }
    });

    for (const [name, carrierId] of Object.entries(CARRIERS)) {
      // Switch company
      const currentCompany = await page.innerText('h1, .company-name, [class*="carrier"]').catch(() => '');
      await page.click(`text=${name}`).catch(async () => {
        // Try via company switcher in header
        const headerBtn = page.locator('button:has-text("Transportation"), button:has-text("Caribe"), button:has-text("MARYBEG"), button:has-text("INC")').first();
        await headerBtn.click().catch(() => {});
        await page.waitForTimeout(500);
        await page.click(`text=${name}`).catch(() => {});
      });
      await page.waitForTimeout(2000);

      // Navigate to trips page to trigger data load
      await page.goto(`https://app.quickmanage.com/dashboard/trips?carrier_id=${carrierId}`, {
        waitUntil: 'domcontentloaded', timeout: 15000
      }).catch(() => {});
      await page.waitForTimeout(4000);

      // Get visible trip amounts from page
      const text = await page.innerText('body');
      const dollarMatches = [...text.matchAll(/\$(\d[\d,]+)(\.\d{2})?/g)];
      const amounts = dollarMatches
        .map(m => parseFloat(m[1].replace(/,/g, '') + (m[2] || '')))
        .filter(n => n >= 500); // filter out per-mile rates

      // Get trip count
      const countMatch = text.match(/(\d+)\s*(trips?|loads?|results?)/i);
      const tripCount = countMatch ? parseInt(countMatch[1]) : amounts.length;

      // Sum visible amounts as estimate
      const visibleGross = amounts.reduce((a, b) => a + b, 0);

      // Also try the Operations tab for current/last week
      await page.click('text=Operations').catch(() => {});
      await page.waitForTimeout(2000);
      const opsText = await page.innerText('body');

      // Extract current week and last week gross
      const currentWeekMatch = opsText.match(/GROSS CURRENT WEEK[\s\S]*?\$([\d,]+\.?\d*)/i);
      const lastWeekMatch = opsText.match(/GROSS LAST WEEK[\s\S]*?\$([\d,]+\.?\d*)/i);

      const currentWeekGross = currentWeekMatch 
        ? parseFloat(currentWeekMatch[1].replace(/,/g, ''))
        : 0;
      const lastWeekGross = lastWeekMatch
        ? parseFloat(lastWeekMatch[1].replace(/,/g, ''))
        : 0;

      // Get active/in-transit trip counts from dashboard stats
      const activeMatch = opsText.match(/in.transit.*?(\d+)|(\d+).*?in.transit/i);
      const activeTrips = activeMatch ? parseInt(activeMatch[1] || activeMatch[2]) : 0;

      stats.companies.push({
        name,
        carrierId,
        currentWeekGross,
        lastWeekGross,
        activeTrips,
        tripsOnPage: amounts.length,
      });

      console.log(`${name}: Current Week $${currentWeekGross.toLocaleString()} | Last Week $${lastWeekGross.toLocaleString()} | Active: ${activeTrips}`);
    }

    // Totals
    stats.totals = {
      currentWeekGross: stats.companies.reduce((a, c) => a + c.currentWeekGross, 0),
      lastWeekGross: stats.companies.reduce((a, c) => a + c.lastWeekGross, 0),
      activeTrips: stats.companies.reduce((a, c) => a + c.activeTrips, 0),
    };

    console.log(`\nTOTAL: Current Week $${stats.totals.currentWeekGross.toLocaleString()} | Last Week $${stats.totals.lastWeekGross.toLocaleString()}`);

  } catch (e) {
    stats.error = e.message;
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }

  fs.writeFileSync('/opt/tms/public/qm-stats.json', JSON.stringify(stats, null, 2));
  console.log('Stats saved to /opt/tms/public/qm-stats.json');
}

run();
