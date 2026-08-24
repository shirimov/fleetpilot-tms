import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from 'playwright/test';
import { prisma } from '@/lib/prisma';

async function issueToken(userId: string, email: string) {
  const token = randomBytes(32).toString('base64url');
  await prisma.emailSignInToken.create({ data: { userId, email, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
  return token;
}

test('OWNER completes the manual Accounting evidence workflow and MEMBER is denied', async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const company = await prisma.company.create({ data: { name: `Accounting UI ${suffix}` } });
  const [owner, member] = await Promise.all([
    prisma.user.create({ data: { email: `accounting-owner-${suffix}@example.test`, displayName: 'Accounting Owner', activeCompanyId: company.id, memberships: { create: { companyId: company.id, role: 'OWNER' } } } }),
    prisma.user.create({ data: { email: `accounting-member-${suffix}@example.test`, displayName: 'Accounting Member', activeCompanyId: company.id, memberships: { create: { companyId: company.id, role: 'MEMBER' } } } }),
  ]);
  const truck = await prisma.truck.create({ data: { companyId: company.id, unitNumber: `ACC-${suffix}` } });
  try {
    await page.goto(`/login/email/verify#token=${await issueToken(owner.id, owner.email)}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
    await page.goto('/accounting');
    await expect(page.getByRole('heading', { name: 'Financial Control & Reconciliation' })).toBeVisible();
    await page.getByPlaceholder('Marybeg Group').fill(`Accounting Group ${suffix}`);
    await page.getByRole('button', { name: 'Create operating group' }).click();
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible();

    await page.getByRole('button', { name: 'Sources' }).click();
    await page.getByPlaceholder('Bank of America Operating').fill(`Operating Bank ${suffix}`);
    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(page.getByText(`Operating Bank ${suffix}`, { exact: true })).toBeVisible();
    await page.getByPlaceholder('Bank of America Operating').fill(`Reserve Bank ${suffix}`);
    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(page.getByText(`Reserve Bank ${suffix}`, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Statements' }).click();
    const uploadForm = page.getByRole('heading', { name: 'Upload statement' }).locator('xpath=ancestor::form');
    await uploadForm.getByRole('combobox').first().selectOption({ label: `Operating Bank ${suffix}` });
    await page.locator('input[name="periodStart"]').fill('2026-08-01');
    await page.locator('input[name="periodEnd"]').fill('2026-08-31');
    await page.locator('input[type="file"]').setInputFiles({ name: 'august.csv', mimeType: 'text/csv', buffer: Buffer.from('date,description,amount,reference\n2026-08-02,Amazon settlement,48320.00,AMZ-1\n') });
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('august.csv', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Transactions' }).click();
    await page.locator('input[name="transactionDate"]').fill('2026-08-02');
    await page.getByPlaceholder('Description').fill('Amazon settlement');
    await page.getByPlaceholder('48320.00').fill('48320.00');
    await page.getByRole('button', { name: 'Add transaction' }).click();
    const transaction = page.getByText('Amazon settlement', { exact: true }).last().locator('xpath=ancestor::article');
    await transaction.getByPlaceholder('Amount').fill('48320.00');
    await transaction.getByRole('combobox').first().selectOption({ index: 1 });
    await transaction.getByRole('button', { name: 'Match' }).click();
    await expect(transaction.getByText(/MATCHED/)).toBeVisible();
    await transaction.getByRole('combobox').nth(1).selectOption({ label: 'Freight Revenue' });
    await transaction.getByRole('combobox').nth(2).selectOption({ label: `Truck ${truck.unitNumber}` });
    await transaction.getByRole('button', { name: 'Allocate' }).click();
    await expect(transaction.getByText(/RECONCILED/)).toBeVisible();

    const transactionForm = page.getByRole('heading', { name: 'Add normalized transaction' }).locator('xpath=ancestor::form');
    await transactionForm.locator('input[name="transactionDate"]').fill('2026-08-03');
    await transactionForm.getByPlaceholder('Description').fill('Move operating cash');
    await transactionForm.getByPlaceholder('48320.00').fill('1000.00');
    await transactionForm.locator('select[name="direction"]').selectOption('TRANSFER');
    await transactionForm.locator('select[name="sourceId"]').selectOption({ label: `Operating Bank ${suffix}` });
    await transactionForm.locator('select[name="destinationSourceId"]').selectOption({ label: `Reserve Bank ${suffix}` });
    await transactionForm.getByRole('button', { name: 'Add transaction' }).click();
    await expect(page.getByText('Move operating cash', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Overview' }).click();
    await expect(page.getByText('Transfers').locator('xpath=..').getByText('1', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Audit Center' }).click();
    await expect(page.getByText('Possible duplicates')).toBeVisible();

    await page.getByRole('button', { name: 'Open profile menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login');
    await page.goto(`/login/email/verify#token=${await issueToken(member.id, member.email)}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
    const denied = await page.request.get('/api/finance/overview');
    expect(denied.status()).toBe(403);
    await page.goto('/accounting');
    await expect(page).toHaveURL('/accounting');
    await expect(page.getByText('Access denied', { exact: true })).toBeVisible();
  } finally {
    const group = await prisma.operatingGroupCompany.findUnique({ where: { companyId: company.id }, select: { operatingGroupId: true } });
    if (group) {
      const groupId = group.operatingGroupId;
      await prisma.financialAllocation.deleteMany({ where: { transaction: { operatingGroupId: groupId } } });
      await prisma.financialTransactionEvidence.deleteMany({ where: { transaction: { operatingGroupId: groupId } } });
      await prisma.financialAuditEvent.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.financialTransaction.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.financialImportRecord.deleteMany({ where: { statement: { operatingGroupId: groupId } } });
      await prisma.financialStatement.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.financialSource.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.financialCategory.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.operatingGroupMembership.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.operatingGroup.delete({ where: { id: groupId } });
    }
    await prisma.truck.delete({ where: { id: truck.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
    await prisma.company.delete({ where: { id: company.id } });
  }
});
