#!/usr/bin/env node
const { chromium } = require('playwright');

async function getQuickManageGross() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Logging into QuickManage...');
    await page.goto('https://app.quickmanage.com', { waitUntil: 'networkidle', timeout: 30000 });

    // Fill login form
    await page.fill('input[type="email"], input[name="email"]', 'sh.shirimov@gmail.com');
    await page.fill('input[type="password"], input[name="password"]', 'Turkmen1991@');
    await page.click('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    console.log('Logged in. Current URL:', page.url());

    // Intercept API responses for trips data
    const results = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/trips') || url.includes('/api/revenue') || url.includes('/api/dashboard') || url.includes('/api/report')) {
        try {
          const json = await response.json();
          results.push({ url, data: json });
        } catch {}
      }
    });

    // Try navigating to reports/trips
    const navLinks = [
      '/trips', '/reports', '/dashboard', '/payroll', '/revenue'
    ];

    for (const link of navLinks) {
      try {
        await page.goto('https://app.quickmanage.com' + link, { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(2000);
        const text = await page.innerText('body').catch(() => '');
        if (text.includes('$') && (text.includes('gross') || text.includes('Gross') || text.includes('revenue') || text.includes('Revenue') || text.includes('trip') || text.includes('Trip'))) {
          console.log(`\n=== Found data at ${link} ===`);
          // Extract numbers from page
          const matches = text.match(/\$[\d,]+(\.\d{2})?/g);
          if (matches) {
            console.log('Dollar amounts found:', [...new Set(matches)].slice(0, 20).join(', '));
          }
          // Print relevant lines
          const lines = text.split('\n').filter(l => 
            l.includes('$') || l.includes('gross') || l.includes('Gross') || 
            l.includes('week') || l.includes('Week') || l.includes('trip') || l.includes('Trip') ||
            l.includes('total') || l.includes('Total')
          );
          console.log('Relevant lines:', lines.slice(0, 30).join('\n'));
        }
      } catch (e) {
        // skip
      }
    }

    // Print any API data caught
    if (results.length > 0) {
      console.log('\n=== API Data Intercepted ===');
      results.forEach(r => console.log(r.url, JSON.stringify(r.data).substring(0, 500)));
    }

    // Take screenshot for reference
    await page.screenshot({ path: '/tmp/qm-screenshot.png', fullPage: false });
    console.log('\nScreenshot saved to /tmp/qm-screenshot.png');

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}

getQuickManageGross();
