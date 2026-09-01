import { expect, test } from 'playwright/test';

const companies = [
  { id: 'marybeg', name: 'Marybeg LLC', role: 'OWNER', canManage: true },
  { id: 'angels', name: 'Angels On The Road Inc.', role: 'OWNER', canManage: true },
  { id: 'turner', name: 'TURNER TRANSPORT LLC', role: 'OWNER', canManage: true },
  { id: 'caribe', name: 'Caribe Transport Inc', role: 'OWNER', canManage: true },
];

test('Trucks defaults active and supports authorized All Companies scope', async ({ page }) => {
  await page.route('**/api/auth/company', (route) => route.fulfill({ json: {
    user: { displayName: 'Fleet owner', email: 'owner@example.test', image: null },
    activeCompanyId: 'marybeg',
    companies,
  } }));
  await page.route('**/api/companies', (route) => route.fulfill({ json: [companies[0]] }));
  await page.route('**/api/trucks**', async (route) => {
    const url = new URL(route.request().url());
    const all = url.searchParams.get('company') === 'all';
    const items = all
      ? Array.from({ length: 58 }, (_, index) => ({
          id: `truck-${index}`,
          unitNumber: index === 0 ? '6009' : `T-${index}`,
          vin: null,
          year: 2025,
          make: 'Fleet',
          model: 'Truck',
          status: 'ACTIVE',
          companyId: index === 0 ? 'marybeg' : 'angels',
          company: index === 0 ? companies[0] : companies[1],
          cabType: 'SLEEPER',
          isOwnerOp: false,
          ownerName: null,
          canManage: true,
        }))
      : [{ id: 'truck-0', unitNumber: '6009', vin: null, year: 2025, make: 'Fleet', model: 'Truck', status: 'ACTIVE', companyId: 'marybeg', company: companies[0], cabType: 'SLEEPER', isOwnerOp: false, ownerName: null, canManage: true }];
    await route.fulfill({ json: {
      items,
      companies,
      activeCompanyId: 'marybeg',
      selectedCompany: all ? 'all' : 'marybeg',
      pagination: { page: 1, pageSize: 100, total: items.length, totalPages: 1 },
    } });
  });

  await page.goto('/trucks');
  await expect(page.getByText('1 total')).toBeVisible();
  await expect(page.getByText('Marybeg LLC').last()).toBeVisible();
  await page.getByLabel('Filter trucks by company').selectOption('all');
  await expect(page).toHaveURL(/company=all/);
  await expect(page.getByText('58 total')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Angels On The Road Inc.' }).first()).toBeVisible();
});

test('Trailer view preserves company labels and scoped filter controls', async ({ page }) => {
  await page.route('**/api/auth/company', (route) => route.fulfill({ json: {
    user: { displayName: 'Fleet owner', email: 'owner@example.test', image: null }, activeCompanyId: 'marybeg', companies,
  } }));
  for (const endpoint of ['dispatch/board', 'customers', 'trucks', 'drivers']) {
    await page.route(`**/api/${endpoint}**`, (route) => route.fulfill({ json: endpoint === 'dispatch/board' ? { columns: [] } : [] }));
  }
  await page.route('**/api/trailers**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('format') !== 'page') return route.fulfill({ json: [] });
    const all = url.searchParams.get('company') === 'all';
    const items = all ? [{
      id: 'trailer-1', unitNumber: 'SM510414', equipmentType: 'DRY_VAN', status: 'AVAILABLE', vin: null, plate: null,
      companyId: 'angels', company: companies[1], canManage: true, assignment: null, documents: [],
    }] : [];
    await route.fulfill({ json: {
      items, companies, activeCompanyId: 'marybeg', selectedCompany: all ? 'all' : 'marybeg',
      pagination: { page: 1, pageSize: 100, total: all ? 42 : 24, totalPages: 1 },
    } });
  });
  await page.goto('/loads?view=trailers');
  await expect(page.getByText('24 total')).toBeVisible();
  await page.getByLabel('Filter trailers by company').selectOption('all');
  await expect(page).toHaveURL(/company=all/);
  await expect(page.getByText('42 total')).toBeVisible();
  await expect(page.getByRole('article').getByText('Angels On The Road Inc.')).toBeVisible();
});
