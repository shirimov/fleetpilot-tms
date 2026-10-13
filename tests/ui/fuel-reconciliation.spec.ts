import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Page } from 'playwright/test';
import { prisma } from '@/lib/prisma';
import { fuelWorkflowFixture, fuelEconomics } from '../fixtures/fuel-reconciliation';

const endpoint = '/api/finance/fuel-reconciliation';
const reason = 'Synthetic receipt review confirms this specific purchase and deduction.';
async function signIn(page: Page, user: { id: string; email: string }) {
  const token = randomBytes(32).toString('base64url');
  await prisma.emailSignInToken.create({ data: { userId: user.id, email: user.email, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
  await page.goto(`/login/email/verify#token=${token}`);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
}

test.beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Fuel workflow requires a dedicated local *_test database.');
});

test('OWNER browser pairs and undoes unresolved fuel without changing evidence or economics', async ({ page }) => {
  const f = await fuelWorkflowFixture();
  const before = await fuelEconomics(f.group.id);
  await signIn(page, f.owner);
  const preview = await page.request.get(endpoint);
  expect(preview.status()).toBe(200);
  expect(preview.headers()['cache-control']).toBe('private, no-store');
  await page.goto('/accounting?view=statements&archive=reconciliation');
  await page.getByRole('button', { name: 'Select Pilot', exact: true }).click();
  await page.getByRole('button', { name: 'Select QM', exact: true }).click();
  await page.getByLabel('OWNER reason').fill(reason);
  await page.getByRole('checkbox', { name: /I confirm these are the same fuel purchase/ }).check();
  await page.getByRole('button', { name: /Save.*match/i }).click();
  await expect.poll(() => prisma.fuelReconciliationManualMatch.count({ where: { operatingGroupId: f.group.id, unmatchedAt: null } })).toBe(1);
  const row = page.locator('#fuel-reconciliation-table tbody tr').filter({ hasText: 'MATCHED' });
  await row.getByText('Evidence and calculation', { exact: true }).click();
  await expect(row.getByText(reason, { exact: true })).toBeVisible();
  await row.getByPlaceholder('Audited reason to undo this match').fill('Synthetic receipt review has been withdrawn for rechecking.');
  await row.getByRole('button', { name: 'Undo / unmatch' }).click();
  await expect(page.getByRole('button', { name: 'Select Pilot', exact: true })).toBeVisible();
  expect(await prisma.fuelReconciliationManualMatch.count({ where: { operatingGroupId: f.group.id, unmatchedAt: null } })).toBe(0);
  expect(await prisma.financialAuditEvent.count({ where: { operatingGroupId: f.group.id, action: { in: ['FUEL_RECONCILIATION_MANUAL_MATCHED', 'FUEL_RECONCILIATION_MANUAL_UNMATCHED'] } } })).toBe(2);
  expect(await prisma.archiveLine.findUnique({ where: { id: f.line.id } })).toEqual(f.line);
  expect(await prisma.pilotFuelingEvent.findUnique({ where: { id: f.event.id } })).toEqual(f.event);
  expect(await fuelEconomics(f.group.id)).toEqual(before);
});

test('another Company OWNER cannot undo an out-of-scope manual match by ID', async ({ page }) => {
  const f = await fuelWorkflowFixture();
  await signIn(page, f.owner);
  const created = await page.request.post(endpoint, { data: { action: 'MANUAL_MATCH', pilotEventId: f.event.id, archiveLineId: f.line.id, reason } });
  expect(created.status()).toBe(201);
  const match = await created.json();
  await page.context().clearCookies();
  await signIn(page, f.outsider);
  const response = await page.request.patch(endpoint, { data: { action: 'MANUAL_UNMATCH', matchId: match.id, reason } });
  expect([403, 404]).toContain(response.status());
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect((await prisma.fuelReconciliationManualMatch.findUniqueOrThrow({ where: { id: match.id } })).unmatchedAt).toBeNull();
  expect(await prisma.financialAuditEvent.count({ where: { operatingGroupId: f.group.id, action: 'FUEL_RECONCILIATION_MANUAL_UNMATCHED' } })).toBe(0);
});

test('an uploaded pipe invoice pairs over authenticated HTTP without posting economics', async ({ page }) => {
  const f = await fuelWorkflowFixture();
  await prisma.companyMembership.create({ data: { userId: f.owner.id, companyId: f.otherCompany.id, role: 'OWNER' } });
  const before = await fuelEconomics(f.group.id);
  await signIn(page, f.owner);
  const header = Array(29).fill(' ');
  Object.assign(header, { 0: 'H', 1: '149977', 16: '20260615', 17: '20260601', 18: '20260614', 19: String(Date.now()) });
  const detail = Array(51).fill(' ');
  Object.assign(detail, { 0: 'D', 1: f.truck.unitNumber, 3: '100', 4: 'Synthetic City', 5: 'CA', 7: '991234', 11: '20260610', 17: '20.00', 19: '100.00', 20: '100.00', 21: '020', 22: 'Truck Diesel', 23: String(Date.now()) });
  const bytes = Buffer.from([header, detail, ['T', '2']].map(row => row.join('|')).join('\r\n'));
  const uploadSource = await prisma.financialSource.create({ data: { operatingGroupId: f.group.id, companyId: f.company.id, name: 'Synthetic pipe account', type: 'FUEL_CARD', provider: 'PILOT' } });
  const imported = await page.request.post('/api/finance/imports/pilot', { multipart: { sourceId: uploadSource.id, file: { name: 'synthetic-pilot.csv', mimeType: 'text/csv', buffer: bytes } } });
  expect(imported.status(), await imported.text()).toBe(201);
  const invoice = await imported.json();
  expect(invoice.status).toBe('SOURCE_ACCEPTED');
  const event = await prisma.pilotFuelingEvent.findFirstOrThrow({ where: { invoiceId: invoice.id } });
  expect(event.truckId).toBe(f.truck.id);
  const response = await page.request.post(endpoint, { data: { action: 'MANUAL_MATCH', pilotEventId: event.id, archiveLineId: f.line.id, reason } });
  expect(response.status()).toBe(201);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  const preview = await (await page.request.get(endpoint)).json();
  expect(preview.rows.find((row: { pilotEventId: string }) => row.pilotEventId === event.id).manualMatch.id).toBe((await response.json()).id);
  expect((await prisma.pilotProviderInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('SOURCE_ACCEPTED');
  expect(await fuelEconomics(f.group.id)).toEqual(before);
});

test('unauthenticated, ADMIN, and revoked Company writes leave no decisions or audit entries', async ({ page }) => {
  const f = await fuelWorkflowFixture();
  const payload = { action: 'MANUAL_MATCH', pilotEventId: f.event.id, archiveLineId: f.line.id, reason };
  expect((await page.request.post(endpoint, { data: payload })).status()).toBe(401);
  await signIn(page, f.owner);
  await prisma.companyMembership.update({ where: { userId_companyId: { userId: f.owner.id, companyId: f.company.id } }, data: { role: 'ADMIN' } });
  const adminResponse = await page.request.post(endpoint, { data: payload });
  expect(adminResponse.status()).toBe(403);
  expect(adminResponse.headers()['cache-control']).toBe('private, no-store');
  await prisma.companyMembership.delete({ where: { userId_companyId: { userId: f.owner.id, companyId: f.company.id } } });
  expect((await page.request.post(endpoint, { data: payload })).status()).toBe(403);
  expect(await prisma.fuelReconciliationManualMatch.count({ where: { operatingGroupId: f.group.id } })).toBe(0);
  expect(await prisma.financialAuditEvent.count({ where: { operatingGroupId: f.group.id, action: 'FUEL_RECONCILIATION_MANUAL_MATCHED' } })).toBe(0);
});

test.afterAll(async () => { await prisma.$disconnect(); });

test('a saved match with a failed preview refresh clears stale rows and retries only the read', async ({ page }) => {
  const f = await fuelWorkflowFixture();
  await signIn(page, f.owner);
  await page.goto('/accounting?view=statements&archive=reconciliation');
  await page.getByRole('button', { name: 'Select Pilot', exact: true }).click();
  await page.getByRole('button', { name: 'Select QM', exact: true }).click();
  await page.getByLabel('OWNER reason').fill(reason);
  await page.getByRole('checkbox', { name: /I confirm these are the same fuel purchase/ }).check();
  let failRefresh = false;
  let writeCount = 0;
  await page.route('**/api/finance/fuel-reconciliation**', async route => {
    if (route.request().method() === 'POST') {
      writeCount += 1;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      failRefresh = true;
      await route.fulfill({ response });
    } else if (failRefresh && route.request().method() === 'GET' && !route.request().url().includes('view=policies')) {
      failRefresh = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic preview unavailable' }) });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Save audited manual match', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Fuel preview unavailable' })).toBeVisible();
  await expect(page.locator('#fuel-reconciliation-table')).toHaveCount(0);
  expect(await prisma.fuelReconciliationManualMatch.count({ where: { operatingGroupId: f.group.id, unmatchedAt: null } })).toBe(1);
  await page.getByRole('button', { name: 'Retry fuel preview' }).click();
  await expect(page.locator('#fuel-reconciliation-table tbody tr')).toHaveCount(1);
  expect(writeCount).toBe(1);
});

test('whole-invoice reads require every Company and recheck revoked membership in the same session', async ({ page }) => {
  const f = await fuelWorkflowFixture();
  await signIn(page, f.owner);
  const url = `/api/finance/imports/pilot/${f.event.invoiceId}`;
  const partial = await page.request.get(url);
  expect(partial.status()).toBe(403);
  expect(partial.headers()['cache-control']).toBe('private, no-store');
  expect(await partial.json()).toEqual({ error: 'Access denied' });
  await prisma.companyMembership.create({ data: { userId: f.owner.id, companyId: f.otherCompany.id, role: 'OWNER' } });
  const authorized = await page.request.get(url);
  expect(authorized.status()).toBe(200);
  expect((await authorized.json()).id).toBe(f.event.invoiceId);
  await prisma.companyMembership.delete({ where: { userId_companyId: { userId: f.owner.id, companyId: f.otherCompany.id } } });
  expect((await page.request.get(url)).status()).toBe(403);
});
