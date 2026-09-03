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
import { PlaidConnectionService } from './plaid-connection-service';
import { BankCategorizationService } from './bank-categorization';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ledger = new BankLedgerService(prisma);
const categorization = new BankCategorizationService(prisma);
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
  await prisma.bankProviderWebhookEvent.deleteMany({ where: { bankAccountId } });
  await prisma.financialAuditEvent.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.bankTransactionAllocation.deleteMany({ where: { bankTransaction: { bankAccountId } } });
  await prisma.bankTransactionClassification.deleteMany({ where: { bankTransaction: { bankAccountId } } });
  await prisma.bankTransactionExternalId.deleteMany({ where: { bankAccountId } });
  await prisma.bankTransaction.deleteMany({ where: { bankAccountId } });
  await prisma.bankCategorizationRule.deleteMany({ where: { operatingGroupId: groupId } });
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
  assert.equal((await prisma.bankTransactionClassification.findUniqueOrThrow({ where: { bankTransactionId: stored.id } })).reviewStatus, 'UNREVIEWED');
  assert.deepEqual(stored.providerCategory, { primary: 'GENERAL_MERCHANDISE' });
  assert.equal(await prisma.bankTransaction.count({ where: { bankAccountId, providerTransactionId: source().externalId } }), 1);
  assert.equal(await prisma.financialAuditEvent.count({ where: { bankTransactionId: stored.id, action: 'BANK_TRANSACTION_INGESTED' } }), 1);
});

test('zero-amount provider transactions remain auditable and idempotent', async () => {
  const externalId = `zero-amount-${suffix}`;
  const zeroAmountSource = source({
    externalId,
    amountMinor: BigInt(0),
    providerAmountText: '0.00',
    direction: null,
  });
  const first = await ledger.ingestTransactions(context(), bankAccountId, [zeroAmountSource]);
  const repeated = await ledger.ingestTransactions(context(), bankAccountId, [zeroAmountSource]);
  assert.deepEqual(first, { created: 1, updated: 0, total: 1 });
  assert.deepEqual(repeated, { created: 0, updated: 1, total: 1 });
  const stored = await prisma.bankTransaction.findFirstOrThrow({
    where: { bankAccountId, providerTransactionId: externalId },
  });
  assert.equal(stored.amountMinor, BigInt(0));
  assert.equal(stored.providerAmountText, '0.00');
  assert.equal(stored.direction, null);
  assert.equal(await prisma.bankTransaction.count({ where: { bankAccountId, providerTransactionId: externalId } }), 1);
  assert.equal(await prisma.financialAuditEvent.count({
    where: { bankTransactionId: stored.id, action: 'BANK_TRANSACTION_INGESTED' },
  }), 1);
});

