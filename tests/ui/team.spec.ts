import { test, expect } from '@playwright/test';

const companyId = process.env.TEST_COMPANY_ID as string;
const ownerId = process.env.TEST_OWNER_ID as string;

if (!companyId || !ownerId) {
  throw new Error('TEST_COMPANY_ID and TEST_OWNER_ID must be set for team.spec.ts');
}

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

  // Mock the team API to return a deterministic seeded member for UI tests.
  await page.route('**/api/company/team**', async (route) => {
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
    await route.fulfill({ json: { members, currentUserRole: 'OWNER' } });
  });
});

test('Administration → Team renders and Add Member modal works', async ({ page }) => {
  await page.goto('/administration');
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible({ timeout: 10000 });

  // Open Add Member modal and test accessible dialog behavior
  const addTrigger = page.getByRole('button', { name: 'Add Member' });
  await addTrigger.click();

  // Modal is rendered and has accessible dialog name
  const dialog = page.getByRole('dialog', { name: 'Add Member' });
  await expect(dialog).toBeVisible({ timeout: 10000 });

  // Initial focus should be inside the modal (email input is initialFocus)
  const email = page.getByLabel('Email');
  await expect(email).toBeFocused({ timeout: 5000 });

  // Tab and Shift+Tab should trap focus inside the dialog
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  // Active element should remain inside the dialog form
  const activeInDialog = await page.evaluate(() => {
    const form = document.getElementById('add-member-form');
    return form ? form.contains(document.activeElement) : false;
  });
  expect(activeInDialog).toBe(true);

  // Shift+Tab backwards
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  const activeStillInDialog = await page.evaluate(() => {
    const form = document.getElementById('add-member-form');
    return form ? form.contains(document.activeElement) : false;
  });
  expect(activeStillInDialog).toBe(true);

  // Escape closes modal and restores focus to trigger
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 5000 });
  await expect(addTrigger).toBeFocused();
});
