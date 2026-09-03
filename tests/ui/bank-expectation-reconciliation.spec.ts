import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from 'playwright/test';
import { prisma } from '@/lib/prisma';

async function issueToken(userId: string, email: string) {
  const token = randomBytes(32).toString('base64url');
  await prisma.emailSignInToken.create({ data: { userId, email, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
  return token;
}

test('OWNER reconciles expected Pilot settlement to a bank transaction without another expense', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const company = await prisma.company.create({ data: { name: `Bank match UI ${suffix}` } });
  const owner = await prisma.user.create({ data: { email: `bank-match-ui-${suffix}@example.test`, displayName: 'Bank Match Owner', activeCompanyId: company.id, memberships: { create: { companyId: company.id, role: 'OWNER' } } } });
  const group = await prisma.operatingGroup.create({ data: { name: `Bank Match Group ${suffix}`, companies: { create: { companyId: company.id } }, memberships: { create: { userId: owner.id, role: 'OWNER' } } } });
  const expectation = await prisma.financialExpectation.create({ data: { operatingGroupId: group.id, companyId: company.id, expectedAmountMinor: BigInt(5953073), currency: 'USD', direction: 'OUTFLOW', description: 'Pilot invoice 788363801', expectedDateStart: new Date('2026-07-13'), expectedDateEnd: new Date('2026-07-15'), reference: '788363801', createdByUserId: owner.id } });
  const bankAccount = await prisma.bankAccount.create({ data: { companyId: company.id, externalConnectionId: `bank-match-ui-${suffix}` } });
  const bank = await prisma.bankTransaction.create({ data: { bankAccountId: bankAccount.id, companyId: company.id, providerTransactionId: `pilot-ui-${suffix}`, date: new Date('2026-07-15'), postedDate: new Date('2026-07-15'), amount: 59530.73, amountMinor: BigInt(5953073), currency: 'USD', direction: 'OUTFLOW', name: 'PILOT RECEIVABLE', merchantName: 'Pilot Flying J', pending: false, lifecycle: 'POSTED' } });
  await prisma.bankTransactionClassification.create({ data: { bankTransactionId: bank.id } });
  await prisma.financialTransaction.create({ data: { operatingGroupId: group.id, companyId: company.id, transactionDate: new Date('2026-07-15'), amountMinor: BigInt(5953073), currency: 'USD', direction: 'OUTFLOW', description: 'Already posted Pilot economics', status: 'POSTED', reconciliationStatus: 'RECONCILED', dataStatus: 'VERIFIED', role: 'ECONOMIC', createdByUserId: owner.id } });
  try {
    await page.goto(`/login/email/verify#token=${await issueToken(owner.id, owner.email)}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
    await page.goto('/accounting');
    await page.getByRole('button', { name: 'Audit Center' }).click();
    const expectedCard = page.getByText('Pilot invoice 788363801', { exact: true }).locator('xpath=ancestor::article');
    await expect(expectedCard.getByText('Remaining $59,530.73')).toBeVisible();
    await expectedCard.getByRole('button', { name: 'Find bank candidates' }).click();
    await expect(expectedCard.getByText('Pilot Flying J')).toBeVisible();
    await expect(expectedCard.getByText('Difference $0.00')).toBeVisible();
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('does not create another expense');
      await dialog.accept();
    });
    await expectedCard.getByRole('button', { name: 'Match bank transaction' }).click();
    await expect(expectedCard.getByText('Settled', { exact: true })).toBeVisible();
    await expect(expectedCard.getByText('Remaining $0.00')).toBeVisible();
    await expect(expectedCard.getByText(/Reconciled → Pilot Flying J/)).toBeVisible();
    expect(await prisma.financialTransaction.count({ where: { operatingGroupId: group.id } })).toBe(1);
    expect((await prisma.bankTransactionClassification.findUniqueOrThrow({ where: { bankTransactionId: bank.id } })).reconciliationStatus).toBe('MATCHED');
  } finally {
    await prisma.financialExpectationBankMatch.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.financialAuditEvent.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.financialTransaction.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.financialExpectation.delete({ where: { id: expectation.id } });
    await prisma.bankTransactionClassification.deleteMany({ where: { bankTransactionId: bank.id } });
    await prisma.bankTransaction.delete({ where: { id: bank.id } });
    await prisma.bankAccount.delete({ where: { id: bankAccount.id } });
    await prisma.operatingGroupMembership.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.operatingGroup.delete({ where: { id: group.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
});
