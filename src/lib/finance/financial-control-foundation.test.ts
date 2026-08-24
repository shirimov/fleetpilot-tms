import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { AuthorizationService, type CompanyAuthorization, type TrustedSession } from '@/lib/auth/authorization';
import { FinancialControlAuthorizationService, type FinancialAuthorization } from './financial-control-authorization';
import { FinancialControlService } from './financial-control-service';
import { FinancialValidationError } from './financial-control-errors';
import { GenericCsvImporter } from './financial-importers';
import { FinancialStatementStorage, validateFinancialStatement } from './financial-statement-storage';
import { normalizeCurrency, parsePositiveMinorUnits } from './money';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const service = new FinancialControlService(prisma);
let session: TrustedSession = null;
const authorization = new AuthorizationService(prisma, async () => session);
const financialAuthorization = new FinancialControlAuthorizationService(prisma, authorization);
let companyId = ''; let foreignCompanyId = ''; let ownerId = ''; let adminId = ''; let memberId = ''; let groupId = ''; let categoryId = ''; let sourceId = ''; let truckId = ''; let foreignTruckId = ''; let statementId = ''; let recordId = ''; let transactionId = '';

function companyContext(userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER'): CompanyAuthorization {
  return { companyId, role, user: { id: userId, email: `${userId}@test.dev`, displayName: role, isActive: true, activeCompanyId: companyId } };
}
function context(userId = ownerId, role: 'OWNER' | 'ADMIN' = 'OWNER'): FinancialAuthorization {
  return { userId, role, activeCompanyId: companyId, operatingGroupId: groupId, companyIds: [companyId] };
}

before(async () => {
  const [company, foreign] = await Promise.all([prisma.company.create({ data: { name: `Financial ${suffix}` } }), prisma.company.create({ data: { name: `Financial foreign ${suffix}` } })]);
  companyId = company.id; foreignCompanyId = foreign.id;
  const [owner, admin, member] = await Promise.all([
    prisma.user.create({ data: { email: `financial-owner-${suffix}@test.dev`, displayName: 'Owner', activeCompanyId: companyId } }),
    prisma.user.create({ data: { email: `financial-admin-${suffix}@test.dev`, displayName: 'Admin', activeCompanyId: companyId } }),
    prisma.user.create({ data: { email: `financial-member-${suffix}@test.dev`, displayName: 'Member', activeCompanyId: companyId } }),
  ]);
  ownerId = owner.id; adminId = admin.id; memberId = member.id;
  await prisma.companyMembership.createMany({ data: [{ companyId, userId: ownerId, role: 'OWNER' }, { companyId, userId: adminId, role: 'ADMIN' }, { companyId, userId: memberId, role: 'MEMBER' }] });
  const group = await service.createGroup(`Financial Group ${suffix}`, companyContext(ownerId, 'OWNER'));
  groupId = group.id;
  categoryId = (await prisma.financialCategory.findFirstOrThrow({ where: { operatingGroupId: groupId, name: 'Fuel' } })).id;
  sourceId = (await service.createSource({ name: `Bank ${suffix}`, type: 'BANK_ACCOUNT', companyId, currency: 'USD' }, context())).id;
  const [truck, foreignTruck] = await Promise.all([prisma.truck.create({ data: { companyId, unitNumber: `financial-${suffix}` } }), prisma.truck.create({ data: { companyId: foreignCompanyId, unitNumber: `financial-foreign-${suffix}` } })]);
  truckId = truck.id; foreignTruckId = foreignTruck.id;
});

