import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import type { FinancialAuthorization } from './financial-control-authorization';
import { FinancialControlService } from './financial-control-service';
import { BankLedgerService } from './bank-ledger-service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const service = new FinancialControlService(prisma);
const bankLedger = new BankLedgerService(prisma);
let companyId = ''; let foreignCompanyId = ''; let groupId = ''; let foreignGroupId = '';
let ownerId = ''; let adminId = ''; let memberId = ''; let bankAccountId = ''; let categoryId = '';

function context(userId = ownerId, role: 'OWNER' | 'ADMIN' = 'OWNER'): FinancialAuthorization {
  return { userId, role, activeCompanyId: companyId, operatingGroupId: groupId, companyIds: [companyId] };
}

async function expectation(amount = '1000.00', direction: 'INFLOW' | 'OUTFLOW' = 'OUTFLOW', currency = 'USD') {
  return service.createExpectation({ amount, direction, currency, description: `Expected ${suffix}`, expectedDateStart: '2026-07-15' }, context());
}

async function bank(amountMinor = BigInt(100000), overrides: Record<string, unknown> = {}) {
  return prisma.bankTransaction.create({ data: {
    bankAccountId, companyId, providerTransactionId: `bank-${suffix}-${crypto.randomUUID()}`, date: new Date('2026-07-15T00:00:00Z'),
    amount: Number(amountMinor) / 100, amountMinor, providerAmountText: (Number(amountMinor) / 100).toFixed(2), currency: 'USD', direction: 'OUTFLOW',
    name: 'PILOT RECEIVABLE', merchantName: 'Pilot Flying J', pending: false, lifecycle: 'POSTED', ...overrides,
  } });
}

before(async () => {
  const [company, foreignCompany, owner, admin, member] = await Promise.all([
    prisma.company.create({ data: { name: `Bank reconciliation ${suffix}` } }),
    prisma.company.create({ data: { name: `Bank reconciliation foreign ${suffix}` } }),
    prisma.user.create({ data: { email: `bank-reconcile-owner-${suffix}@test.dev`, displayName: 'Owner' } }),
    prisma.user.create({ data: { email: `bank-reconcile-admin-${suffix}@test.dev`, displayName: 'Admin' } }),
    prisma.user.create({ data: { email: `bank-reconcile-member-${suffix}@test.dev`, displayName: 'Member' } }),
  ]);
  companyId = company.id; foreignCompanyId = foreignCompany.id; ownerId = owner.id; adminId = admin.id; memberId = member.id;
  const [group, foreignGroup] = await Promise.all([
    prisma.operatingGroup.create({ data: { name: `Bank reconciliation group ${suffix}` } }),
    prisma.operatingGroup.create({ data: { name: `Bank reconciliation foreign group ${suffix}` } }),
  ]);
  groupId = group.id; foreignGroupId = foreignGroup.id;
  await prisma.$transaction([
    prisma.operatingGroupCompany.create({ data: { operatingGroupId: groupId, companyId } }),
    prisma.operatingGroupCompany.create({ data: { operatingGroupId: foreignGroupId, companyId: foreignCompanyId } }),
    prisma.companyMembership.createMany({ data: [{ companyId, userId: ownerId, role: 'OWNER' }, { companyId, userId: adminId, role: 'ADMIN' }, { companyId, userId: memberId, role: 'MEMBER' }] }),
    prisma.operatingGroupMembership.createMany({ data: [{ operatingGroupId: groupId, userId: ownerId, role: 'OWNER' }, { operatingGroupId: groupId, userId: adminId, role: 'ADMIN' }, { operatingGroupId: groupId, userId: memberId, role: 'MEMBER' }] }),
  ]);
  await prisma.user.updateMany({ where: { id: { in: [ownerId, adminId, memberId] } }, data: { activeCompanyId: companyId } });
  bankAccountId = (await prisma.bankAccount.create({ data: { companyId, provider: 'PLAID', externalConnectionId: `bank-reconcile-${suffix}`, status: 'ACTIVE' } })).id;
  categoryId = (await prisma.financialCategory.create({ data: { operatingGroupId: groupId, name: `Fuel ${suffix}`, type: 'DIRECT_EXPENSE' } })).id;
});

