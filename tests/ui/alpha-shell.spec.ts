import { expect, test, type Page } from 'playwright/test';

const companyContext = {
  user: {
    displayName: 'Alex Dispatcher',
    email: 'alex@fleetpilot.test',
    image: null,
  },
  activeCompanyId: 'company-alpha',
  companies: [
    { id: 'company-alpha', name: 'Alpha Transport', role: 'OWNER' },
    { id: 'company-beta', name: 'Beta Logistics', role: 'MEMBER' },
  ],
};

const dashboard = {
  activeLoads: 12,
  unassignedLoads: 3,
  availableTrucks: 8,
  availableTrailers: 11,
  activeDrivers: 24,
  loadsAtRisk: 2,
  overdueTasks: 4,
  pendingSettlements: 6,
  loadsThisWeek: 18,
  revenueThisWeek: 84250,
  recentLoads: [
    {
      id: 'load-1',
      loadNumber: 'FP-2048',
      origin: 'Houston, TX',
      destination: 'Dallas, TX',
      rate: 2500,
      status: 'IN_TRANSIT',
      truck: { unitNumber: 'T-101' },
      driver: { firstName: 'Maya', lastName: 'Chen' },
    },
    {
      id: 'load-2',
      loadNumber: 'FP-2049',
      origin: 'Laredo, TX',
      destination: 'Phoenix, AZ',
      rate: 4100,
      status: 'PLANNED',
      truck: null,
      driver: null,
    },
  ],
  recentActivity: [
    {
      id: 'task:1',
      type: 'task',
      action: 'COMMENT_ADDED',
      title: 'Confirm delivery appointment',
      actor: 'Alex Dispatcher',
      occurredAt: '2026-07-31T08:00:00.000Z',
    },
    {
      id: 'load:1',
      type: 'load',
      action: 'STATUS_CHANGED',
      title: 'Load FP-2048',
      actor: 'Maya Chen',
      occurredAt: '2026-07-31T07:30:00.000Z',
    },
  ],
};

async function mockShell(page: Page) {
  await page.route('**/api/auth/company', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ json: { companyId: 'company-beta', role: 'MEMBER' } });
      return;
    }
    await route.fulfill({ json: companyContext });
  });
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: dashboard }));
}

test.beforeEach(async ({ page }) => {
  await mockShell(page);
});

test('renders the modern dashboard without requesting QuickManage', async ({ page }) => {
  let quickManageRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/qm-stats')) quickManageRequests += 1;
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good morning, dispatch' })).toBeVisible();
  await expect(page.getByText('QuickManage integration')).toBeVisible();
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'FP-2048' })).toBeVisible();
  expect(quickManageRequests).toBe(0);
});

test('exposes every completed module and supports sidebar collapse and mobile navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');

  const expectedLinks = [
    ['Dashboard', '/'],
    ['Dispatch Board', '/loads?view=dispatch'],
    ['Loads', '/loads?view=loads'],
    ['Customers', '/loads?view=customers'],
    ['Trucks', '/trucks'],
    ['Trailers', '/loads?view=trailers'],
    ['Drivers', '/drivers'],
    ['Inspections', '/inspections'],
    ['Task Manager', '/tasks'],
    ['Settlements', '/settlements'],
    ['Finance', '/finance'],
    ['Companies', '/companies'],
    ['HR', '/hr/employees'],
  ] as const;

  for (const [name, href] of expectedLinks) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute(
      'href',
      href,
    );
  }
  await expect(
    page.locator('[aria-disabled="true"]').filter({ hasText: 'Inbox' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(
    page.locator('nav[aria-label="Primary navigation"]:visible'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close navigation' }).click();
  await expect(
    page.locator('nav[aria-label="Primary navigation"]:visible'),
  ).toHaveCount(0);
});

test('captures desktop and mobile Internal Alpha shell references', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('cell', { name: 'FP-2048' })).toBeVisible();
  await page.screenshot({
    path: 'docs/screenshots/alpha-dashboard-desktop.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator('.alpha-shell-content')
        .evaluate((element) => getComputedStyle(element).paddingLeft),
    )
    .toBe('0px');
  await expect
    .poll(() =>
      page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        x: document.querySelector('.alpha-shell-content')?.getBoundingClientRect().x,
      })),
    )
    .toEqual({ width: 390, x: 0 });
  await page.screenshot({
    path: 'docs/screenshots/alpha-dashboard-mobile.png',
    fullPage: true,
  });
});
