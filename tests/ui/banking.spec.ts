import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from 'playwright/test';
import { prisma } from '@/lib/prisma';

async function issueToken(userId: string, email: string) {
  const token = randomBytes(32).toString('base64url');
  await prisma.emailSignInToken.create({
    data: {
      userId,
      email,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
  return token;
}

test('banking workspace shows real source data separately from reviewed FleetPilot classification', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const company = await prisma.company.create({ data: { name: `Banking UI ${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      email: `banking-ui-${suffix}@example.test`,
      displayName: 'Banking Owner',
      activeCompanyId: company.id,
      memberships: { create: { companyId: company.id, role: 'OWNER' } },
    },
  });
  const group = await prisma.operatingGroup.create({
    data: {
      name: `Banking UI group ${suffix}`,
      companies: { create: { companyId: company.id } },
      memberships: { create: { userId: owner.id, role: 'OWNER' } },
    },
  });
  const category = await prisma.financialCategory.create({
    data: { operatingGroupId: group.id, name: `Fuel ${suffix}`, type: 'DIRECT_EXPENSE' },
  });
  const connection = await prisma.bankAccount.create({
    data: {
      companyId: company.id,
      provider: 'FILE_IMPORT',
      externalConnectionId: `ui-${suffix}`,
      institutionName: 'Fixture Credit Union',
      accounts: {
        create: {
          externalAccountId: `checking-${suffix}`,
          name: 'Operating checking',
          type: 'depository',
          subtype: 'checking',
          mask: '0042',
          currentBalanceMinor: BigInt(250000),
        },
      },
    },
    include: { accounts: true },
  });
  const transaction = await prisma.bankTransaction.create({
    data: {
      bankAccountId: connection.id,
      subAccountId: connection.accounts[0].id,
      companyId: company.id,
      providerTransactionId: `ui-transaction-${suffix}`,
      date: new Date('2026-08-30T00:00:00.000Z'),
      postedDate: new Date('2026-08-30T00:00:00.000Z'),
      amount: 125.4,
      amountMinor: BigInt(12540),
      providerAmountText: '125.40',
      currency: 'USD',
      direction: 'OUTFLOW',
      name: 'ACH PURCHASE TEST',
      originalDescription: 'ACH PURCHASE TEST',
      merchantName: 'Roadside Fuel',
      providerCategory: { primary: 'TRANSPORTATION' },
      classification: { create: {} },
      externalIds: { create: { bankAccountId: connection.id, externalId: `ui-transaction-${suffix}` } },
    },
  });
  const deposit = await prisma.bankTransaction.create({
    data: {
      bankAccountId: connection.id,
      subAccountId: connection.accounts[0].id,
      companyId: company.id,
      providerTransactionId: `ui-deposit-${suffix}`,
      date: new Date('2026-08-31T00:00:00.000Z'),
      postedDate: new Date('2026-08-31T00:00:00.000Z'),
      amount: 5000,
      amountMinor: BigInt(500000),
      providerAmountText: '-5000',
      currency: 'USD',
      direction: 'INFLOW',
      name: 'INCOMING TRANSFER',
      originalDescription: 'INCOMING TRANSFER',
      merchantName: 'Customer deposit',
      classification: { create: {} },
      externalIds: { create: { bankAccountId: connection.id, externalId: `ui-deposit-${suffix}` } },
    },
  });

  try {
    await page.goto(`/login/email/verify#token=${await issueToken(owner.id, owner.email)}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
    await page.goto('/accounting/banking?view=accounts');
    await expect(page.getByRole('heading', { name: 'Bank transaction ledger' })).toBeVisible();
    await expect(page.getByText('Bank provider not connected')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fixture Credit Union' })).toBeVisible();
    await expect(page.getByText('$2,500.00')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Historical bank export preview' })).toBeVisible();
    await expect(page.getByText('Preview only: this screen cannot import or change ledger records.')).toBeVisible();
    await page.getByLabel('Historical export destination account').selectOption(connection.accounts[0].id);
    await page.getByLabel('Historical bank export file').setInputFiles({
      name: 'history.qfx',
      mimeType: 'application/x-ofx',
      buffer: Buffer.from('<OFX><STMTTRN><DTPOSTED>20260115<TRNAMT>-42.00<FITID>ui-export-new<NAME>Preview only</STMTTRN></BANKTRANLIST>'),
    });
    await page.getByRole('button', { name: 'Preview file' }).click();
    await expect(page.getByText('1 rows')).toBeVisible();
    await expect(page.getByText('NEW', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /import/i })).toHaveCount(0);

    await page.getByRole('navigation', { name: 'Bank ledger views' }).getByRole('link', { name: 'Transactions' }).click();
    await expect(page.getByRole('heading', { name: 'Roadside Fuel' })).toBeVisible();
    await expect(page.getByText('-$125.40 · MONEY OUT')).toBeVisible();
    await expect(page.getByText('+$5,000.00 · MONEY IN')).toBeVisible();
    const period = page.getByLabel('Transaction period');
    await expect(period.getByRole('option', { name: 'Custom' })).toHaveCount(1);
    await period.selectOption('custom');
    await page.getByLabel('Custom transaction start date').fill('2026-08-30');
    await page.getByLabel('Custom transaction end date').fill('2026-08-30');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('heading', { name: 'Roadside Fuel' })).toBeVisible();
    await page.getByLabel('Custom transaction start date').fill('2026-08-31');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Start date cannot be after end date.', { exact: true })).toBeVisible();
    await page.getByLabel('Custom transaction end date').fill('2026-09-01');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('heading', { name: 'Roadside Fuel' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reset period' }).click();
    await expect(period).toHaveValue('all');
    await expect(page.getByRole('heading', { name: 'Roadside Fuel' })).toBeVisible();
    const card = page.getByRole('heading', { name: 'Roadside Fuel' }).locator('xpath=ancestor::article');
    await card.getByText('Review transaction').click();
    await expect(card.getByRole('heading', { name: 'Bank data' })).toBeVisible();
    await expect(card.getByRole('heading', { name: 'FleetPilot classification' })).toBeVisible();
    await expect(card.getByText('ACH PURCHASE TEST')).toBeVisible();
    await card.getByLabel('FleetPilot category').selectOption(category.id);
    await card.getByLabel('Transaction review status').selectOption('REVIEWED');
    await card.getByRole('button', { name: 'Save classification' }).click();
    await expect.poll(async () => (await prisma.bankTransactionClassification.findUniqueOrThrow({ where: { bankTransactionId: transaction.id } })).reviewStatus).toBe('REVIEWED');
    const stored = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(stored.originalDescription).toBe('ACH PURCHASE TEST');
    expect(stored.amountMinor).toBe(BigInt(12540));
  } finally {
    await prisma.financialAuditEvent.deleteMany({ where: { operatingGroupId: group.id } });
    const transactionIds = [transaction.id, deposit.id];
    await prisma.bankTransactionAllocation.deleteMany({ where: { bankTransactionId: { in: transactionIds } } });
    await prisma.bankTransactionClassification.deleteMany({ where: { bankTransactionId: { in: transactionIds } } });
    await prisma.bankTransactionExternalId.deleteMany({ where: { bankTransactionId: { in: transactionIds } } });
    await prisma.bankTransaction.deleteMany({ where: { id: { in: transactionIds } } });
    await prisma.bankSubAccount.deleteMany({ where: { bankAccountId: connection.id } });
    await prisma.bankAccount.deleteMany({ where: { id: connection.id } });
    await prisma.financialCategory.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.operatingGroupMembership.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: group.id } });
    await prisma.operatingGroup.delete({ where: { id: group.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
});