after(async () => {
  await prisma.financialExpectationBankMatch.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.financialExpectationMatch.deleteMany({ where: { expectation: { operatingGroupId: groupId } } });
  await prisma.financialAuditEvent.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.financialAllocation.deleteMany({ where: { transaction: { operatingGroupId: groupId } } });
  await prisma.financialTransaction.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.financialExpectation.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.bankTransactionAllocation.deleteMany({ where: { bankTransaction: { bankAccountId } } });
  await prisma.bankTransactionClassification.deleteMany({ where: { bankTransaction: { bankAccountId } } });
  await prisma.bankTransactionExternalId.deleteMany({ where: { bankAccountId } });
  await prisma.bankTransaction.deleteMany({ where: { bankAccountId } });
  await prisma.bankAccount.delete({ where: { id: bankAccountId } });
  await prisma.financialCategory.delete({ where: { id: categoryId } });
  await prisma.operatingGroupMembership.deleteMany({ where: { operatingGroupId: { in: [groupId, foreignGroupId] } } });
  await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: { in: [groupId, foreignGroupId] } } });
  await prisma.companyMembership.deleteMany({ where: { userId: { in: [ownerId, adminId, memberId] } } });
  await prisma.operatingGroup.deleteMany({ where: { id: { in: [groupId, foreignGroupId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, memberId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
  await prisma.$disconnect();
});

test('exact bank settlement is durable, audited, idempotent, and creates no economics', async () => {
  const expected = await expectation(); const actual = await bank();
  const beforeTransactions = await prisma.financialTransaction.count();
  const beforeBank = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: actual.id } });
  const candidates = await service.listBankMatchCandidates(expected.id, context());
  assert.deepEqual(candidates.filter((candidate) => candidate.id === actual.id).map(({ eligible, amountDifferenceMinor }) => ({ eligible, amountDifferenceMinor })), [{ eligible: true, amountDifferenceMinor: '0' }]);
  const first = await service.matchExpectationToBank(expected.id, { bankTransactionId: actual.id }, context());
  const second = await service.matchExpectationToBank(expected.id, { bankTransactionId: actual.id }, context());
  assert.equal(first.id, second.id); assert.equal(second.idempotent, true);
  assert.deepEqual(await prisma.financialExpectation.findUniqueOrThrow({ where: { id: expected.id }, select: { status: true, matchedAmountMinor: true } }), { status: 'MATCHED', matchedAmountMinor: BigInt(100000) });
  assert.equal((await prisma.bankTransactionClassification.findUniqueOrThrow({ where: { bankTransactionId: actual.id } })).reconciliationStatus, 'MATCHED');
  assert.equal(await prisma.financialExpectationBankMatch.count({ where: { expectationId: expected.id, bankTransactionId: actual.id } }), 1);
  assert.equal(await prisma.financialAuditEvent.count({ where: { bankTransactionId: actual.id, action: 'EXPECTATION_BANK_MATCHED' } }), 1);
  assert.equal(await prisma.financialTransaction.count(), beforeTransactions);
  assert.deepEqual(await prisma.bankTransaction.findUniqueOrThrow({ where: { id: actual.id }, select: { amountMinor: true, date: true, name: true, merchantName: true, pending: true, lifecycle: true, providerTransactionId: true } }), { amountMinor: beforeBank.amountMinor, date: beforeBank.date, name: beforeBank.name, merchantName: beforeBank.merchantName, pending: beforeBank.pending, lifecycle: beforeBank.lifecycle, providerTransactionId: beforeBank.providerTransactionId });
  await assert.rejects(bankLedger.classifyTransaction(context(), actual.id, { categoryId, scope: 'COMPANY_LEVEL', reviewStatus: 'REVIEWED', reconciliationStatus: 'UNMATCHED', allocations: [] }), /independent economics/);
  await bankLedger.classifyTransaction(context(), actual.id, { categoryId: null, scope: 'COMPANY_LEVEL', reviewStatus: 'UNREVIEWED', reconciliationStatus: 'UNMATCHED', allocations: [], notes: 'Settlement evidence only' });
  assert.equal((await prisma.bankTransactionClassification.findUniqueOrThrow({ where: { bankTransactionId: actual.id } })).reconciliationStatus, 'MATCHED');
});

