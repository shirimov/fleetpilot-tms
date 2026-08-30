import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import type { FinancialAuthorization } from './financial-control-authorization';
import { BankLedgerService } from './bank-ledger-service';
import { BankLedgerNotFoundError, BankLedgerValidationError, BankProviderUnavailableError } from './bank-ledger-errors';
import { BankSyncService } from './bank-sync-service';
import { encryptBankAccessToken } from './bank-token-crypto';
import type { BankProviderAdapter, BankProviderTransaction } from './bank-ledger-types';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ledger = new BankLedgerService(prisma);
let companyId = '';
let foreignCompanyId = '';
let groupId = '';
let userId = '';
let categoryId = '';
let bankAccountId = '';
let externalAccountId = '';
let truckId = '';
let trailerId = '';
let driverId = '';
let partyId = '';

function context(): FinancialAuthorization {
  return { userId, role: 'OWNER', activeCompanyId: companyId, operatingGroupId: groupId, companyIds: [companyId] };
}

function source(overrides: Partial<BankProviderTransaction> = {}): BankProviderTransaction {
  return {
    externalId: `provider-${suffix}`,
    externalAccountId,
    postedDate: new Date('2026-08-30T00:00:00.000Z'),
    amountMinor: BigInt(12540),
    providerAmountText: '125.40',
    currency: 'USD',
    direction: 'OUTFLOW',
    originalDescription: 'ACH PURCHASE TEST',
    merchantName: 'Test Merchant',
    providerCategory: { primary: 'GENERAL_MERCHANDISE' },
    pending: false,
    sourceMetadata: { providerCode: 'safe-fixture' },
    ...overrides,
  };
}

before(async () => {
  const [company, foreign, user] = await Promise.all([
    prisma.company.create({ data: { name: `Bank ledger ${suffix}` } }),
    prisma.company.create({ data: { name: `Bank ledger foreign ${suffix}` } }),
    prisma.user.create({ data: { email: `bank-ledger-${suffix}@test.dev`, displayName: 'Bank ledger owner' } }),
  ]);
  companyId = company.id;
  foreignCompanyId = foreign.id;
  userId = user.id;
  await prisma.companyMembership.create({ data: { companyId, userId, role: 'OWNER' } });
  const group = await prisma.operatingGroup.create({
    data: {
      name: `Bank ledger group ${suffix}`,
      companies: { create: { companyId } },
      memberships: { create: { userId, role: 'OWNER' } },
    },
  });
  groupId = group.id;
  const [category, truck, trailer, driver, party] = await Promise.all([
    prisma.financialCategory.create({ data: { operatingGroupId: groupId, name: `Fuel ${suffix}`, type: 'DIRECT_EXPENSE' } }),
    prisma.truck.create({ data: { companyId, unitNumber: `BL-${suffix}` } }),
    prisma.trailer.create({ data: { companyId, unitNumber: `BLT-${suffix}` } }),
    prisma.driver.create({ data: { companyId, firstName: 'Bank', lastName: 'Driver', payRate: 0 } }),
    prisma.financialParty.create({ data: { operatingGroupId: groupId, companyId, type: 'VENDOR', name: `Vendor ${suffix}` } }),
  ]);
  categoryId = category.id;
  truckId = truck.id;
  trailerId = trailer.id;
  driverId = driver.id;
  partyId = party.id;
  externalAccountId = `external-account-${suffix}`;
  const connection = await prisma.bankAccount.create({
    data: {
      companyId,
      provider: 'FILE_IMPORT',
      externalConnectionId: `connection-${suffix}`,
      institutionName: 'Fixture Bank',
      accounts: { create: { externalAccountId, name: 'Operating', type: 'depository', currentBalanceMinor: BigInt(100000) } },
    },
  });
  bankAccountId = connection.id;
});

after(async () => {
  await prisma.financialAuditEvent.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.bankTransactionAllocation.deleteMany({ where: { bankTransaction: { bankAccountId } } });
  await prisma.bankTransactionClassification.deleteMany({ where: { bankTransaction: { bankAccountId } } });
  await prisma.bankTransactionExternalId.deleteMany({ where: { bankAccountId } });
  await prisma.bankTransaction.deleteMany({ where: { bankAccountId } });
  await prisma.bankSubAccount.deleteMany({ where: { bankAccountId } });
  await prisma.bankAccount.deleteMany({ where: { id: bankAccountId } });
  await prisma.financialParty.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.financialCategory.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.driver.deleteMany({ where: { id: driverId } });
  await prisma.trailer.deleteMany({ where: { id: trailerId } });
  await prisma.truck.deleteMany({ where: { id: truckId } });
  await prisma.operatingGroupMembership.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroup.deleteMany({ where: { id: groupId } });
  await prisma.companyMembership.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
  await prisma.$disconnect();
});