test('zero-amount provider transactions reject an arbitrary money direction', async () => {
  await assert.rejects(
    ledger.ingestTransactions(context(), bankAccountId, [source({
      externalId: `invalid-zero-direction-${suffix}`,
      amountMinor: BigInt(0),
      providerAmountText: '0.00',
      direction: 'OUTFLOW',
    })]),
    (error) => error instanceof BankLedgerValidationError && error.message === 'Zero-amount bank transactions must have neutral direction.',
  );
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

test('transaction date filtering includes both custom range boundaries', async () => {
  const startId = `custom-start-${suffix}`;
  const endId = `custom-end-${suffix}`;
  const outsideId = `custom-outside-${suffix}`;
  await ledger.ingestTransactions(context(), bankAccountId, [
    source({ externalId: startId, postedDate: new Date('2026-01-01T00:00:00.000Z') }),
    source({ externalId: endId, postedDate: new Date('2026-08-31T00:00:00.000Z') }),
    source({ externalId: outsideId, postedDate: new Date('2026-09-01T00:00:00.000Z') }),
  ]);
  const rows = await ledger.listTransactions(context(), {
    companyId,
    from: new Date('2026-01-01T00:00:00.000Z'),
    to: new Date('2026-08-31T00:00:00.000Z'),
  });
  const matchingIds = rows.map(({ providerTransactionId }) => providerTransactionId);
  assert.ok(matchingIds.includes(startId));
  assert.ok(matchingIds.includes(endId));
  assert.equal(matchingIds.includes(outsideId), false);
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

test('bulk review is explicit, audited, and does not create a rule', async () => {
  const ids = [`bulk-a-${suffix}`, `bulk-b-${suffix}`];
  await ledger.ingestTransactions(context(), bankAccountId, ids.map((externalId) => source({ externalId })));
  const transactions = await prisma.bankTransaction.findMany({ where: { bankAccountId, providerTransactionId: { in: ids } } });
  assert.deepEqual(await ledger.bulkReviewTransactions(context(), { transactionIds: transactions.map(({ id }) => id), categoryId }), { reviewed: 2 });
  assert.equal(await prisma.bankTransactionClassification.count({ where: { bankTransactionId: { in: transactions.map(({ id }) => id) }, reviewStatus: 'REVIEWED', categoryId } }), 2);
  assert.equal(await prisma.financialAuditEvent.count({ where: { bankTransactionId: { in: transactions.map(({ id }) => id) }, action: 'BANK_TRANSACTION_BULK_REVIEWED' } }), 2);
  assert.equal(await prisma.bankCategorizationRule.count({ where: { operatingGroupId: groupId } }), 0);
});

test('bulk review rejects cross-company and allocated selections atomically', async () => {
  const own = await prisma.bankTransaction.findFirstOrThrow({ where: { bankAccountId, providerTransactionId: source().externalId } });
  await assert.rejects(ledger.bulkReviewTransactions(context(), { transactionIds: [own.id, 'missing-or-foreign'], categoryId }), BankLedgerNotFoundError);
});

test('merchant-pattern review is exact, reviewable-only, and updates progress', async () => {
  const ids = [`pattern-a-${suffix}`, `pattern-b-${suffix}`];
  await ledger.ingestTransactions(context(), bankAccountId, ids.map((externalId) => source({ externalId, merchantName: 'Exact Pattern 001' })));
  assert.deepEqual(await ledger.bulkReviewPattern(context(), { companyId, merchantNormalized: 'EXACT PATTERN 001', direction: 'OUTFLOW', categoryId }), { reviewed: 2 });
  const progress = await categorization.progress(context(), companyId);
  assert.equal(Number(progress.reviewed) >= 2, true);
  assert.equal(Number(progress.categorized) >= 2, true);
  await assert.rejects(ledger.bulkReviewPattern(context(), { companyId, merchantNormalized: 'EXACT PATTERN 001', direction: 'OUTFLOW', categoryId }), /No reviewable transactions/);
});

test('categorization rules are explicit, audited, and company scoped', async () => {
  const created = await categorization.createRule(context(), companyId, { name: 'Pilot fuel', merchantNormalized: 'Pilot #123', direction: 'OUTFLOW', categoryId, scope: 'COMPANY_LEVEL' });
  assert.equal(created.merchantNormalized, 'PILOT FLYING J');
  assert.equal((await categorization.listRules(context(), companyId)).length, 1);
  assert.equal(await prisma.financialAuditEvent.count({ where: { operatingGroupId: groupId, action: 'BANK_CATEGORIZATION_RULE_CREATED' } }), 1);
  assert.equal((await categorization.setRuleEnabled(context(), created.id, false)).isEnabled, false);
  assert.equal(await prisma.financialAuditEvent.count({ where: { operatingGroupId: groupId, action: 'BANK_CATEGORIZATION_RULE_DISABLED' } }), 1);
  await assert.rejects(categorization.createRule(context(), foreignCompanyId, { name: 'Foreign', direction: 'OUTFLOW', categoryId, scope: 'COMPANY_LEVEL' }), BankLedgerNotFoundError);
  await categorization.deleteRule(context(), created.id);
  assert.equal(await prisma.bankCategorizationRule.count({ where: { id: created.id } }), 0);
  assert.equal(await prisma.financialAuditEvent.count({ where: { operatingGroupId: groupId, action: 'BANK_CATEGORIZATION_RULE_DELETED' } }), 1);
});

test('rule validation rejects unsafe ambiguity and invalid amount ranges', async () => {
  await assert.rejects(categorization.createRule(context(), companyId, { name: 'No conditions', categoryId, scope: 'COMPANY_LEVEL' }), BankLedgerValidationError);
  await assert.rejects(categorization.createRule(context(), companyId, { name: 'Bad range', direction: 'OUTFLOW', minimumAmountMinor: BigInt(200), maximumAmountMinor: BigInt(100), categoryId, scope: 'COMPANY_LEVEL' }), BankLedgerValidationError);
});

test('an approved rule creates only a reviewable suggestion on later ingestion', async () => {
  const rule = await categorization.createRule(context(), companyId, { name: 'Future Pilot suggestion', merchantNormalized: 'Pilot Travel Center 123', direction: 'OUTFLOW', categoryId, scope: 'COMPANY_LEVEL' });
  const externalId = `rule-suggestion-${suffix}`;
  await ledger.ingestTransactions(context(), bankAccountId, [source({ externalId, merchantName: 'Pilot Travel Center #999' })]);
  const stored = await prisma.bankTransaction.findFirstOrThrow({ where: { bankAccountId, providerTransactionId: externalId }, include: { classification: true, allocations: true } });
  assert.equal(stored.classification?.reviewStatus, 'SUGGESTED');
  assert.equal(stored.classification?.categoryId, categoryId);
  assert.equal(stored.classification?.reviewedAt, null);
  assert.equal(stored.allocations.length, 0);
  assert.equal((await prisma.bankCategorizationRule.findUniqueOrThrow({ where: { id: rule.id } })).matchCount, 1);
  await categorization.deleteRule(context(), rule.id);
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
  await assert.rejects(
    new BankSyncService(prisma, ledger, new Map()).syncNow(
      { ...context(), activeCompanyId: foreignCompanyId, companyIds: [foreignCompanyId] },
      bankAccountId,
    ),
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

test('an error connection can retry safely and returns to active after a successful sync', async () => {
  const priorKey = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  process.env.BANK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: {
      provider: 'OTHER',
      accessTokenCiphertext: encryptBankAccessToken(`retry-${suffix}`),
      status: 'ERROR',
      lastSyncErrorCode: 'PROVIDER_SYNC_FAILED',
      lastSyncErrorMessage: 'Bank transaction synchronization failed.',
      syncCursor: null,
    },
  });
  let calls = 0;
  const adapter: BankProviderAdapter = {
    provider: 'OTHER',
    async syncTransactions() {
      calls += 1;
      return {
        added: [source({
          externalId: `retry-zero-${suffix}`,
          amountMinor: BigInt(0),
          providerAmountText: '0.00',
          direction: null,
        })],
        modified: [],
        removedExternalIds: [],
        nextCursor: 'retry-cursor',
        hasMore: false,
      };
    },
  };
  const sync = new BankSyncService(prisma, ledger, new Map([['OTHER', adapter]]));
  const result = await sync.syncNow(context(), bankAccountId);
  assert.deepEqual(result, { added: 1, updated: 0, removed: 0, cursor: 'retry-cursor' });
  assert.equal(calls, 1);
  const recovered = await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } });
  assert.equal(recovered.status, 'ACTIVE');
  assert.equal(recovered.syncCursor, 'retry-cursor');
  assert.ok(recovered.lastSync);
  assert.equal(recovered.lastSyncErrorCode, null);
  assert.equal(recovered.lastSyncErrorMessage, null);
  assert.equal(await prisma.bankTransaction.count({
    where: { bankAccountId, providerTransactionId: `retry-zero-${suffix}` },
  }), 1);
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

test('a burst of verified webhook queue events coalesces into one idempotent sync pipeline', async () => {
  const priorKey = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  process.env.BANK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: {
      provider: 'OTHER',
      createdByUserId: userId,
      accessTokenCiphertext: encryptBankAccessToken(`webhook-${suffix}`),
      status: 'ACTIVE',
      syncCursor: null,
    },
  });
  let calls = 0;
  const adapter: BankProviderAdapter = {
    provider: 'OTHER',
    async syncTransactions() {
      calls += 1;
      return {
        added: [source({ externalId: `webhook-transaction-${suffix}` })],
        modified: [],
        removedExternalIds: [],
        nextCursor: 'webhook-cursor',
        hasMore: false,
      };
    },
  };
  const events = await Promise.all([0, 1, 2].map((index) => prisma.bankProviderWebhookEvent.create({
    data: {
      bankAccountId,
      provider: 'OTHER',
      eventHashSha256: `webhook-hash-${suffix}-${index}`,
      webhookType: 'TRANSACTIONS',
      webhookCode: 'SYNC_UPDATES_AVAILABLE',
    },
  })));
  const sync = new BankSyncService(prisma, ledger, new Map([['OTHER', adapter]]));
  await Promise.all(events.map((event) => sync.syncWebhookEvent(event.id)));
  await sync.syncWebhookEvent(events[0].id);
  assert.equal(calls, 1);
  assert.equal(await prisma.bankProviderWebhookEvent.count({
    where: { id: { in: events.map(({ id }) => id) }, status: 'COMPLETED' },
  }), 3);
  assert.equal(await prisma.bankTransaction.count({ where: { bankAccountId, providerTransactionId: `webhook-transaction-${suffix}` } }), 1);
  process.env.BANK_TOKEN_ENCRYPTION_KEY = priorKey;
});

test('public-token exchange persistence creates one encrypted connection and masked accounts', async () => {
  const priorKey = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  process.env.BANK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 10).toString('base64');
  const service = new PlaidConnectionService(prisma);
  const itemId = `plaid-item-${suffix}`;
  const connection = await service.createConnection(context(), {
    itemId,
    accessToken: `plaid-token-${suffix}`,
    institutionId: 'ins-test',
    institutionName: 'Mock Bank',
    consentedProducts: ['transactions'],
    accounts: [{
      accountId: `plaid-account-${suffix}`,
      name: 'Checking',
      officialName: 'Operating Checking',
      type: 'depository',
      subtype: 'checking',
      mask: '1234',
      currentBalance: 42.25,
      availableBalance: 40,
      currency: 'USD',
    }],
  });
  const stored = await prisma.bankAccount.findUniqueOrThrow({
    where: { id: connection.id },
    include: { accounts: true },
  });
  assert.equal(stored.companyId, companyId);
  assert.equal(stored.createdByUserId, userId);
  assert.equal(stored.plaidAccessToken, null);
  assert.ok(stored.accessTokenCiphertext?.startsWith('v1:'));
  assert.equal(stored.accounts[0].mask, '1234');
  assert.equal(stored.accounts[0].currentBalanceMinor, BigInt(4225));
  await assert.rejects(
    service.createConnection(context(), {
      itemId,
      accessToken: 'duplicate-not-real',
      institutionName: 'Mock Bank',
      accounts: [],
    }),
    BankLedgerValidationError,
  );
  await prisma.financialAuditEvent.deleteMany({ where: { metadata: { path: ['bankAccountId'], equals: connection.id } } });
  await prisma.bankSubAccount.deleteMany({ where: { bankAccountId: connection.id } });
  await prisma.bankAccount.delete({ where: { id: connection.id } });
  process.env.BANK_TOKEN_ENCRYPTION_KEY = priorKey;
});

test('normal refresh updates provider balances independently from transactions by stable account ID', async () => {
  const priorKey = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  process.env.BANK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString('base64');
  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: {
      provider: 'OTHER',
      accessTokenCiphertext: encryptBankAccessToken(`balance-${suffix}`),
      status: 'ACTIVE',
      syncCursor: null,
    },
  });
  const secondExternalAccountId = `second-${suffix}`;
  await prisma.bankSubAccount.create({
    data: {
      bankAccountId,
      externalAccountId: secondExternalAccountId,
      name: 'Stored second account',
      type: 'credit',
      currentBalanceMinor: BigInt(500),
    },
  });
  let currentBalanceMinor = BigInt(4_332_278);
  let transactionExternalId = `balance-transaction-${suffix}`;
  let includeSecondAccount = true;
  const adapter: BankProviderAdapter = {
    provider: 'OTHER',
    async syncAccounts() {
      return [
        {
          externalAccountId,
          name: 'Provider-renamed operating account',
          type: 'depository',
          subtype: 'checking',
          currency: 'USD',
          currentBalanceMinor,
          availableBalanceMinor: BigInt(2_923_220),
        },
        ...(includeSecondAccount ? [{
          externalAccountId: secondExternalAccountId,
          name: 'Second provider account',
          type: 'credit',
          currency: 'USD',
          currentBalanceMinor: BigInt(-12_542),
          availableBalanceMinor: null,
        }] : []),
      ];
    },
    async syncTransactions() {
      return {
        added: transactionExternalId ? [source({ externalId: transactionExternalId })] : [],
        modified: [],
        removedExternalIds: [],
        nextCursor: 'balance-cursor',
        hasMore: false,
      };
    },
  };
  const sync = new BankSyncService(prisma, ledger, new Map([['OTHER', adapter]]));
  const first = await sync.syncNow(context(), bankAccountId);
  assert.equal(first.balance?.status, 'updated');
  const stored = await prisma.bankSubAccount.findUniqueOrThrow({
    where: { bankAccountId_externalAccountId: { bankAccountId, externalAccountId } },
  });
  assert.equal(stored.currentBalanceMinor, BigInt(4_332_278));
  assert.equal(stored.availableBalanceMinor, BigInt(2_923_220));
  assert.ok(stored.lastSyncedAt);
  assert.equal(await prisma.bankSubAccount.count({ where: { bankAccountId } }), 2);
  assert.equal(await prisma.bankTransaction.count({
    where: { bankAccountId, providerTransactionId: transactionExternalId },
  }), 1);

  currentBalanceMinor = BigInt(2_923_220);
  transactionExternalId = '';
  await sync.syncNow(context(), bankAccountId);
  assert.equal((await prisma.bankSubAccount.findUniqueOrThrow({
    where: { bankAccountId_externalAccountId: { bankAccountId, externalAccountId } },
  })).currentBalanceMinor, BigInt(2_923_220));
  includeSecondAccount = false;
  await sync.syncNow(context(), bankAccountId);
  assert.equal((await prisma.bankSubAccount.findUniqueOrThrow({
    where: {
      bankAccountId_externalAccountId: {
        bankAccountId,
        externalAccountId: secondExternalAccountId,
      },
    },
  })).isActive, false);
  assert.equal(await prisma.financialAuditEvent.count({
    where: { operatingGroupId: groupId, action: 'BANK_BALANCE_REFRESHED' },
  }), 3);
  process.env.BANK_TOKEN_ENCRYPTION_KEY = priorKey;
});