test('partial settlement updates exact residuals and rejects expectation and bank overmatching', async () => {
  const expected = await expectation(); const actual = await bank();
  await service.matchExpectationToBank(expected.id, { bankTransactionId: actual.id, matchedAmountMinor: '60000' }, context());
  assert.deepEqual(await prisma.financialExpectation.findUniqueOrThrow({ where: { id: expected.id }, select: { status: true, matchedAmountMinor: true } }), { status: 'PARTIALLY_MATCHED', matchedAmountMinor: BigInt(60000) });
  assert.equal((await prisma.bankTransactionClassification.findUniqueOrThrow({ where: { bankTransactionId: actual.id } })).reconciliationStatus, 'PARTIALLY_MATCHED');
  const anotherBank = await bank(BigInt(50000));
  await assert.rejects(service.matchExpectationToBank(expected.id, { bankTransactionId: anotherBank.id, matchedAmountMinor: '50000' }, context()), /expected amount/);
  const anotherExpected = await expectation('500.00');
  await assert.rejects(service.matchExpectationToBank(anotherExpected.id, { bankTransactionId: actual.id, matchedAmountMinor: '50000' }, context()), /bank transaction amount/);
});

test('transaction and bank matches share one authoritative expectation total', async () => {
  const expected = await expectation();
  const economicTransaction = await prisma.financialTransaction.create({ data: {
    operatingGroupId: groupId, companyId, transactionDate: new Date('2026-07-15'), amountMinor: BigInt(40000),
    currency: 'USD', direction: 'OUTFLOW', description: 'Existing partial actual', createdByUserId: ownerId,
  } });
  await service.matchExpectation(expected.id, { transactionId: economicTransaction.id, amount: '400.00' }, context());
  const actual = await bank(BigInt(60000));
  await service.matchExpectationToBank(expected.id, { bankTransactionId: actual.id }, context());
  assert.deepEqual(await prisma.financialExpectation.findUniqueOrThrow({ where: { id: expected.id }, select: { status: true, matchedAmountMinor: true } }), { status: 'MATCHED', matchedAmountMinor: BigInt(100000) });
  assert.equal(await prisma.financialExpectationMatch.count({ where: { expectationId: expected.id } }), 1);
  assert.equal(await prisma.financialExpectationBankMatch.count({ where: { expectationId: expected.id } }), 1);
});

test('partial banks and multiple expectations consume exact shared residuals', async () => {
  const expected = await expectation();
  const bankA = await bank(BigInt(60000)); const bankB = await bank(BigInt(40000));
  await service.matchExpectationToBank(expected.id, { bankTransactionId: bankA.id }, context());
  await service.matchExpectationToBank(expected.id, { bankTransactionId: bankB.id }, context());
  assert.deepEqual(await prisma.financialExpectation.findUniqueOrThrow({ where: { id: expected.id }, select: { status: true, matchedAmountMinor: true } }), { status: 'MATCHED', matchedAmountMinor: BigInt(100000) });
  assert.equal((await prisma.bankTransactionClassification.findUniqueOrThrow({ where: { bankTransactionId: bankA.id } })).reconciliationStatus, 'MATCHED');
  assert.equal((await prisma.bankTransactionClassification.findUniqueOrThrow({ where: { bankTransactionId: bankB.id } })).reconciliationStatus, 'MATCHED');

  const sharedBank = await bank(); const expectationA = await expectation('600.00'); const expectationB = await expectation('400.00');
  await service.matchExpectationToBank(expectationA.id, { bankTransactionId: sharedBank.id }, context());
  await service.matchExpectationToBank(expectationB.id, { bankTransactionId: sharedBank.id }, context());
  assert.equal((await prisma.bankTransactionClassification.findUniqueOrThrow({ where: { bankTransactionId: sharedBank.id } })).reconciliationStatus, 'MATCHED');
  assert.equal((await prisma.financialExpectationBankMatch.aggregate({ where: { bankTransactionId: sharedBank.id }, _sum: { matchedAmountMinor: true } }))._sum.matchedAmountMinor, BigInt(100000));
});

