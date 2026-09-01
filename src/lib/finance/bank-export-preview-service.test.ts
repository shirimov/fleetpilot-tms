import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { BankExportPreviewService } from './bank-export-preview-service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let companyId: string;
let foreignCompanyId: string;
let connectionId: string;
let subAccountId: string;
let transactionId: string;
let userId: string;

before(async () => {
  const [company, foreignCompany, user] = await Promise.all([
    prisma.company.create({ data: { name: `Export preview ${suffix}` } }),
    prisma.company.create({ data: { name: `Foreign export preview ${suffix}` } }),
    prisma.user.create({ data: { email: `export-preview-${suffix}@example.test`, displayName: 'Export Preview Owner' } }),
  ]);
  companyId = company.id;
  foreignCompanyId = foreignCompany.id;
  userId = user.id;
  const connection = await prisma.bankAccount.create({
    data: {
      companyId,
      provider: 'PLAID',
      externalConnectionId: `export-${suffix}`,
      accounts: { create: { externalAccountId: `account-${suffix}`, name: 'Checking', type: 'depository' } },
    },
    include: { accounts: true },
  });
  connectionId = connection.id;
  subAccountId = connection.accounts[0].id;
  const transaction = await prisma.bankTransaction.create({
    data: {
      bankAccountId: connectionId,
      subAccountId,
      companyId,
      providerTransactionId: `provider-${suffix}`,
      date: new Date('2026-01-15T00:00:00.000Z'),
      postedDate: new Date('2026-01-15T00:00:00.000Z'),
      amount: 12.34,
      amountMinor: BigInt(1234),
      providerAmountText: '12.34',
      direction: 'OUTFLOW',
      name: 'Invoice 7',
      originalDescription: 'Invoice 7',
      externalIds: { create: { bankAccountId: connectionId, externalId: 'stable-existing' } },
    },
  });
  transactionId = transaction.id;
});

after(async () => {
  if (transactionId) await prisma.bankTransactionExternalId.deleteMany({ where: { bankTransactionId: transactionId } });
  if (transactionId) await prisma.bankTransaction.deleteMany({ where: { id: transactionId } });
  if (subAccountId) await prisma.bankSubAccount.deleteMany({ where: { id: subAccountId } });
  if (connectionId) await prisma.bankAccount.deleteMany({ where: { id: connectionId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'Export preview ' } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'Foreign export preview ' } } });
  await prisma.$disconnect();
});

test('preview classifies exact IDs, possible duplicates, new rows, and invalid rows without writes', async () => {
  const beforeCount = await prisma.bankTransaction.count({ where: { companyId } });
  const csv = [
    'Date,Amount,Description,Transaction ID',
    '2026-01-15,-12.34,Invoice 7,stable-existing',
    '2026-01-15,-12.34,Invoice 7,',
    '2026-02-01,100.00,New deposit,new-stable-id',
    'bad,,Broken,',
  ].join('\n');
  const result = await new BankExportPreviewService().preview({
    userId,
    activeCompanyId: companyId,
    operatingGroupId: 'test-group',
    role: 'OWNER',
    companyIds: [companyId],
  }, {
    companyId,
    bankAccountId: connectionId,
    subAccountId,
    filename: 'history.csv',
    bytes: new TextEncoder().encode(csv),
  });
  assert.deepEqual(result.summary, { total: 4, new: 1, alreadyExists: 1, possibleDuplicate: 1, invalid: 1 });
  assert.equal(result.mode, 'PREVIEW_ONLY');
  assert.equal(await prisma.bankTransaction.count({ where: { companyId } }), beforeCount);
});

test('preview rejects a company outside the authorized operating group', async () => {
  await assert.rejects(() => new BankExportPreviewService().preview({
    userId,
    activeCompanyId: companyId,
    operatingGroupId: 'test-group',
    role: 'OWNER',
    companyIds: [companyId],
  }, {
    companyId: foreignCompanyId,
    bankAccountId: connectionId,
    subAccountId,
    filename: 'history.csv',
    bytes: new TextEncoder().encode('Date,Amount,Description\n2026-01-01,1.00,Deposit'),
  }), /do not have access/);
});