test('balance refresh preserves missing accounts and does not auto-create unknown provider accounts', async () => {
  const priorKey = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  process.env.BANK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 16).toString('base64');
  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: {
      provider: 'OTHER',
      accessTokenCiphertext: encryptBankAccessToken(`account-discovery-${suffix}`),
      status: 'ACTIVE',
    },
  });
  const before = await prisma.bankSubAccount.findUniqueOrThrow({
    where: { bankAccountId_externalAccountId: { bankAccountId, externalAccountId } },
  });
  const unknownId = `unknown-${suffix}`;
  const adapter: BankProviderAdapter = {
    provider: 'OTHER',
    async syncAccounts() {
      return [{
        externalAccountId: unknownId,
        name: 'New unapproved provider account',
        type: 'depository',
        currency: 'USD',
        currentBalanceMinor: BigInt(999_999),
        availableBalanceMinor: BigInt(999_999),
      }];
    },
    async syncTransactions() {
      return { added: [], modified: [], removedExternalIds: [], nextCursor: 'discovery', hasMore: false };
    },
  };
  const result = await new BankSyncService(prisma, ledger, new Map([['OTHER', adapter]])).syncNow(context(), bankAccountId);
  assert.equal(result.balance?.status, 'updated');
  if (result.balance?.status === 'updated') {
    assert.equal(result.balance.unknownAccountCount, 1);
    assert.ok(result.balance.missingAccountCount >= 1);
  }
  assert.equal(await prisma.bankSubAccount.count({ where: { bankAccountId, externalAccountId: unknownId } }), 0);
  const after = await prisma.bankSubAccount.findUniqueOrThrow({
    where: { bankAccountId_externalAccountId: { bankAccountId, externalAccountId } },
  });
  assert.equal(after.currentBalanceMinor, before.currentBalanceMinor);
  assert.equal(after.lastSyncedAt?.getTime(), before.lastSyncedAt?.getTime());
  assert.equal(after.isActive, false);
  process.env.BANK_TOKEN_ENCRYPTION_KEY = priorKey;
});