test('invalid minor-unit amounts and ambiguous candidates fail safe without auto-selection', async () => {
  const expected = await expectation(); const first = await bank(); const second = await bank();
  for (const invalid of ['0', '-1', '1.5', '100.00', 'not-money']) {
    await assert.rejects(service.matchExpectationToBank(expected.id, { bankTransactionId: first.id, matchedAmountMinor: invalid }, context()), /minor units are invalid/);
  }
  await assert.rejects(service.matchExpectationToBank(expected.id, { bankTransactionId: first.id, matchedAmountMinor: '9'.repeat(200) }, context()), /expected amount/);
  const candidates = (await service.listBankMatchCandidates(expected.id, context())).filter(({ id }) => id === first.id || id === second.id);
  assert.equal(candidates.length, 2);
  assert.equal(await prisma.financialExpectationBankMatch.count({ where: { expectationId: expected.id } }), 0);
});

test('direction, currency, pending, removed, and settled-state controls fail closed', async () => {
  const inflowExpected = await expectation('1000.00', 'INFLOW');
  await assert.rejects(service.matchExpectationToBank(inflowExpected.id, { bankTransactionId: (await bank()).id }, context()), /directions/);
  const euroExpected = await expectation('1000.00', 'OUTFLOW', 'EUR');
  await assert.rejects(service.matchExpectationToBank(euroExpected.id, { bankTransactionId: (await bank()).id }, context()), /currencies/);
  await assert.rejects(service.matchExpectationToBank((await expectation()).id, { bankTransactionId: (await bank(BigInt(100000), { pending: true, lifecycle: 'PENDING' })).id }, context()), /current posted/);
  await assert.rejects(service.matchExpectationToBank((await expectation()).id, { bankTransactionId: (await bank(BigInt(100000), { lifecycle: 'REMOVED', removedAt: new Date() })).id }, context()), /current posted/);
  const settled = await expectation(); await prisma.financialExpectation.update({ where: { id: settled.id }, data: { status: 'MATCHED', matchedAmountMinor: BigInt(100000) } });
  await assert.rejects(service.matchExpectationToBank(settled.id, { bankTransactionId: (await bank()).id }, context()), /already settled/);
});

test('concurrent duplicate and competing matches cannot double-consume money', async () => {
  const expected = await expectation(); const actual = await bank();
  const duplicate = await Promise.all([service.matchExpectationToBank(expected.id, { bankTransactionId: actual.id }, context()), service.matchExpectationToBank(expected.id, { bankTransactionId: actual.id }, context())]);
  assert.equal(duplicate[0].id, duplicate[1].id);
  const sharedBank = await bank(); const [firstExpected, secondExpected] = await Promise.all([expectation(), expectation()]);
  const competing = await Promise.allSettled([service.matchExpectationToBank(firstExpected.id, { bankTransactionId: sharedBank.id }, context()), service.matchExpectationToBank(secondExpected.id, { bankTransactionId: sharedBank.id }, context())]);
  assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await prisma.financialExpectationBankMatch.count({ where: { bankTransactionId: sharedBank.id } }), 1);

  const partialBank = await bank(); const [partialA, partialB] = await Promise.all([expectation(), expectation()]);
  const partialResults = await Promise.allSettled([
    service.matchExpectationToBank(partialA.id, { bankTransactionId: partialBank.id, matchedAmountMinor: '60000' }, context()),
    service.matchExpectationToBank(partialB.id, { bankTransactionId: partialBank.id, matchedAmountMinor: '60000' }, context()),
  ]);
  assert.equal(partialResults.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await prisma.financialExpectationBankMatch.aggregate({ where: { bankTransactionId: partialBank.id }, _sum: { matchedAmountMinor: true } }))._sum.matchedAmountMinor, BigInt(60000));
});

