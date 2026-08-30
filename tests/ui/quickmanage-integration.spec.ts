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
      : { configured: true, connectedAccountName: null, mappedCompanyName: 'Alpha', identityStatus: 'UNVERIFIED', applyEnabled: false, identityMessage: 'Official identity unavailable.' } });
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

test('Administrator previews trucks only and apply follows the verified identity gate', async ({ page }) => {
  await page.route('**/api/auth/company', (route) => route.fulfill({ json: {
    user: { displayName: 'Alpha Owner', email: 'owner@example.test', image: null },
    activeCompanyId: 'company-alpha',
    companies: [{ id: 'company-alpha', name: 'Alpha', role: 'OWNER' }],
  } }));
  await page.route('**/api/integrations/quickmanage', (route) => route.fulfill({ json: {
    configured: true, connectedAccountName: 'Verified carrier', mappedCompanyName: 'Alpha',
    identityStatus: 'VERIFIED', applyEnabled: true, identityMessage: 'Verified.',
  } }));
  const preview = {
    id: 'sync-1', status: 'PREVIEWED', resourceType: 'TRUCK', fleetPilotRecordCount: 4, totalRows: 2,
    newRows: 1, matchedRows: 0, unchangedRows: 0, conflictRows: 1, invalidRows: 0,
    rows: [
      { id: '1', resourceType: 'TRUCK', disposition: 'NEW', message: 'New truck.' },
      { id: '2', resourceType: 'TRUCK', disposition: 'CONFLICT', message: 'Conflict.' },
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
  await page.getByRole('button', { name: 'Fetch / Preview Trucks' }).click();
  await expect(page.getByRole('heading', { name: 'Truck sync preview' })).toBeVisible();
  await expect(page.getByText('2 QuickManage trucks · 4 FleetPilot trucks · previewed')).toBeVisible();
  await expect(page.getByText('1 conflicts and 0 invalid records will not be applied.')).toBeVisible();
  await page.getByRole('button', { name: 'Apply Safe Trucks' }).click();
  await expect(page.getByRole('button', { name: 'Applied' })).toBeDisabled();
  expect(applyCalls).toBe(1);
});

test('unverified QuickManage identity keeps truck apply disabled', async ({ page }) => {
  await page.route('**/api/auth/company', (route) => route.fulfill({ json: {
    user: { displayName: 'Alpha Owner', email: 'owner@example.test', image: null }, activeCompanyId: 'company-alpha',
    companies: [{ id: 'company-alpha', name: 'Alpha', role: 'OWNER' }],
  } }));
  await page.route('**/api/integrations/quickmanage', (route) => route.fulfill({ json: {
    configured: true, connectedAccountName: null, mappedCompanyName: 'Alpha', identityStatus: 'UNVERIFIED',
    applyEnabled: false, identityMessage: 'Official identity unavailable.',
  } }));
  await page.route('**/api/integrations/quickmanage/sync', (route) => route.fulfill({ json: {
    id: 'sync-2', status: 'PREVIEWED', resourceType: 'TRUCK', fleetPilotRecordCount: 0, totalRows: 0,
    newRows: 0, matchedRows: 0, unchangedRows: 0, conflictRows: 0, invalidRows: 0, rows: [],
  } }));
  await page.goto('/administration/integrations/quickmanage');
  await page.getByRole('button', { name: 'Fetch / Preview Trucks' }).click();
  await expect(page.getByRole('button', { name: 'Apply Safe Trucks' })).toBeDisabled();
  await expect(page.getByText('Blocked until identity is verified')).toBeVisible();
});

test('administrator explicitly maps a discovered carrier by UUID without auto apply', async ({ page }) => {
  await page.route('**/api/auth/company', route=>route.fulfill({json:{user:{displayName:'Owner'},activeCompanyId:'company-a',companies:[{id:'company-a',name:'Alpha',role:'OWNER'}]}}));
  await page.route('**/api/integrations/quickmanage', route=>route.fulfill({json:{configured:true,connectedAccountName:null,mappedCompanyName:'Alpha',identityStatus:'UNVERIFIED',applyEnabled:false,identityMessage:'Official identity unavailable.'}}));
  let mappingPosts=0;
  await page.route('**/api/integrations/quickmanage/mappings', route=>{
    if(route.request().method()==='POST'){mappingPosts+=1;return route.fulfill({json:{id:'mapping-1'}});}
    return route.fulfill({json:{carriers:[{carrierId:'carrier-stable-uuid',carrierName:'Carrier A',truckCount:12,companyId:null,status:'UNMAPPED'}],companies:[{id:'company-a',name:'Alpha'}]}});
  });
  page.on('dialog',dialog=>void dialog.accept());
  await page.goto('/administration/integrations/quickmanage');
  await expect(page.getByRole('heading',{name:'Company Mappings'})).toBeVisible();
  await expect(page.getByText('carrier-stable-uuid')).toBeVisible();
  await page.getByLabel('FleetPilot company for Carrier A').selectOption('company-a');
  await expect(page.getByText('Carrier mapping verified. Staged rows were reclassified; Apply was not started.')).toBeVisible();
  expect(mappingPosts).toBe(1);
});
