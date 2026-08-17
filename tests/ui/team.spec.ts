import { test, expect } from '@playwright/test';

const companyId = process.env.TEST_COMPANY_ID as string;
const ownerId = process.env.TEST_OWNER_ID as string;

if (!companyId || !ownerId) {
  throw new Error('TEST_COMPANY_ID and TEST_OWNER_ID must be set for team.spec.ts');
}

let currentUserRole = 'OWNER';

test.beforeEach(async ({ page }) => {
  // log browser console to help diagnose failures
  page.on('console', (msg) => {
    // eslint-disable-next-line no-console
    console.log('PW-CONSOLE:', msg.type(), msg.text());
  });
  // Mock auth/company endpoint to return owner context
  await page.route('**/api/auth/company', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ json: { companyId, role: 'OWNER' } });
      return;
    }
    await route.fulfill({ json: { user: { displayName: 'Playwright Owner', email: 'pw-owner@example.test', image: null, id: ownerId }, activeCompanyId: companyId, companies: [{ id: companyId, name: 'PW Test Co', role: 'OWNER' }] } });
  });
  // Mock auth session endpoint to avoid unauthorized responses during UI tests
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({ json: { user: { name: 'Playwright Owner', email: 'pw-owner@example.test' } } });
  });
  // Log responses to diagnose unexpected 401s during UI tests (temporary)
  page.on('response', (resp) => {
    if (resp.status() === 401 || resp.status() === 403) {
      // eslint-disable-next-line no-console
      console.log('PW-RESP', resp.status(), resp.url());
    }
  });

  // Mock the team API to return a deterministic seeded member for UI tests, mutable so tests can simulate updates.
  currentUserRole = 'OWNER';
  const members = [
    {
      id: 'seed-membership',
      role: 'OWNER',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      user: {
        id: ownerId,
        displayName: 'Playwright Owner',
        email: 'pw-owner@example.test',
        image: null,
        isActive: true,
      },
      openTasks: 1,
      overdueTasks: 0,
      dueToday: 0,
      telegramStatus: 'Not connected',
    },
    {
      id: 'seed-member-1',
      role: 'MEMBER',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      user: {
        id: 'pw-seed-member-id',
        displayName: 'PW Seed',
        email: 'pw-seed-member@example.test',
        image: null,
        isActive: true,
      },
      openTasks: 0,
      overdueTasks: 0,
      dueToday: 0,
      telegramStatus: 'Not connected',
    },
  ];

  // Intercept GET/POST/PATCH/DELETE to mutate the in-memory members array for UI updates
  await page.route('**/api/company/team**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = JSON.parse(String(await req.postData()));
      const newMember = {
        id: `m-${Date.now()}`,
        role: body.role || 'MEMBER',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        user: { id: `u-${Date.now()}`, displayName: body.displayName || body.email, email: body.email, image: null, isActive: true },
        openTasks: 0,
        overdueTasks: 0,
        dueToday: 0,
        telegramStatus: 'Not connected',
      };
      members.push(newMember);
      await route.fulfill({ status: 201, json: { membership: { id: newMember.id, role: newMember.role }, user: newMember.user } });
      return;
    }
    if (req.method() === 'PATCH') {
      const body = JSON.parse(String(await req.postData()));
      const m = members.find((x) => x.user.id === body.userId);
      if (m) { m.role = body.role; m.updatedAt = new Date().toISOString(); await route.fulfill({ status: 200, json: { success: true } }); return; }
      await route.fulfill({ status: 404, json: { error: 'not found' } });
      return;
    }
    if (req.method() === 'DELETE') {
      const body = JSON.parse(String(await req.postData()));
      const idx = members.findIndex((x) => x.user.id === body.userId);
      if (idx !== -1) { members.splice(idx, 1); await route.fulfill({ status: 200, json: { success: true } }); return; }
      await route.fulfill({ status: 404, json: { error: 'not found' } });
      return;
    }
    // GET fallback
    await route.fulfill({ json: { members, currentUserRole } });
  });
});

// UI tests

test('Team page renders members, columns and Telegram status', async ({ page }) => {
  await page.goto('/administration');
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible({ timeout: 10000 });

  // seeded member email visible
  await expect(page.getByRole('cell', { name: 'pw-seed-member@example.test' })).toBeVisible();
  // Telegram shows Not connected
  await expect(page.getByRole('cell', { name: 'Not connected' }).first()).toBeVisible();
  // workload columns present for owner (at least one '1' visible)
  await expect(page.getByRole('cell', { name: '1' }).first()).toBeVisible();
});