test('provider removal preserves settlement history and flags the bank movement for review', async () => {
  const expected = await expectation(); const actual = await bank(); const externalId = `removed-after-match-${suffix}`;
  await prisma.bankTransactionExternalId.create({ data: { bankAccountId, bankTransactionId: actual.id, externalId, isCurrent: true } });
  await service.matchExpectationToBank(expected.id, { bankTransactionId: actual.id }, context());
  await bankLedger.markRemoved(context(), bankAccountId, [externalId]);
  const removed = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: actual.id }, select: { lifecycle: true, removedAt: true } });
  assert.equal(removed.lifecycle, 'REMOVED'); assert.ok(removed.removedAt);
  assert.deepEqual(await prisma.bankTransactionClassification.findUniqueOrThrow({ where: { bankTransactionId: actual.id }, select: { reviewStatus: true, reconciliationStatus: true } }), { reviewStatus: 'NEEDS_REVIEW', reconciliationStatus: 'DISCREPANCY' });
  assert.equal(await prisma.financialExpectationBankMatch.count({ where: { expectationId: expected.id, bankTransactionId: actual.id } }), 1);
  assert.deepEqual(await prisma.financialExpectation.findUniqueOrThrow({ where: { id: expected.id }, select: { status: true, matchedAmountMinor: true } }), { status: 'MATCHED', matchedAmountMinor: BigInt(100000) });
});

test('authorization, tenant isolation, and duplicate-economic safeguards are enforced in the transaction', async () => {
  const adminExpectation = await expectation(); const adminBank = await bank();
  await service.matchExpectationToBank(adminExpectation.id, { bankTransactionId: adminBank.id }, context(adminId, 'ADMIN'));
  assert.equal((await prisma.financialExpectation.findUniqueOrThrow({ where: { id: adminExpectation.id } })).status, 'MATCHED');
  await assert.rejects(service.matchExpectationToBank((await expectation()).id, { bankTransactionId: (await bank()).id }, { ...context(), userId: memberId, role: 'ADMIN' }), AuthorizationDeniedError);
  await prisma.user.update({ where: { id: adminId }, data: { isActive: false } });
  await assert.rejects(service.matchExpectationToBank((await expectation()).id, { bankTransactionId: (await bank()).id }, context(adminId, 'ADMIN')), AuthorizationDeniedError);
  await prisma.user.update({ where: { id: adminId }, data: { isActive: true } });
  await prisma.operatingGroupMembership.delete({ where: { operatingGroupId_userId: { operatingGroupId: groupId, userId: adminId } } });
  await assert.rejects(service.matchExpectationToBank((await expectation()).id, { bankTransactionId: (await bank()).id }, context(adminId, 'ADMIN')), AuthorizationDeniedError);
  await prisma.operatingGroupMembership.create({ data: { operatingGroupId: groupId, userId: adminId, role: 'ADMIN' } });
  const foreignAccount = await prisma.bankAccount.create({ data: { companyId: foreignCompanyId, provider: 'PLAID', externalConnectionId: `foreign-${suffix}` } });
  const foreignBank = await prisma.bankTransaction.create({ data: { bankAccountId: foreignAccount.id, companyId: foreignCompanyId, providerTransactionId: `foreign-bank-${suffix}`, date: new Date('2026-07-15'), amount: 1000, amountMinor: BigInt(100000), currency: 'USD', direction: 'OUTFLOW', name: 'Foreign' } });
  await assert.rejects(service.matchExpectationToBank((await expectation()).id, { bankTransactionId: foreignBank.id }, context()), /Not found/);
  await prisma.bankTransaction.delete({ where: { id: foreignBank.id } }); await prisma.bankAccount.delete({ where: { id: foreignAccount.id } });
  const classified = await bank(); await prisma.bankTransactionClassification.create({ data: { bankTransactionId: classified.id, categoryId, reviewStatus: 'REVIEWED' } });
  await assert.rejects(service.matchExpectationToBank((await expectation()).id, { bankTransactionId: classified.id }, context()), /independent economics/);
});

