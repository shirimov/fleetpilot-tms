import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from 'playwright/test';
import { prisma } from '@/lib/prisma';

async function issueToken(userId: string, email: string) {
  const token = randomBytes(32).toString('base64url');
  await prisma.emailSignInToken.create({ data: { userId, email, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
  return token;
}

test('OWNER previews and explicitly commits canonical trucks without overwriting matches', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const company = await prisma.company.create({ data: { name: `Truck Import UI ${suffix}` } });
  const owner = await prisma.user.create({ data: { email: `truck-import-ui-${suffix}@example.test`, displayName: 'Fleet Owner', activeCompanyId: company.id, memberships: { create: { companyId: company.id, role: 'OWNER' } } } });
  try {
    await page.goto(`/login/email/verify#token=${await issueToken(owner.id, owner.email)}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
    await page.goto('/trucks');
    await expect(page.getByTestId('truck-import-panel')).toBeVisible();
    await page.locator('input[type=file][accept=".csv,.xlsx"]').setInputFiles({
      name: `fleet-${suffix}.csv`, mimeType: 'text/csv',
      buffer: Buffer.from(`Unit Number,Status,Year,Make,Model\n0037,ACTIVE,2024,Freightliner,Cascadia\n125,MAINTENANCE,2022,Volvo,VNL`),
    });
    await expect(page.getByText('NEW', { exact: true })).toHaveCount(2);
    await expect(page.getByText('0037', { exact: true })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Commit 2 new trucks' }).click();
    await expect(page.getByText('Import committed. Existing trucks were not modified.')).toBeVisible();
    const fleetRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '0037', exact: true }) }).filter({ has: page.getByRole('button', { name: 'Edit' }) });
    await expect(fleetRow).toBeVisible();
    expect(await prisma.truck.count({ where: { companyId: company.id } })).toBe(2);
    page.once('dialog', dialog => dialog.accept());
    await fleetRow.getByRole('button', { name: 'Deactivate' }).click();
    await expect(fleetRow).toHaveCount(0);
    await page.getByRole('button', { name: 'inactive', exact: true }).click();
    await expect(fleetRow).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await fleetRow.getByRole('button', { name: 'Reactivate' }).click();
    await expect(fleetRow).toHaveCount(0);
    await page.getByRole('button', { name: 'active', exact: true }).click();
    await expect(fleetRow).toBeVisible();
  } finally {
    await prisma.truckLifecycleEvent.deleteMany({ where: { companyId: company.id } });
    await prisma.truckImportRow.deleteMany({ where: { batch: { companyId: company.id } } });
    await prisma.truckImportBatch.deleteMany({ where: { companyId: company.id } });
    await prisma.truck.deleteMany({ where: { companyId: company.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
});
