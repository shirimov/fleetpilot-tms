import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from 'playwright/test';
import { prisma } from '@/lib/prisma';

async function issueToken(userId: string, email: string) {
  const token = randomBytes(32).toString('base64url');
  await prisma.emailSignInToken.create({ data: { userId, email, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
  return token;
}

test('OWNER completes the manual Accounting evidence workflow and MEMBER is denied', async ({ page }) => {
  test.setTimeout(90_000);
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
    const operatingGroup = await prisma.operatingGroupCompany.findUniqueOrThrow({ where: { companyId: company.id }, select: { operatingGroupId: true } });
    const [feeOwnerA, feeOwnerB] = await Promise.all([
      prisma.financialParty.create({ data: { operatingGroupId: operatingGroup.operatingGroupId, companyId: company.id, type: 'OWNER_OPERATOR', name: `Owner A ${suffix}` } }),
      prisma.financialParty.create({ data: { operatingGroupId: operatingGroup.operatingGroupId, companyId: company.id, type: 'OWNER_OPERATOR', name: `Owner B ${suffix}` } }),
    ]);

    await page.getByRole('button', { name: 'Categories' }).click();
    const categoryForm = page.getByRole('heading', { name: 'Add category' }).locator('xpath=ancestor::form');
    await categoryForm.getByPlaceholder('Operational category').fill(`Company Expenses ${suffix}`);
    await categoryForm.getByRole('button', { name: 'Add category' }).click();
    await expect(page.locator('strong').filter({ hasText: `Company Expenses ${suffix}` })).toBeVisible();
    await categoryForm.getByPlaceholder('Operational category').fill(`Admin ${suffix}`);
    await categoryForm.getByLabel('Category parent').selectOption({ label: `Company Expenses ${suffix}` });
    await categoryForm.getByRole('button', { name: 'Add category' }).click();
    await expect(page.locator('strong').filter({ hasText: `Company Expenses ${suffix} / Admin ${suffix}` })).toBeVisible();
    await categoryForm.getByPlaceholder('Operational category').fill(`MVR ${suffix}`);
    await categoryForm.getByLabel('Category parent').selectOption({ label: `Company Expenses ${suffix} / Admin ${suffix}` });
    await categoryForm.getByRole('button', { name: 'Add category' }).click();
    await expect(page.locator('strong').filter({ hasText: `Company Expenses ${suffix} / Admin ${suffix} / MVR ${suffix}` })).toBeVisible();
    await categoryForm.getByPlaceholder('Operational category').fill(`Disposable category ${suffix}`);
    await categoryForm.getByLabel('Category parent').selectOption('');
    await categoryForm.getByRole('button', { name: 'Add category' }).click();
    const disposableCategory = page.locator('strong').filter({ hasText: `Disposable category ${suffix}` }).locator('xpath=ancestor::article');
    page.once('dialog', (dialog) => dialog.accept());
    await disposableCategory.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('strong').filter({ hasText: `Disposable category ${suffix}` })).toHaveCount(0);

    await page.getByRole('button', { name: 'Programs' }).click();
    await page.getByPlaceholder('ADMIN', { exact: true }).fill(`ADMIN-${suffix}`);
    await page.getByPlaceholder('Administration', { exact: true }).fill(`Administration ${suffix}`);
    await page.getByRole('button', { name: 'Add program' }).click();
    await expect(page.getByText(`${`ADMIN-${suffix}`.toUpperCase()} · Administration ${suffix}`, { exact: true })).toBeVisible();
    await page.getByPlaceholder('ADMIN', { exact: true }).fill(`DELETE-${suffix}`);
    await page.getByPlaceholder('Administration', { exact: true }).fill(`Disposable program ${suffix}`);
    await page.getByRole('button', { name: 'Add program' }).click();
    const disposableProgram = page.getByText(`${`DELETE-${suffix}`.toUpperCase()} · Disposable program ${suffix}`, { exact: true }).locator('xpath=ancestor::article');
    page.once('dialog', (dialog) => dialog.accept());
    await disposableProgram.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(`Disposable program ${suffix}`, { exact: false })).toHaveCount(0);

    await page.getByRole('button', { name: 'Admin Fees' }).click();
    const feeForm = page.getByRole('heading', { name: 'Add Admin Fee agreement' }).locator('xpath=ancestor::form');
    await feeForm.getByLabel('Owner').selectOption(feeOwnerA.id);
    await feeForm.getByPlaceholder('90.00').fill('90.00');
    await feeForm.getByLabel('Effective from').fill('2026-01-01');
    await feeForm.getByLabel('Effective to').fill('2026-06-30');
    await feeForm.getByRole('button', { name: 'Add agreement' }).click();
    await expect(page.getByText('$90.00 weekly · 2026-01-01 – 2026-06-30')).toBeVisible();
    await feeForm.getByLabel('Owner').selectOption(feeOwnerB.id);
    await feeForm.getByPlaceholder('90.00').fill('100.00');
    await feeForm.getByLabel('Effective from').fill('2026-01-01');
    await feeForm.getByLabel('Effective to').fill('');
    await feeForm.getByRole('button', { name: 'Add agreement' }).click();
    await expect(page.getByText('$100.00 weekly · 2026-01-01 – ongoing')).toBeVisible();
    await feeForm.getByLabel('Owner').selectOption(feeOwnerA.id);
    await feeForm.getByPlaceholder('90.00').fill('110.00');
    await feeForm.getByLabel('Effective from').fill('2099-01-01');
    await feeForm.getByRole('button', { name: 'Add agreement' }).click();
    const disposableFee = page.getByText('$110.00 weekly · 2099-01-01 – ongoing').locator('xpath=ancestor::article');
    page.once('dialog', (dialog) => dialog.accept());
    await disposableFee.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('$110.00 weekly · 2099-01-01 – ongoing')).toHaveCount(0);

    await page.getByRole('button', { name: 'Sources' }).click();
    await page.getByPlaceholder('Bank of America Operating').fill(`Operating Bank ${suffix}`);
    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(page.getByText(`Operating Bank ${suffix}`, { exact: true })).toBeVisible();
    await page.getByPlaceholder('Bank of America Operating').fill(`Reserve Bank ${suffix}`);
    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(page.getByText(`Reserve Bank ${suffix}`, { exact: true })).toBeVisible();
    await page.getByPlaceholder('Bank of America Operating').fill(`Disposable account ${suffix}`);
    await page.getByRole('button', { name: 'Add source' }).click();
    const disposableSource = page.getByText(`Disposable account ${suffix}`, { exact: true }).locator('xpath=ancestor::article');
    page.once('dialog', (dialog) => dialog.accept());
    await disposableSource.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(`Disposable account ${suffix}`, { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Statements' }).click();
    const uploadForm = page.getByRole('heading', { name: 'Upload statement' }).locator('xpath=ancestor::form');
    await uploadForm.getByRole('combobox').first().selectOption({ label: `Operating Bank ${suffix}` });
    await page.locator('input[name="periodStart"]').fill('2026-08-01');
    await page.locator('input[name="periodEnd"]').fill('2026-08-31');
    await page.locator('input[type="file"]').setInputFiles({ name: 'august.csv', mimeType: 'text/csv', buffer: Buffer.from('date,description,amount,reference\n2026-08-02,Amazon settlement,48320.00,AMZ-1\n') });
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('august.csv', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Transactions' }).click();
    const browserToday = await page.evaluate(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; });
    await expect(page.getByLabel('Transaction date')).toHaveValue(browserToday);
    await page.getByLabel('Transaction date').fill('2026-08-01');
    await page.getByPlaceholder('Description').fill(`Disposable transaction ${suffix}`);
    await page.getByPlaceholder('48320.00').fill('1.00');
    await page.getByRole('button', { name: 'Add transaction' }).click();
    const disposableTransaction = page.getByText(`Disposable transaction ${suffix}`, { exact: true }).locator('xpath=ancestor::article');
    page.once('dialog', (dialog) => dialog.accept());
    await disposableTransaction.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(`Disposable transaction ${suffix}`, { exact: true })).toHaveCount(0);
    await page.getByLabel('Transaction date').fill('2026-08-02');
    await page.getByPlaceholder('Description').fill('Amazon settlement');
    await page.getByPlaceholder('48320.00').fill('48320.00');
    await page.getByRole('button', { name: 'Add transaction' }).click();
    const transaction = page.getByText('Amazon settlement', { exact: true }).last().locator('xpath=ancestor::article');
    await expect(transaction.getByText(/2026-08-02/)).toBeVisible();
    await transaction.locator('form').first().locator('input[name="amount"]').fill('48320.00');
    await transaction.getByRole('combobox').first().selectOption({ index: 1 });
    await transaction.getByRole('button', { name: 'Match' }).click();
    await expect(transaction.getByText(/MATCHED/)).toBeVisible();
    await transaction.getByLabel('Allocation 1 amount').fill('48000.00');
    await transaction.getByLabel('Allocation 1 category').selectOption({ label: 'Freight Revenue' });
    await transaction.getByLabel('Allocation 1 truck').selectOption({ label: `Truck ${truck.unitNumber}` });
    await transaction.getByRole('button', { name: 'Add allocation line' }).click();
    await transaction.getByLabel('Allocation 2 amount').fill('320.00');
    await transaction.getByLabel('Allocation 2 category').selectOption({ label: 'Freight Revenue' });
    await transaction.getByLabel('Allocation 2 truck').selectOption({ label: `Truck ${truck.unitNumber}` });
    await expect(transaction.getByText(/Allocation total \$48,320.00 · Remaining \$0.00 · Fully allocated/)).toBeVisible();
    await transaction.getByRole('button', { name: 'Save allocations' }).click();
    await expect(transaction.getByText(/RECONCILED/)).toBeVisible();
    await expect(transaction.getByText(/Allocated \$48,320\.00 · Remaining \$0\.00/)).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await transaction.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText('financial history');
    await expect(transaction).toBeVisible();

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

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Transactions' }).click();
    await page.getByLabel('Transaction date').focus();
    await expect(page.getByLabel('Transaction date')).toBeFocused();

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
      await prisma.adminFeeAgreement.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.financialAllocation.deleteMany({ where: { transaction: { operatingGroupId: groupId } } });
      await prisma.financialTransactionEvidence.deleteMany({ where: { transaction: { operatingGroupId: groupId } } });
      await prisma.financialAuditEvent.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.financialTransaction.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.financialImportRecord.deleteMany({ where: { statement: { operatingGroupId: groupId } } });
      await prisma.financialStatement.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.financialSource.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.financialCategory.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.financialProgram.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.financialParty.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.operatingGroupMembership.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: groupId } });
      await prisma.operatingGroup.delete({ where: { id: groupId } });
    }
    await prisma.truck.delete({ where: { id: truck.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
    await prisma.company.delete({ where: { id: company.id } });
  }
});
