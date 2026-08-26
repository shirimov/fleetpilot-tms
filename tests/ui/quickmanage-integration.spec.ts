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
