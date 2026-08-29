import { expect, test } from 'playwright/test';

test('Administrator can inspect and test QuickManage without exposing secrets', async ({ page }) => {
  const browserRequests: string[] = [];
  await page.route('**/api/auth/company', (route) => route.fulfill({ json: {
    user: { displayName: 'Alpha Owner', email: 'owner@example.test', image: null },
    activeCompanyId: 'company-alpha',
    companies: [{ id: 'company-alpha', name: 'Alpha', role: 'OWNER' }],
  } }));
  await page.route('**/api/integrations/quickmanage', async (route) => {
    browserRequests.push(route.request().method());
    await route.fulfill({ json: route.request().method() === 'POST'
      ? { configured: true, connected: true }
      : { configured: true } });
  });

  await page.goto('/administration/integrations/quickmanage');
  await expect(page.getByRole('heading', { name: 'QuickManage' })).toBeVisible();
  await expect(page.getByText('Configured', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await expect(page.getByText('Connection successful. QuickManage returned a valid access token.')).toBeVisible();
  expect(browserRequests).toEqual(['GET', 'POST']);
  expect(await page.locator('body').innerText()).not.toContain('client_secret');
  expect(await page.locator('body').innerText()).not.toContain('access_token');
});

test('Administrator previews and explicitly applies safe fleet records', async ({ page }) => {
  await page.route('**/api/auth/company', (route) => route.fulfill({ json: {
    user: { displayName: 'Alpha Owner', email: 'owner@example.test', image: null },
    activeCompanyId: 'company-alpha',
    companies: [{ id: 'company-alpha', name: 'Alpha', role: 'OWNER' }],
  } }));
  await page.route('**/api/integrations/quickmanage', (route) => route.fulfill({ json: { configured: true } }));
  const preview = {
    id: 'sync-1', status: 'PREVIEWED', totalRows: 7,
    newRows: 2, matchedRows: 1, unchangedRows: 1, conflictRows: 2, invalidRows: 1,
    rows: [
      { id: '1', resourceType: 'TRUCK', disposition: 'NEW', message: 'New truck.' },
      { id: '2', resourceType: 'TRUCK', disposition: 'CONFLICT', message: 'Conflict.' },
      { id: '3', resourceType: 'TRAILER', disposition: 'MATCHED', message: 'Matched.' },
      { id: '4', resourceType: 'DRIVER', disposition: 'INVALID', message: 'Pay rate required.' },
      { id: '5', resourceType: 'CUSTOMER', disposition: 'NEW', message: 'New customer.' },
      { id: '6', resourceType: 'CUSTOMER', disposition: 'UNCHANGED', message: 'Unchanged.' },
      { id: '7', resourceType: 'CUSTOMER', disposition: 'CONFLICT', message: 'Conflict.' },
    ],
  };
  let applyCalls = 0;
  await page.route('**/api/integrations/quickmanage/sync', (route) => route.fulfill({ json: preview }));
  await page.route('**/api/integrations/quickmanage/sync/sync-1/apply', (route) => {
    applyCalls += 1;
    return route.fulfill({ json: { ...preview, status: 'APPLIED' } });
  });
  page.on('dialog', (dialog) => void dialog.accept());

  await page.goto('/administration/integrations/quickmanage');
  await page.getByRole('button', { name: 'Sync Fleet Data' }).click();
  await expect(page.getByRole('heading', { name: 'Fleet sync preview' })).toBeVisible();
  await expect(page.getByText('7 records reviewed · previewed')).toBeVisible();
  await expect(page.getByText('2 conflicts and 1 invalid records will not be applied.')).toBeVisible();
  await page.getByRole('button', { name: 'Apply Safe Records' }).click();
  await expect(page.getByRole('button', { name: 'Applied' })).toBeDisabled();
  expect(applyCalls).toBe(1);
});

test('Administrator reviews Trip conflicts before explicitly applying safe Loads', async ({ page }) => {
  await page.route('**/api/auth/company', (route) => route.fulfill({ json: {
    user: { displayName: 'Alpha Owner', email: 'owner@example.test', image: null }, activeCompanyId: 'company-alpha', companies: [{ id: 'company-alpha', name: 'Alpha', role: 'OWNER' }],
  } }));
  await page.route('**/api/integrations/quickmanage', (route) => route.fulfill({ json: { configured: true } }));
  const preview = { id: 'trip-sync-1', status: 'PREVIEWED', totalRows: 2, newRows: 1, matchedRows: 0, unchangedRows: 0, conflictRows: 0, invalidRows: 1, createdAt: '2026-08-29T10:00:00Z', appliedAt: null, rows: [
    { id: 'row-1', externalId: 'quickmanage-trip-1', resourceType: 'TRIP', disposition: 'NEW', message: 'New Trip.' },
    { id: 'row-2', externalId: 'quickmanage-trip-2', resourceType: 'TRIP', disposition: 'INVALID', message: 'Trip references an unsynchronized QuickManage driver.' },
  ] };
  let applyCalls = 0;
  await page.route('**/api/integrations/quickmanage/sync/trips', (route) => route.fulfill({ json: preview }));
  await page.route('**/api/integrations/quickmanage/sync/trips/trip-sync-1/apply', (route) => { applyCalls += 1; return route.fulfill({ json: { ...preview, status: 'APPLIED', appliedAt: '2026-08-29T10:01:00Z' } }); });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/administration/integrations/quickmanage');
  await page.getByRole('button', { name: 'Preview Trips / Loads' }).click();
  await expect(page.getByRole('heading', { name: 'Trip / Load sync preview' })).toBeVisible();
  await expect(page.getByText('quickmanage-trip-2')).toBeVisible();
  await expect(page.getByText('Trip references an unsynchronized QuickManage driver.')).toBeVisible();
  await page.getByRole('button', { name: 'Apply Safe Trips' }).click();
  await expect(page.getByRole('button', { name: 'Applied' }).last()).toBeDisabled();
  expect(applyCalls).toBe(1);
});