test('malformed provider account snapshots fail closed without changing last known balances', async () => {
  const priorKey = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  process.env.BANK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64');
  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: {
      provider: 'OTHER',
      accessTokenCiphertext: encryptBankAccessToken(`malformed-accounts-${suffix}`),
      status: 'ACTIVE',
    },
  });
  const before = await prisma.bankSubAccount.findUniqueOrThrow({
    where: { bankAccountId_externalAccountId: { bankAccountId, externalAccountId } },
  });
  const adapter: BankProviderAdapter = {
    provider: 'OTHER',
    async syncAccounts() { return []; },
    async syncTransactions() {
      return { added: [], modified: [], removedExternalIds: [], nextCursor: 'malformed', hasMore: false };
    },
  };
  const result = await new BankSyncService(prisma, ledger, new Map([['OTHER', adapter]])).syncNow(context(), bankAccountId);
  assert.equal(result.balance?.status, 'failed');
  const after = await prisma.bankSubAccount.findUniqueOrThrow({
    where: { bankAccountId_externalAccountId: { bankAccountId, externalAccountId } },
  });
  assert.equal(after.currentBalanceMinor, before.currentBalanceMinor);
  assert.equal(after.lastSyncedAt?.getTime(), before.lastSyncedAt?.getTime());
  process.env.BANK_TOKEN_ENCRYPTION_KEY = priorKey;
});

