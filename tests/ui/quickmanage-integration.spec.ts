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
  await expect(page.getByRole('heading', { name: 'QuickManage', exact: true })).toBeVisible();
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

test('Administrator explores live QuickManage records, relationships and report content without credentials', async ({ page }) => {
  await page.route('**/api/auth/company', (route) => route.fulfill({ json: {
    user: { displayName: 'Alpha Owner', email: 'owner@example.test', image: null }, activeCompanyId: 'company-alpha', companies: [{ id: 'company-alpha', name: 'Alpha', role: 'OWNER' }],
  } }));
  await page.route('**/api/integrations/quickmanage', (route) => route.fulfill({ json: { configured: true } }));
  const explorerRequests: string[] = [];
  await page.route('**/api/integrations/quickmanage/explorer?**', async (route) => {
    const url = new URL(route.request().url()); explorerRequests.push(url.search);
    const resource = url.searchParams.get('resource');
    if (resource === 'trips') return route.fulfill({ json: { resource, fetchedAt: '2026-08-29T12:00:00Z', total: 1, page: 0, pageSize: 20, links: {}, items: [{ id: '11111111-1111-4111-8111-111111111111', trip_num: 42, status: 'delivered', stops: [{ assigned_truck: { id: '22222222-2222-4222-8222-222222222222', number: '125' }, assigned_drivers: [], assigned_trailer: null, assigned_customer: null }] }] } });
    if (resource === 'trucks') return route.fulfill({ json: { resource, fetchedAt: '2026-08-29T12:00:01Z', total: 1, page: 0, pageSize: 20, links: { '22222222-2222-4222-8222-222222222222': { linked: true, entityId: 'fleet-truck' } }, items: [{ id: '22222222-2222-4222-8222-222222222222', unit: '125', status: 'active' }] } });
    if (resource === 'reports') return route.fulfill({ json: { resource, fetchedAt: '2026-08-29T12:00:02Z', page: 0, pageSize: 50, hasMore: false, links: {}, items: [{ id: '33333333-3333-4333-8333-333333333333', type: 'trip', number: 7 }] } });
    if (resource === 'report-content') return route.fulfill({ json: { resource, fetchedAt: '2026-08-29T12:00:03Z', links: {}, item: { header: ['Trip report'], content: { columns: [{ cid: 0, key: 'amount' }], rows: [{ 0: 12.5 }] } } } });
    return route.fulfill({ json: { resource, fetchedAt: '2026-08-29T12:00:00Z', total: 0, page: 0, pageSize: 20, links: {}, items: [] } });
  });

  await page.goto('/administration/integrations/quickmanage');
  await expect(page.getByRole('heading', { name: 'QuickManage Data Explorer' })).toBeVisible();
  await page.getByRole('button', { name: 'Trips / Loads', exact: true }).click();
  await page.getByRole('button', { name: 'Fetch live data' }).click();
  await expect(page.getByRole('heading', { name: '42', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('button', { name: 'Truck', exact: true }).click();
  await expect(page.getByText('Linked to FleetPilot')).toBeVisible();
  expect(explorerRequests.some((query) => query.includes('resource=trucks') && query.includes('field=id'))).toBe(true);
  await page.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('button', { name: 'Find related Trips' }).click();
  expect(explorerRequests.some((query) => query.includes('resource=trips') && query.includes('field=assigned_truck_ids'))).toBe(true);

  await page.getByRole('button', { name: 'Reports' }).click();
  await page.getByRole('button', { name: 'Fetch live data' }).click();
  await page.getByRole('button', { name: 'View details' }).click();
  await expect(page.getByRole('heading', { name: 'Report line items' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Report line items' }).locator('..').getByText('12.5')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/access_token|client_secret|Bearer secret/);
});
