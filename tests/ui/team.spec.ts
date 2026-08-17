import { test, expect } from '@playwright/test';

const companyId = process.env.TEST_COMPANY_ID as string;
const ownerId = process.env.TEST_OWNER_ID as string;

if (!companyId || !ownerId) {
  throw new Error('TEST_COMPANY_ID and TEST_OWNER_ID must be set for team.spec.ts');
}

test.beforeEach(async ({ page }) => {
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

  // Open Add Member modal
  await page.getByRole('button', { name: 'Add Member' }).click();
  // the modal does not expose role=dialog, wait for the form fields to appear
  await expect(page.getByLabel('Display name')).toBeVisible({ timeout: 10000 });

  // Verify seeded member appears in the list
  const seededEmail = 'pw-seed-member@example.test';
  await expect(page.getByRole('cell', { name: seededEmail })).toBeVisible({ timeout: 10000 });

  // Open Add Member modal and test keyboard/focus behavior
  await page.getByRole('button', { name: 'Add Member' }).click();
  await expect(page.getByLabel('Display name')).toBeVisible({ timeout: 10000 });
  // Press Escape to close
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Display name')).toBeHidden();
});
