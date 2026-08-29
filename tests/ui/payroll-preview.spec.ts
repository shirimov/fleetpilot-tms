import { expect, test } from 'playwright/test';

const companyContext = { user: { displayName: 'Payroll Owner', email: 'owner@example.test', image: null }, activeCompanyId: 'company-payroll', companies: [{ id: 'company-payroll', name: 'Payroll Company', role: 'OWNER' }] };
const period = { id: 'period-1', identifier: '2026-W34', startDate: '2026-08-16T00:00:00.000Z', endDate: '2026-08-22T00:00:00.000Z', status: 'OPEN', externalPeriod: '2026-34' };

test('OWNER sees an explainable read-only payroll preview and blocked contractor', async ({ page }) => {
  await page.route('**/api/auth/company', (route) => route.fulfill({ json: companyContext }));
  await page.route('**/api/payroll/periods', async (route) => {
    if (route.request().method() === 'POST') { await route.fulfill({ status: 201, json: period }); return; }
    await route.fulfill({ json: [period] });
  });
  await page.route('**/api/payroll/participants', (route) => route.fulfill({ json: { drivers: [{ id: 'driver-1', firstName: 'Audit', lastName: 'Driver' }], contractors: [{ id: 'contractor-1', name: 'Audit Contractor' }] } }));
  await page.route('**/api/payroll/readiness', (route) => route.fulfill({ json: { status: 'PARTIALLY_READY', matchedCases: 1, requiredMatchedCases: 3, generationEnabled: false, checks: [{ type: 'MILEAGE_SOURCE', configured: true, verified: false, tested: true, reconciled: false, blocker: 'Not admin verified' }] } }));
  await page.route('**/api/payroll/reconciliation-cases', (route) => route.fulfill({ json: [{ id: 'case-1', status: 'UNEXPLAINED_DIFFERENCE', differenceTypes: ['MILEAGE_DIFFERENCE'], period: { identifier: '2026-W34' }, driver: { firstName: 'Audit', lastName: 'Driver' }, contractorParty: null }] }));
  await page.route('**/api/payroll/periods/period-1', (route) => route.fulfill({ json: {
    period,
    totals: { RECONCILED: 1, BLOCKED: 1, totalCalculatedPayoutMinor: '328095' },
    contractorNotice: 'Contractor percentage previews remain blocked until an explicit, verified percentage base and trip relationship are configured.',
    previews: [
      { id: 'driver-1', name: 'Audit Driver', truck: { unitNumber: '018' }, calculation: { readiness: 'RECONCILED', eligibleMilesThousandths: '4663000', baseEarningMinor: '303095', calculatedPayoutMinor: '328095', payoutDifferenceMinor: '0', blockers: [], warnings: ['Mileage policy remains unverified.'], tripBreakdown: [{ id: 'trip-1', reference: 'LOAD-1', miles: '4663', earningMinor: '303095' }] } },
      { id: 'contractor-1', name: 'Audit Contractor', truck: null, calculation: { readiness: 'BLOCKED', eligibleMilesThousandths: '0', baseEarningMinor: null, calculatedPayoutMinor: null, payoutDifferenceMinor: null, blockers: ['Contractor percentage base is not configured.'], warnings: [], tripBreakdown: [] } },
    ],
  } }));
  await page.goto('/accounting/payroll');
  await expect(page.getByRole('heading', { name: 'Payroll Audit & Calculation Preview' })).toBeVisible();
  await expect(page.getByText('PAYROLL PREVIEW ONLY', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('$3,280.95').first()).toBeVisible();
  await expect(page.getByText('4,663.000')).toBeVisible();
  await expect(page.getByText('RECONCILED', { exact: true })).toBeVisible();
  await expect(page.getByText('BLOCKED', { exact: true })).toBeVisible();
  await expect(page.getByText(/percentage base is not configured/i)).toBeVisible();
  await expect(page.getByText(/PARTIALLY_READY/)).toBeVisible();
  await expect(page.getByText(/MILEAGE_DIFFERENCE/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create audit case' })).toBeVisible();
  await page.getByText('Calculation audit trail').first().click();
  await expect(page.getByText(/LOAD-1: 4663 miles/)).toBeVisible();
});