test('balance failure preserves the last known snapshot while transaction sync can succeed', async () => {
  const priorKey = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  process.env.BANK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString('base64');
  const secret = `balance-provider-secret-${suffix}`;
  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: {
      provider: 'OTHER',
      accessTokenCiphertext: encryptBankAccessToken(secret),
      status: 'ACTIVE',
    },
  });
  const before = await prisma.bankSubAccount.findUniqueOrThrow({
    where: { bankAccountId_externalAccountId: { bankAccountId, externalAccountId } },
  });
  let balanceCalls = 0;
  let transactionCalls = 0;
  const adapter: BankProviderAdapter = {
    provider: 'OTHER',
    async syncAccounts() {
      balanceCalls += 1;
      throw new Error(`timeout ${secret}`);
    },
    async syncTransactions() {
      transactionCalls += 1;
      return { added: [], modified: [], removedExternalIds: [], nextCursor: 'partial-cursor', hasMore: false };
    },
  };
  const result = await new BankSyncService(prisma, ledger, new Map([['OTHER', adapter]])).syncNow(context(), bankAccountId);
  assert.equal(result.balance?.status, 'failed');
  assert.equal(balanceCalls, 1);
  assert.equal(transactionCalls, 1);
  const after = await prisma.bankSubAccount.findUniqueOrThrow({
    where: { bankAccountId_externalAccountId: { bankAccountId, externalAccountId } },
  });
  assert.equal(after.currentBalanceMinor, before.currentBalanceMinor);
  assert.equal(after.availableBalanceMinor, before.availableBalanceMinor);
  assert.equal(after.lastSyncedAt?.getTime(), before.lastSyncedAt?.getTime());
  const connection = await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } });
  assert.ok(connection.lastSync);
  assert.equal(connection.lastSyncErrorCode, 'BALANCE_REFRESH_FAILED');
  assert.equal(connection.lastSyncErrorMessage?.includes(secret), false);
  process.env.BANK_TOKEN_ENCRYPTION_KEY = priorKey;
});