after(async () => {
  await prisma.financialExpectationMatch.deleteMany({ where: { expectation: { operatingGroupId: groupId } } });
  await prisma.financialExpectation.deleteMany({ where: { operatingGroupId: groupId } });
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
  await prisma.operatingGroup.deleteMany({ where: { id: groupId } });
  await prisma.truck.deleteMany({ where: { id: { in: [truckId, foreignTruckId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, memberId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
  await prisma.$disconnect();
});

test('minor-unit arithmetic is exact and currency is normalized', () => {
  assert.equal(parsePositiveMinorUnits('0.10') + parsePositiveMinorUnits('0.20'), BigInt(30));
  assert.equal(parsePositiveMinorUnits('48,320.05'), BigInt(4832005));
  assert.equal(normalizeCurrency('usd'), 'USD');
  assert.throws(() => parsePositiveMinorUnits('-1.00'), FinancialValidationError);
  assert.throws(() => parsePositiveMinorUnits('1.001'), FinancialValidationError);
});

test('OWNER and ADMIN group access is allowed while MEMBER is denied', async () => {
  session = { user: { id: ownerId } };
  assert.equal((await financialAuthorization.requireContext()).operatingGroupId, groupId);
  session = { user: { id: adminId } };
  assert.equal((await financialAuthorization.requireContext()).role, 'ADMIN');
  session = { user: { id: memberId } };
  await assert.rejects(financialAuthorization.requireContext(), AuthorizationDeniedError);
});

test('cross-company source is rejected', async () => {
  await assert.rejects(service.createSource({ name: 'Foreign', type: 'BANK_ACCOUNT', companyId: foreignCompanyId, currency: 'USD' }, context()), FinancialValidationError);
});

test('statement validation checks MIME, signature, size, private UUID storage and duplicate checksum', async () => {
  const csv = new TextEncoder().encode('date,description,amount\n2026-08-01,Amazon,48320.00\n');
  const file = new File([csv], 'august.csv', { type: 'text/csv' });
  const metadata = validateFinancialStatement(file, csv);
  const { extension, ...documentMetadata } = metadata;
  assert.equal(extension, '.csv');
  const root = await mkdtemp(path.join(os.tmpdir(), 'financial-statement-'));
  const storage = new FinancialStatementStorage(root);
  const storageKey = await storage.put(csv);
  assert.match(storageKey, /^[0-9a-f-]{36}$/);
  assert.deepEqual(await readFile(path.join(root, 'financial-statements', storageKey)), Buffer.from(csv));
  const statement = await service.registerStatement({ sourceId, type: 'BANK_STATEMENT', periodStart: new Date('2026-08-01'), periodEnd: new Date('2026-08-31'), ...documentMetadata, storageKey, currency: 'USD' }, context());
  statementId = statement.id;
  await assert.rejects(service.registerStatement({ sourceId, type: 'BANK_STATEMENT', periodStart: new Date('2026-08-01'), periodEnd: new Date('2026-08-31'), ...documentMetadata, storageKey: '11111111-1111-4111-8111-111111111111', currency: 'USD' }, context()), /already uploaded/);
  assert.throws(() => validateFinancialStatement(new File([csv], 'fake.pdf', { type: 'application/pdf' }), csv), FinancialValidationError);
});

test('generic CSV import preserves raw values and flags duplicate fingerprints', async () => {
  const csv = new TextEncoder().encode('date,description,amount,reference\n2026-08-01,Amazon,48320.00,A1\n2026-08-01,Amazon,48320.00,A1\n');
  const rows = new GenericCsvImporter().parse(csv);
  assert.equal(rows[0].rawAmount, '48320.00');
  assert.equal(rows[0].candidateAmountMinor, BigInt(4832000));
  await service.importRawRecords(statementId, rows, context());
  const stored = await prisma.financialImportRecord.findMany({ where: { statementId }, orderBy: { sourceRowIndex: 'asc' } });
  assert.equal(stored.length, 2);
  assert.equal(stored[1].status, 'DUPLICATE_SUSPECTED');
  recordId = stored[0].id;
  await assert.rejects(service.importRawRecords(statementId, rows, context()));
});

test('multiple evidence records map to one economic transaction without double counting', async () => {
  const transaction = await service.createTransaction({ transactionDate: '2026-08-02', amount: '48320.00', direction: 'INFLOW', description: 'Amazon settlement', sourceId, currency: 'USD' }, context());
  transactionId = transaction.id;
  await service.matchEvidence(transactionId, { importRecordId: recordId, amount: '48000.00', method: 'PARTIAL' }, context());
  const corroborating = await prisma.financialImportRecord.findFirstOrThrow({ where: { statementId, id: { not: recordId } } });
  await service.matchEvidence(transactionId, { importRecordId: corroborating.id, amount: '48320.00', method: 'EXACT', role: 'CORROBORATING' }, context());
  assert.equal(await prisma.financialTransactionEvidence.count({ where: { transactionId } }), 2);
  assert.equal((await prisma.financialTransaction.findUniqueOrThrow({ where: { id: transactionId } })).reconciliationStatus, 'PARTIALLY_MATCHED');
  await assert.rejects(service.matchEvidence(transactionId, { importRecordId: recordId, amount: '1000.00', method: 'PARTIAL' }, context()), /exceeds/);
  assert.equal((await service.overview(context())).inflowMinor, '4832000');
});

test('allocation must equal transaction amount and rejects cross-company truck', async () => {
  await assert.rejects(service.replaceAllocations(transactionId, [{ amount: '100.00', categoryId, truckId }], context()), /exactly equal/);
  await assert.rejects(service.replaceAllocations(transactionId, [{ amount: '48320.00', categoryId, truckId: foreignTruckId }], context()), /outside/);
  const result = await service.replaceAllocations(transactionId, [{ amount: '48000.00', categoryId, truckId }, { amount: '320.00', categoryId }], context());
  assert.equal(result.totalMinor, '4832000');
  assert.equal(result.allocationCount, 2);
});

test('owner-recoverable expense preserves expected and outstanding recovery', async () => {
  const owner = await prisma.financialParty.create({ data: { operatingGroupId: groupId, type: 'OWNER_OPERATOR', name: `Owner ${suffix}` } });
  const expense = await service.createTransaction({ transactionDate: '2026-08-03', amount: '850.00', direction: 'OUTFLOW', description: 'Owner tire', ownerId: owner.id, recoverableFromOwner: true, expectedRecoveryAmount: '850.00', currency: 'USD' }, context());
  assert.equal(expense.expectedRecoveryMinor, '85000');
  assert.equal(expense.recoveredAmountMinor, '0');
  assert.equal(expense.recoveryStatus, 'EXPECTED');
});

test('expected money supports partial matching and rejects over-matching', async () => {
  const expectation = await service.createExpectation({ amount: '50000.00', direction: 'INFLOW', description: 'Expected Amazon settlement', expectedDateStart: '2026-08-01', expectedDateEnd: '2026-08-10', currency: 'USD' }, context());
  await service.matchExpectation(expectation.id, { transactionId, amount: '48000.00' }, context());
  assert.equal((await prisma.financialExpectation.findUniqueOrThrow({ where: { id: expectation.id } })).status, 'PARTIALLY_MATCHED');
  await assert.rejects(service.matchExpectation(expectation.id, { transactionId, amount: '1000.00' }, context()), /actual transaction amount/);
});

test('deterministic transaction duplicates are flagged but preserved for review', async () => {
  const first = await service.createTransaction({ transactionDate: '2026-08-09', amount: '10.00', direction: 'OUTFLOW', description: 'Duplicate candidate', reference: 'DUP-1', currency: 'USD' }, context());
  const second = await service.createTransaction({ transactionDate: '2026-08-09', amount: '10.00', direction: 'OUTFLOW', description: 'Duplicate candidate', reference: 'DUP-1', currency: 'USD' }, context());
  assert.notEqual(first.id, second.id);
  assert.equal(second.reconciliationStatus, 'DUPLICATE_SUSPECTED');
});

test('database constraints reject non-positive money and invalid confidence', async () => {
  await assert.rejects(prisma.financialTransaction.update({ where: { id: transactionId }, data: { amountMinor: BigInt(0) } }));
  await assert.rejects(prisma.financialTransactionEvidence.updateMany({ where: { transactionId }, data: { confidenceBasisPoints: 10001 } }));
});