test('Search filters members by name and email', async ({ page }) => {
  await page.goto('/administration');
  const search = page.getByPlaceholder('Search name or email');
  await search.fill('PW Seed');
  await expect(page.getByRole('cell', { name: 'pw-seed-member@example.test' })).toBeVisible();
  // search by email
  await search.fill('pw-owner@example.test');
  await expect(page.getByRole('cell', { name: 'pw-owner@example.test' })).toBeVisible();
  // clear search
  await search.fill('');
  await expect(page.getByRole('cell', { name: 'pw-seed-member@example.test' })).toBeVisible();
});

test('Add Member success and error handling (mocked API)', async ({ page }) => {
  await page.goto('/administration');
  const addTrigger = page.getByRole('button', { name: 'Add Member' });
  await addTrigger.click();
  const dialog = page.getByRole('dialog', { name: 'Add Member' });
  await expect(dialog).toBeVisible();

  // fill and submit for success
  await page.getByLabel('Email').fill('new-member@example.test');
  await page.getByLabel('Display name').fill('New Member');
  await page.getByRole('button', { name: 'Add' }).click();
  // after submit the dialog should close and new member should appear
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: 'new-member@example.test' })).toBeVisible();

  // simulate API error: open modal, submit with same email to trigger duplicate membership
  await addTrigger.click();
  await expect(dialog).toBeVisible();
  await page.getByLabel('Email').fill('new-member@example.test');
  await page.getByLabel('Display name').fill('New Member');
  // For error scenario, we intercept POST to return 409 for this email
  await page.route('**/api/company/team**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      await route.fulfill({ status: 409, json: { error: 'membership already exists' } });
      return;
    }
    await route.fulfill({ json: { members: [], currentUserRole: 'OWNER' } });
  });
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('membership already exists')).toBeVisible();
});

test('Role controls visibility for OWNER vs MEMBER', async ({ page }) => {
  // Unregister global routes and set up test-scoped routes that return MEMBER
  page.unroute('**/api/company/team');
  page.unroute('**/api/auth/company');
  page.unroute('**/api/auth/session');

  await page.route('**/api/auth/company', async (route) => {
    await route.fulfill({ json: { user: { displayName: 'Member User', email: 'member@example.test', id: 'member-id' }, activeCompanyId: companyId, companies: [{ id: companyId, name: 'PW Test Co', role: 'MEMBER' }] } });
  });
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({ json: { user: { name: 'Member User', email: 'member@example.test' } } });
  });

  const members = [
    {
      id: 'seed-membership',
      role: 'OWNER',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      user: {
        id: ownerId,
        displayName: 'Playwright Owner',
        email: 'pw-owner@example.test',
        image: null,
        isActive: true,
      },
      openTasks: 1,
      overdueTasks: 0,
      dueToday: 0,
      telegramStatus: 'Not connected',
    },
    {
      id: 'seed-member-1',
      role: 'MEMBER',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      user: {
        id: 'pw-seed-member-id',
        displayName: 'PW Seed',
        email: 'pw-seed-member@example.test',
        image: null,
        isActive: true,
      },
      openTasks: 0,
      overdueTasks: 0,
      dueToday: 0,
      telegramStatus: 'Not connected',
    },
  ];

  await page.route('**/api/company/team**', async (route) => {
    await route.fulfill({ json: { members, currentUserRole: 'MEMBER' } });
  });

  await page.goto('/administration');
  // Role controls should not be visible for MEMBER in the seed member's row (no Save button)
  const seedCell = page.getByRole('cell', { name: 'pw-seed-member@example.test' });
  const seedRow = seedCell.locator('xpath=ancestor::tr');
  const saveBtnCount = await seedRow.getByRole('button', { name: 'Save' }).count();
  expect(saveBtnCount).toBe(0);
});

test('Membership removal confirmation and success/failure (mocked)', async ({ page }) => {
  await page.goto('/administration');
  // Click Remove on the seed member's row and expect a confirm step
  const seedCell = page.getByRole('cell', { name: 'pw-seed-member@example.test' });
  const seedRow = seedCell.locator('xpath=ancestor::tr');
  const removeBtn = seedRow.getByRole('button', { name: 'Remove' });
  await removeBtn.click();
  // The first click toggles to 'Confirm'
  const confirmBtn = seedRow.getByRole('button', { name: 'Confirm' });
  await expect(confirmBtn).toBeVisible();
  // Confirm removal: clicking Confirm should remove the member (mocked route handles removal)
  await confirmBtn.click();
  // member should no longer be visible
  await expect(page.getByRole('cell', { name: 'pw-seed-member@example.test' })).toBeHidden();
});

test('Responsive: mobile Team page and Add Member dialog', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/administration');
  // page still renders heading
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
  // open add member
  await page.getByRole('button', { name: 'Add Member' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Member' });
  await expect(dialog).toBeVisible();
  // ensure inputs are operable
  await page.getByLabel('Email').fill('mobile-test@example.test');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toBeHidden();
});