test('transaction failure does not roll back a successful provider balance refresh', async () => {
  const priorKey = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  process.env.BANK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 14).toString('base64');
  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: {
      provider: 'OTHER',
      accessTokenCiphertext: encryptBankAccessToken(`transaction-failure-${suffix}`),
      status: 'ACTIVE',
    },
  });
  const adapter: BankProviderAdapter = {
    provider: 'OTHER',
    async syncAccounts() {
      return [{
        externalAccountId,
        name: 'Operating',
        type: 'depository',
        currency: 'USD',
        currentBalanceMinor: BigInt(777_777),
        availableBalanceMinor: null,
      }];
    },
    async syncTransactions() {
      throw new Error('transaction provider unavailable');
    },
  };
  await assert.rejects(
    new BankSyncService(prisma, ledger, new Map([['OTHER', adapter]])).syncNow(context(), bankAccountId),
    BankProviderUnavailableError,
  );
  const stored = await prisma.bankSubAccount.findUniqueOrThrow({
    where: { bankAccountId_externalAccountId: { bankAccountId, externalAccountId } },
  });
  assert.equal(stored.currentBalanceMinor, BigInt(777_777));
  assert.equal(stored.availableBalanceMinor, null);
  assert.ok(stored.lastSyncedAt);
  process.env.BANK_TOKEN_ENCRYPTION_KEY = priorKey;
});

