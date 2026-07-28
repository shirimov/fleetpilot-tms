import { expect, test } from 'playwright/test';

test('company-owned APIs reject unauthenticated requests consistently', async ({
  request,
}) => {
  const [tasks, companies, switchCompany] = await Promise.all([
    request.get('/api/tasks'),
    request.get('/api/companies'),
    request.patch('/api/auth/company', {
      data: { companyId: 'spoofed-company' },
    }),
  ]);

  expect(tasks.status()).toBe(401);
  expect(companies.status()).toBe(401);
  expect(switchCompany.status()).toBe(401);
  await expect(tasks.json()).resolves.toEqual({
    error: 'Authentication is required.',
  });
});
