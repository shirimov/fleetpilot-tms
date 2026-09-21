import { expect, test } from 'playwright/test';

test('Truck detail distinguishes current Company, unknown history and evidenced movement', async ({ page }) => {
  const companies = [{ id: 'turner', name: 'Turner', role: 'OWNER', canManage: true }, { id: 'rana', name: 'Rana', role: 'OWNER', canManage: true }];
  await page.route('**/api/auth/company', route => route.fulfill({ json: { user: { displayName: 'Owner', email: 'owner@example.test' }, activeCompanyId: 'turner', companies } }));
  await page.route('**/api/companies', route => route.fulfill({ json: companies }));
  await page.route('**/api/trucks?**', route => route.fulfill({ json: { items: [{ id: 'physical-vin', unitNumber: '024', companyId: 'turner', company: companies[0], status: 'ACTIVE', cabType: 'SLEEPER', canManage: true }], companies, activeCompanyId: 'turner', selectedCompany: 'turner', pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } } }));
  let revisionId: string | null = null;
  let periods: object[] = [];
  let currentCompanyId = 'turner';
  await page.route('**/api/trucks/physical-vin/company-history', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.source).toBe('MANUAL_CONFIRMATION');
      if (!revisionId) {
        expect(body.sourceReference).toBe('Owner document 1');
        expect(body.expectedRevisionId).toBe(null);
        expect(body.periods).toEqual([{ companyId: 'turner', effectiveFrom: '2026-06-01', effectiveTo: null }]);
        revisionId = 'r1'; periods = [{ id: 'a1', companyName: 'Turner', effectiveFrom: '2026-06-01', effectiveTo: null, source: 'MANUAL_CONFIRMATION', status: 'CONFIRMED' }];
      } else {
        expect(body).toMatchObject({ action: 'MOVE', expectedRevisionId: 'r1', destinationCompanyId: 'rana', effectiveDate: '2026-09-01', sourceReference: 'Transfer document 2' });
        revisionId = 'r2'; currentCompanyId = 'rana';
        periods = [
          { id: 'a2', companyName: 'Turner', effectiveFrom: '2026-06-01', effectiveTo: '2026-09-01', source: 'MANUAL_CONFIRMATION', status: 'CONFIRMED' },
          { id: 'a3', companyName: 'Rana', effectiveFrom: '2026-09-01', effectiveTo: null, source: 'MANUAL_CONFIRMATION', status: 'CONFIRMED' },
        ];
      }
      return route.fulfill({ json: { revisionId } });
    }
    return route.fulfill({ json: { currentCompanyId, canManage: true, revisionId, periods } });
  });
  await page.goto('/trucks');
  await page.getByRole('button', { name: 'Truck 024 history' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('No confirmed history in your authorized scope.')).toBeVisible();
  await page.getByLabel('Effective date').fill('2026-06-01');
  await page.getByLabel('Evidence reference').fill('Owner document 1');
  await page.getByLabel('Reason', { exact: true }).fill('Known operating start');
  await page.getByRole('button', { name: 'Confirm evidenced start date' }).click();
  await expect(page.getByRole('cell', { name: 'CONFIRMED', exact: true })).toBeVisible();
  await expect(page.getByLabel('Destination Company')).toBeVisible();
  await expect(page.getByText('Current operating Company: Turner.', { exact: false })).toBeVisible();
  await page.getByLabel('Destination Company').selectOption('rana');
  await page.getByLabel('Effective date').fill('2026-09-01');
  await page.getByLabel('Evidence reference').fill('Transfer document 2');
  await page.getByLabel('Reason', { exact: true }).fill('Confirmed operating transfer');
  await page.getByRole('button', { name: 'Confirm Company movement' }).click();
  await expect(page.getByText('Current operating Company: Rana.', { exact: false })).toBeVisible();
  await expect(page.getByRole('row', { name: 'Turner 2026-06-01 2026-09-01 MANUAL CONFIRMATION CONFIRMED', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: 'Rana 2026-09-01 Present MANUAL CONFIRMATION CONFIRMED', exact: true })).toBeVisible();
});

test('history API is not public', async ({ request }) => {
  const response = await request.get('/api/trucks/unknown/company-history');
  expect(response.status()).toBe(401);
});
