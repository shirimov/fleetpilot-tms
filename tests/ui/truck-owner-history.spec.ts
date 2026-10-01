import { expect, test, type Page } from 'playwright/test';
import type { OwnerHistorySnapshot } from '../../src/lib/fleet/truck-owner-editor';

// Synthetic route fixtures; browser interaction coverage, not database acceptance.
async function setup(page: Page, canManage = true, mode: 'save' | 'conflict' | 'readback-failure' | 'first' = 'save') {
  const companies = [{ id: 'synthetic-company', name: 'Synthetic carrier', role: canManage ? 'OWNER' : 'ADMIN', canManage: true }];
  const period = { id: 'synthetic-period', ownerPartyId: 'synthetic-owner', ownerName: 'Synthetic owner', companyId: companies[0].id, providerRecipientId: 'synthetic-contractor', effectiveFrom: '2026-06-01', effectiveTo: null, revisionId: 'synthetic-revision', sourceReference: 'Initial evidence', reason: 'Initial confirmation', actorUserId: 'synthetic-actor', createdAt: '2026-06-01T12:00:00Z' };
  let history: OwnerHistorySnapshot = { truckId: 'synthetic-truck', unitNumber: 'UI-1', revisionId: mode === 'first' ? null : 'synthetic-revision', periods: mode === 'first' ? [] : [period] };
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/auth/company', route => route.fulfill({ json: { user: { displayName: 'Synthetic viewer', email: 'viewer@example.test' }, activeCompanyId: companies[0].id, companies } }));
  await page.route('**/api/companies', route => route.fulfill({ json: companies }));
  await page.route('**/api/trucks?**', route => route.fulfill({ json: { items: [{ id: history.truckId, unitNumber: history.unitNumber, companyId: companies[0].id, company: companies[0], status: 'ACTIVE', cabType: 'SLEEPER', canManage: true }], companies, activeCompanyId: companies[0].id, selectedCompany: companies[0].id, pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } } }));
  await page.route('**/api/trucks/synthetic-truck/owner-history/options', route => route.fulfill({ json: { canManage, companies, owners: [{ id: period.ownerPartyId, name: period.ownerName, companyId: null }, { id: 'synthetic-next-owner', name: 'Synthetic next owner', companyId: null }], recipients: [{ id: period.providerRecipientId, name: 'Synthetic Contractor', companyId: companies[0].id }, { id: 'synthetic-next-contractor', name: 'Synthetic next Contractor', companyId: companies[0].id }] } }));
  await page.route('**/api/trucks/synthetic-truck/owner-history', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); posts.push(body);
      if (mode === 'conflict') return route.fulfill({ status: 409, json: { error: 'Owner history changed. Reload before submitting.' } });
      history = { ...history, revisionId: 'saved-revision', periods: body.periods.map((p: object, i: number) => ({ ...period, ...p, id: `saved-${i}`, revisionId: 'saved-revision', sourceReference: body.sourceReference, reason: body.reason })) };
      return route.fulfill({ json: { truckId: history.truckId, revisionId: history.revisionId } });
    }
    if (mode === 'readback-failure' && posts.length) return route.fulfill({ status: 503, json: { error: 'Readback unavailable' } });
    return route.fulfill({ json: history });
  });
  await page.goto('/trucks');
  await page.getByRole('button', { name: 'Truck UI-1 owner history' }).click();
  await expect(page.getByRole('heading', { name: /Beneficial owner history/ })).toBeVisible();
  await expect(page.getByText(mode === 'first' ? 'No confirmed owner history. Earlier ownership and start dates remain unknown.' : 'Initial evidence', { exact: true })).toBeVisible();
  return posts;
}