test('membership revocation committed ahead of authorization locking prevents settlement', async () => {
  const expected = await expectation(); const actual = await bank();
  let release!: () => void; let locked!: () => void;
  const releaseGate = new Promise<void>((resolve) => { release = resolve; });
  const lockReady = new Promise<void>((resolve) => { locked = resolve; });
  const revoke = prisma.$transaction(async (tx) => {
    await tx.companyMembership.update({ where: { userId_companyId: { userId: ownerId, companyId } }, data: { role: 'MEMBER' } });
    locked(); await releaseGate;
  });
  await lockReady;
  const matchResult = service.matchExpectationToBank(expected.id, { bankTransactionId: actual.id }, context()).then(
    () => ({ status: 'fulfilled' as const }),
    (error: unknown) => ({ status: 'rejected' as const, error }),
  );
  await new Promise((resolve) => setTimeout(resolve, 25)); release(); await revoke;
  const result = await matchResult;
  await prisma.companyMembership.update({ where: { userId_companyId: { userId: ownerId, companyId } }, data: { role: 'OWNER' } });
  assert.equal(result.status, 'rejected');
  assert.equal(await prisma.financialExpectationBankMatch.count({ where: { expectationId: expected.id } }), 0);
});

test('existing FinancialTransaction expectation matching remains compatible', async () => {
  const expected = await expectation();
  const transaction = await prisma.financialTransaction.create({ data: { operatingGroupId: groupId, companyId, transactionDate: new Date('2026-07-15'), amountMinor: BigInt(100000), currency: 'USD', direction: 'OUTFLOW', description: 'Existing actual', createdByUserId: ownerId } });
  await service.matchExpectation(expected.id, { transactionId: transaction.id, amount: '1000.00' }, context());
  assert.equal((await prisma.financialExpectation.findUniqueOrThrow({ where: { id: expected.id } })).status, 'MATCHED');
});

test('real-scale Pilot regression preserves 112 economics, 174 allocations, and exact P&L', async () => {
  const transactionRows = Array.from({ length: 112 }, (_, index) => ({ id: `scale-tx-${suffix}-${index}`, operatingGroupId: groupId, companyId, transactionDate: new Date('2026-07-15'), amountMinor: index === 111 ? BigInt(5953073 - 111 * 50000) : BigInt(50000), currency: 'USD', direction: 'OUTFLOW' as const, description: `Pilot event ${index}`, status: 'POSTED' as const, reconciliationStatus: 'RECONCILED' as const, dataStatus: 'VERIFIED' as const, role: 'ECONOMIC' as const, createdByUserId: ownerId }));
  await prisma.financialTransaction.createMany({ data: transactionRows });
  const allocations = transactionRows.flatMap((transaction, index) => index < 62 ? [{ transactionId: transaction.id, amountMinor: transaction.amountMinor / BigInt(2), categoryId, companyId }, { transactionId: transaction.id, amountMinor: transaction.amountMinor - transaction.amountMinor / BigInt(2), categoryId, companyId }] : [{ transactionId: transaction.id, amountMinor: transaction.amountMinor, categoryId, companyId }]);
  await prisma.financialAllocation.createMany({ data: allocations });
  const expected = await expectation('59530.73'); const actual = await bank(BigInt(5953073));
  const before = await prisma.financialTransaction.aggregate({ where: { id: { startsWith: `scale-tx-${suffix}` } }, _sum: { amountMinor: true }, _count: true });
  await service.matchExpectationToBank(expected.id, { bankTransactionId: actual.id }, context());
  const after = await prisma.financialTransaction.aggregate({ where: { id: { startsWith: `scale-tx-${suffix}` } }, _sum: { amountMinor: true }, _count: true });
  assert.deepEqual(before, after); assert.equal(after._count, 112); assert.equal(after._sum.amountMinor, BigInt(5953073));
  assert.equal(await prisma.financialAllocation.count({ where: { transactionId: { startsWith: `scale-tx-${suffix}` } } }), 174);
  assert.equal((await prisma.financialExpectation.findUniqueOrThrow({ where: { id: expected.id } })).status, 'MATCHED');
  assert.equal((await prisma.bankTransactionClassification.findUniqueOrThrow({ where: { bankTransactionId: actual.id } })).reconciliationStatus, 'MATCHED');
});