test('ingestion stores exact source data and is idempotent', async () => {
  const first = await ledger.ingestTransactions(context(), bankAccountId, [source()]);
  const repeated = await ledger.ingestTransactions(context(), bankAccountId, [source()]);
  assert.deepEqual(first, { created: 1, updated: 0, total: 1 });
  assert.deepEqual(repeated, { created: 0, updated: 1, total: 1 });
  const stored = await prisma.bankTransaction.findFirstOrThrow({ where: { bankAccountId, providerTransactionId: source().externalId } });
  assert.equal(stored.amountMinor, BigInt(12540));
  assert.equal(stored.direction, 'OUTFLOW');
  assert.equal(stored.originalDescription, 'ACH PURCHASE TEST');
  assert.equal(await prisma.bankTransaction.count({ where: { bankAccountId, providerTransactionId: source().externalId } }), 1);
  assert.equal(await prisma.financialAuditEvent.count({ where: { bankTransactionId: stored.id, action: 'BANK_TRANSACTION_INGESTED' } }), 1);
});

test('external bank account identity is unique within its connection', async () => {
  await assert.rejects(
    prisma.bankSubAccount.create({
      data: { bankAccountId, externalAccountId, name: 'Duplicate account', type: 'depository' },
    }),
  );
  assert.equal(await prisma.bankSubAccount.count({ where: { bankAccountId, externalAccountId } }), 1);
});

test('pending to posted transition preserves one canonical transaction and both external identities', async () => {
  const pendingId = `pending-${suffix}`;
  await ledger.ingestTransactions(context(), bankAccountId, [source({ externalId: pendingId, pending: true, postedDate: null, authorizedDate: new Date('2026-08-29') })]);
  const pending = await prisma.bankTransaction.findFirstOrThrow({ where: { bankAccountId, providerTransactionId: pendingId } });
  const postedId = `posted-${suffix}`;
  await ledger.ingestTransactions(context(), bankAccountId, [source({ externalId: postedId, pendingExternalId: pendingId, pending: false })]);
  const posted = await prisma.bankTransaction.findFirstOrThrow({ where: { id: pending.id }, include: { externalIds: true } });
  assert.equal(posted.lifecycle, 'POSTED');
  assert.equal(posted.providerTransactionId, postedId);
  assert.deepEqual(posted.externalIds.map(({ externalId }) => externalId).sort(), [pendingId, postedId].sort());
  assert.equal(await prisma.financialAuditEvent.count({ where: { bankTransactionId: pending.id, action: 'BANK_TRANSACTION_PENDING_POSTED' } }), 1);
  assert.deepEqual(await ledger.markRemoved(context(), bankAccountId, [pendingId]), { removed: 0 });
  assert.equal((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: pending.id } })).lifecycle, 'POSTED');
});

test('unknown merchant and missing optional fields do not block a valid transaction', async () => {
  const externalId = `minimal-${suffix}`;
  await ledger.ingestTransactions(context(), bankAccountId, [source({ externalId, merchantName: null, providerCategory: undefined, authorizedDate: null, sourceMetadata: undefined })]);
  const stored = await prisma.bankTransaction.findFirstOrThrow({ where: { bankAccountId, providerTransactionId: externalId } });
  assert.equal(stored.merchantName, null);
  assert.equal(stored.providerCategory, null);
});

test('a current provider removal marks history removed without deleting the source row', async () => {
  const externalId = `removed-${suffix}`;
  await ledger.ingestTransactions(context(), bankAccountId, [source({ externalId })]);
  const before = await prisma.bankTransaction.findFirstOrThrow({ where: { bankAccountId, providerTransactionId: externalId } });
  assert.deepEqual(await ledger.markRemoved(context(), bankAccountId, [externalId]), { removed: 1 });
  const after = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: before.id } });
  assert.equal(after.lifecycle, 'REMOVED');
  assert.ok(after.removedAt);
  assert.equal(await prisma.bankTransaction.count({ where: { id: before.id } }), 1);
});

test('company-level classification is separate from immutable bank source data', async () => {
  const transaction = await prisma.bankTransaction.findFirstOrThrow({ where: { bankAccountId, providerTransactionId: source().externalId } });
  const sourceBefore = { amountMinor: transaction.amountMinor, originalDescription: transaction.originalDescription, providerTransactionId: transaction.providerTransactionId };
  await ledger.classifyTransaction(context(), transaction.id, { categoryId, scope: 'COMPANY_LEVEL', reviewStatus: 'REVIEWED', allocations: [], notes: 'Reviewed fixture' });
  const after = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: transaction.id }, include: { classification: true } });
  assert.deepEqual({ amountMinor: after.amountMinor, originalDescription: after.originalDescription, providerTransactionId: after.providerTransactionId }, sourceBefore);
  assert.equal(after.classification?.categoryId, categoryId);
  assert.equal(after.classification?.reviewStatus, 'REVIEWED');
  assert.equal(await prisma.financialAuditEvent.count({ where: { bankTransactionId: transaction.id, action: 'BANK_TRANSACTION_CLASSIFICATION_CHANGED' } }), 1);
});