test('concurrent refresh requests coalesce into one bounded provider workflow', async () => {
  const priorKey = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  process.env.BANK_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 15).toString('base64');
  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: {
      provider: 'OTHER',
      accessTokenCiphertext: encryptBankAccessToken(`concurrent-${suffix}`),
      status: 'ERROR',
    },
  });
  let balanceCalls = 0;
  let transactionCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const adapter: BankProviderAdapter = {
    provider: 'OTHER',
    async syncAccounts() {
      balanceCalls += 1;
      return [{
        externalAccountId,
        name: 'Operating',
        type: 'depository',
        currency: 'USD',
        currentBalanceMinor: BigInt(100),
        availableBalanceMinor: BigInt(100),
      }];
    },
    async syncTransactions() {
      transactionCalls += 1;
      await gate;
      return { added: [], modified: [], removedExternalIds: [], nextCursor: 'coalesced', hasMore: false };
    },
  };
  const sync = new BankSyncService(prisma, ledger, new Map([['OTHER', adapter]]));
  const first = sync.syncNow(context(), bankAccountId);
  const second = sync.syncNow(context(), bankAccountId);
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  await Promise.all([first, second]);
  assert.equal(balanceCalls, 1);
  assert.equal(transactionCalls, 1);
  process.env.BANK_TOKEN_ENCRYPTION_KEY = priorKey;
});
