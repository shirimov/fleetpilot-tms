import { expect, test } from 'playwright/test';

test('company-owned APIs reject unauthenticated requests consistently', async ({
  request,
}) => {
  const responses = await Promise.all([
    request.get('/api/tasks'),
    request.get('/api/companies'),
    request.get('/api/dashboard'),
    request.get('/api/trucks'),
    request.get('/api/inspections/truck'),
    request.get('/api/inspections/driver'),
    request.get('/api/settlements'),
    request.get('/api/plaid/accounts'),
    request.get('/api/inbox'),
    request.get('/api/uploads/inspections/fake/file.jpg'),
    request.get('/api/reserve'),
    request.get('/api/tmfund'),
    request.post('/api/trucks', { data: { companyId: 'spoofed-company' } }),
    request.post('/api/inspections/truck', {
      data: { truckId: 'foreign-truck' },
    }),
    request.patch('/api/auth/company', {
      data: { companyId: 'spoofed-company' },
    }),
  ]);

  for (const response of responses) {
    expect(response.status()).toBe(401);
  }
  await expect(responses[0].json()).resolves.toEqual({
    error: 'Authentication is required.',
  });
});