test('entity allocations support truck, trailer, driver, and contractor dimensions with exact totals', async () => {
  const externalId = `allocation-${suffix}`;
  await ledger.ingestTransactions(context(), bankAccountId, [source({ externalId, amountMinor: BigInt(10000), providerAmountText: '100.00' })]);
  const transaction = await prisma.bankTransaction.findFirstOrThrow({ where: { bankAccountId, providerTransactionId: externalId } });
  await ledger.classifyTransaction(context(), transaction.id, {
    categoryId,
    scope: 'ENTITY_ALLOCATED',
    reviewStatus: 'REVIEWED',
    allocations: [
      { amountMinor: BigInt(2500), categoryId, truckId },
      { amountMinor: BigInt(2500), categoryId, trailerId },
      { amountMinor: BigInt(2500), categoryId, driverId },
      { amountMinor: BigInt(2500), categoryId, partyId },
    ],
  });
  const allocations = await prisma.bankTransactionAllocation.findMany({ where: { bankTransactionId: transaction.id } });
  assert.equal(allocations.reduce((sum, allocation) => sum + allocation.amountMinor, BigInt(0)), BigInt(10000));
  assert.ok(allocations.some((allocation) => allocation.truckId === truckId));
  assert.ok(allocations.some((allocation) => allocation.trailerId === trailerId));
  assert.ok(allocations.some((allocation) => allocation.driverId === driverId));
  assert.ok(allocations.some((allocation) => allocation.partyId === partyId));
});

test('over-allocation and cross-company entities fail closed without replacing prior classification', async () => {
  const transaction = await prisma.bankTransaction.findFirstOrThrow({ where: { bankAccountId, providerTransactionId: source().externalId } });
  await assert.rejects(
    ledger.classifyTransaction(context(), transaction.id, { categoryId, scope: 'ENTITY_ALLOCATED', reviewStatus: 'REVIEWED', allocations: [{ amountMinor: BigInt(12541), categoryId, truckId }] }),
    BankLedgerValidationError,
  );
  const foreignTruck = await prisma.truck.create({ data: { companyId: foreignCompanyId, unitNumber: `FOREIGN-${suffix}` } });
  await assert.rejects(
    ledger.classifyTransaction(context(), transaction.id, { categoryId, scope: 'ENTITY_ALLOCATED', reviewStatus: 'REVIEWED', allocations: [{ amountMinor: BigInt(12540), categoryId, truckId: foreignTruck.id }] }),
    BankLedgerValidationError,
  );
  assert.equal((await prisma.bankTransactionClassification.findUniqueOrThrow({ where: { bankTransactionId: transaction.id } })).scope, 'COMPANY_LEVEL');
  await prisma.truck.delete({ where: { id: foreignTruck.id } });
});

test('connection and company scope cannot be crossed', async () => {
  await assert.rejects(
    ledger.listTransactions(context(), { companyId: foreignCompanyId }),
    BankLedgerNotFoundError,
  );
  await assert.rejects(
    ledger.ingestTransactions({ ...context(), activeCompanyId: foreignCompanyId, companyIds: [foreignCompanyId] }, bankAccountId, [source({ externalId: `cross-${suffix}` })]),
    BankLedgerNotFoundError,
  );
});

test('provider sync is bounded, makes zero retries, and stores only sanitized failures', async () => {
  const priorKey = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  process.env.BANK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  const secretToken = `provider-secret-${suffix}`;
  await prisma.bankAccount.update({ where: { id: bankAccountId }, data: { provider: 'OTHER', accessTokenCiphertext: encryptBankAccessToken(secretToken), status: 'ACTIVE' } });
  let calls = 0;
  const failing: BankProviderAdapter = {
    provider: 'OTHER',
    async syncTransactions() {
      calls += 1;
      throw new Error(`upstream failed with ${secretToken}`);
    },
  };
  const sync = new BankSyncService(prisma, ledger, new Map([['OTHER', failing]]));
  await assert.rejects(sync.syncNow(context(), bankAccountId), BankProviderUnavailableError);
  assert.equal(calls, 1);
  const failed = await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } });
  assert.equal(failed.lastSyncErrorMessage, 'Bank transaction synchronization failed.');
  assert.equal(JSON.stringify(failed).includes(secretToken), false);
  process.env.BANK_TOKEN_ENCRYPTION_KEY = priorKey;
});

test('provider cursor pagination stops at the bounded page limit', async () => {
  const priorKey = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  process.env.BANK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: { provider: 'OTHER', accessTokenCiphertext: encryptBankAccessToken(`bounded-${suffix}`), status: 'ACTIVE' },
  });
  let calls = 0;
  const endless: BankProviderAdapter = {
    provider: 'OTHER',
    async syncTransactions() {
      calls += 1;
      return { added: [], modified: [], removedExternalIds: [], nextCursor: `cursor-${calls}`, hasMore: true };
    },
  };
  const sync = new BankSyncService(prisma, ledger, new Map([['OTHER', endless]]));
  await assert.rejects(sync.syncNow(context(), bankAccountId), BankProviderUnavailableError);
  assert.equal(calls, 20);
  assert.equal((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } })).lastSyncErrorMessage, 'Bank transaction synchronization failed.');
  process.env.BANK_TOKEN_ENCRYPTION_KEY = priorKey;
});