test('OWNER reviews full timeline, selects real scoped identities, and sees audited readback', async ({ page }) => {
  const posts = await setup(page);
  await page.getByLabel('To (exclusive) 1').fill('2026-07-01');
  await page.getByRole('button', { name: 'Add owner period' }).click();
  await expect(page.getByLabel('From (inclusive) 2')).toHaveValue('');
  await page.getByLabel('Binding Company 2').selectOption('synthetic-company');
  await page.getByLabel('Owner party 2').selectOption('synthetic-next-owner');
  await page.getByLabel('QM Contractor 2').selectOption('synthetic-next-contractor');
  await page.getByLabel('From (inclusive) 2').fill('2026-07-01');
  await page.getByLabel('Evidence reference', { exact: true }).fill('Synthetic transfer document');
  await page.getByLabel('Reason', { exact: true }).fill('Confirmed calendar transition');
  await page.getByRole('button', { name: 'Review full timeline' }).click();
  expect(posts).toHaveLength(0);
  await expect(page.getByText('Replacing revision: synthetic-revision', { exact: true })).toBeVisible();
  await page.getByLabel('I reviewed every period and its owner / Company / Contractor binding.').check();
  await page.getByRole('button', { name: 'Save audited owner history' }).click();
  await expect(page.getByRole('status')).toContainText('Saved and read back revision saved-revision');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ expectedRevisionId: 'synthetic-revision', sourceReference: 'Synthetic transfer document', reason: 'Confirmed calendar transition', periods: [{ effectiveTo: '2026-07-01', ownerPartyId: 'synthetic-owner' }, { effectiveFrom: '2026-07-01', effectiveTo: null, ownerPartyId: 'synthetic-next-owner' }] });
  await expect(page.getByText('Actor: synthetic-actor', { exact: true }).first()).toBeVisible();
});

for (const mode of ['conflict', 'readback-failure'] as const) {
  test(`${mode} blocks retry, retains draft and never announces success`, async ({ page }) => {
    const posts = await setup(page, true, mode);
    await page.getByLabel('Evidence reference', { exact: true }).fill('Synthetic correction');
    await page.getByLabel('Reason', { exact: true }).fill('Reviewed correction');
    await page.getByRole('button', { name: 'Review full timeline' }).click();
    await page.getByLabel('I reviewed every period and its owner / Company / Contractor binding.').check();
    await page.getByRole('button', { name: 'Save audited owner history' }).click();
    await expect(page.getByRole('alert')).toContainText('Reload');
    await expect(page.getByRole('button', { name: 'Save audited owner history' })).toBeDisabled();
    await expect(page.getByText(/Saved and read back revision/)).toHaveCount(0);
    expect(posts).toHaveLength(1);
  });
}

test('first confirmation never seeds dates or IDs and submits a null expected revision', async ({ page }) => {
  const posts = await setup(page, true, 'first');
  await page.getByRole('button', { name: 'Add owner period' }).click();
  for (const label of ['From (inclusive) 1', 'To (exclusive) 1', 'Binding Company 1', 'Owner party 1', 'QM Contractor 1']) await expect(page.getByLabel(label)).toHaveValue('');
  await page.getByLabel('Binding Company 1').selectOption('synthetic-company');
  await page.getByLabel('Owner party 1').selectOption('synthetic-owner');
  await page.getByLabel('QM Contractor 1').selectOption('synthetic-contractor');
  await page.getByLabel('From (inclusive) 1').fill('2026-06-01');
  await page.getByLabel('Evidence reference', { exact: true }).fill('Synthetic first confirmation');
  await page.getByLabel('Reason', { exact: true }).fill('Only known start');
  await page.getByRole('button', { name: 'Review full timeline' }).click();
  await page.getByLabel('I reviewed every period and its owner / Company / Contractor binding.').check();
  await page.getByRole('button', { name: 'Save audited owner history' }).click();
  await expect(page.getByRole('status')).toContainText('Saved and read back revision saved-revision');
  expect(posts[0].expectedRevisionId).toBeNull();
});

test('missing verified choices fails closed and does not expose free-text IDs', async ({ page }) => {
  const posts = await setup(page, true, 'first');
  await page.route('**/api/trucks/synthetic-truck/owner-history/options', route => route.fulfill({ json: { canManage: true, companies: [{ id: 'synthetic-company', name: 'Synthetic carrier' }], owners: [], recipients: [] } }));
  await page.getByRole('button', { name: 'Reload saved timeline' }).click();
  await page.getByRole('button', { name: 'Add owner period' }).click();
  await page.getByLabel('Binding Company 1').selectOption('synthetic-company');
  await expect(page.getByText('Verified owner or Contractor choices are missing for this Company. No identity is inferred.')).toBeVisible();
  await expect(page.getByLabel('Owner party 1').locator('option')).toHaveCount(1);
  await expect(page.getByLabel('QM Contractor 1').locator('option')).toHaveCount(1);
  expect(posts).toHaveLength(0);
});

test('ADMIN has provenance but no write controls', async ({ page }) => {
  const posts = await setup(page, false);
  await expect(page.getByText(/Read-only: OWNER authority/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review full timeline' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add owner period' })).toHaveCount(0);
  expect(posts).toHaveLength(0);
});
