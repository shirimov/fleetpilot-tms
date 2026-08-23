import { expect, test } from 'playwright/test';

const profilePayload = {
  profile: {
    id: 'employee-julia', firstName: 'Julia', lastName: 'Worker', preferredName: 'Julia',
    jobTitle: 'Insurance Specialist', department: 'Operations', employmentStatus: 'ACTIVE',
    workLocation: 'Chicago', timezone: 'America/Chicago', email: 'julia@example.test', phone: '+1 555 0100',
    startDate: '2024-04-01T00:00:00.000Z', photoUrl: null, user: { isActive: true },
    telegram: { connected: true, username: 'julia_worker' }, manager: { firstName: 'Mary', lastName: 'Manager' },
    scheduleDays: [
      { weekday: 1, isWorking: true, startMinute: 480, endMinute: 1020, breakMinutes: 60, capacityMinutes: 390 },
      { weekday: 6, isWorking: true, startMinute: 1320, endMinute: 360, breakMinutes: 30, capacityMinutes: 360 },
    ],
    skills: [{ skill: { id: 'insurance', name: 'Insurance', isActive: true } }],
    salary: 5000, currency: 'USD', payType: 'SALARY', payFrequency: 'MONTHLY',
  },
  capacity: {
    expectedTaskCapacityMinutes: 390, assignedRemainingExpectedMinutes: 210,
    freeCapacityMinutes: 180, utilizationPercentage: 53.8, dueTodayCount: 2, overdueCount: 1,
    taskCount: { complete: 3, total: 5 }, weightedCompletion: { percentage: 62 },
  },
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/company', (route) => route.fulfill({ json: { user: { id: 'owner', displayName: 'Owner', email: 'owner@example.test' }, companies: [] } }));
  await page.route('**/api/workforce/employees/employee-julia', (route) => route.fulfill({ json: profilePayload }));
  await page.route('**/api/workforce/employees/employee-julia/schedule', async (route) => route.fulfill({ json: { schedule: (await route.request().postDataJSON()).days } }));
});

test('employee profile shows identity, safe workload, schedule, skills, and compensation', async ({ page }) => {
  await page.goto('/hr/employees/employee-julia');
  await expect(page.getByRole('heading', { name: 'Julia' })).toBeVisible();
  await expect(page.getByLabel('Initials avatar')).toContainText('JW');
  await expect(page.getByText('210m')).toBeVisible();
  await expect(page.getByText('62%')).toBeVisible();
  await expect(page.getByLabel('Saturday start')).toHaveValue('22:00');
  await expect(page.getByText('Insurance', { exact: true })).toBeVisible();
  await expect(page.getByText('5,000 USD')).toBeVisible();
});

test('employee profile remains usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/hr/employees/employee-julia');
  await expect(page.getByRole('heading', { name: 'Julia' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});

test('schedule editor preserves overnight shifts and saves all weekdays', async ({ page }) => {
  let savedDays: Array<{ weekday: number; capacityMinutes: number }> = [];
  await page.route('**/api/workforce/employees/employee-julia/schedule', async (route) => { savedDays = (await route.request().postDataJSON()).days; await route.fulfill({ json: { schedule: savedDays } }); });
  await page.goto('/hr/employees/employee-julia');
  await page.getByLabel('Saturday capacity minutes').fill('420');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect.poll(() => savedDays.length).toBe(7);
  expect(savedDays.find((day) => day.weekday === 6)?.capacityMinutes).toBe(420);
});
