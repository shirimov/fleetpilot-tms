import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { AuthorizationService, type CompanyAuthorization, type TrustedSession } from '@/lib/auth/authorization';
import { FinancialControlAuthorizationService, type FinancialAuthorization } from './financial-control-authorization';
import { FinancialControlService, financialDate } from './financial-control-service';
import { FinancialNotFoundError, FinancialValidationError } from './financial-control-errors';
import { GenericCsvImporter } from './financial-importers';
import { FinancialStatementStorage, validateFinancialStatement } from './financial-statement-storage';
import { formatMinorUnitsDecimal, minorUnitsToDecimalInput, normalizeCurrency, parsePositiveMinorUnits } from './money';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const service = new FinancialControlService(prisma);
let session: TrustedSession = null;
const authorization = new AuthorizationService(prisma, async () => session);
const financialAuthorization = new FinancialControlAuthorizationService(prisma, authorization);
let companyId = ''; let foreignCompanyId = ''; let ownerId = ''; let adminId = ''; let memberId = ''; let groupId = ''; let categoryId = ''; let sourceId = ''; let destinationSourceId = ''; let euroSourceId = ''; let truckId = ''; let secondTruckId = ''; let foreignTruckId = ''; let statementId = ''; let recordId = ''; let transactionId = '';

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
  destinationSourceId = (await service.createSource({ name: `Savings ${suffix}`, type: 'BANK_ACCOUNT', companyId, currency: 'USD' }, context())).id;
  euroSourceId = (await service.createSource({ name: `Euro ${suffix}`, type: 'BANK_ACCOUNT', companyId, currency: 'EUR' }, context())).id;
  const [truck, secondTruck, foreignTruck] = await Promise.all([prisma.truck.create({ data: { companyId, unitNumber: `financial-${suffix}` } }), prisma.truck.create({ data: { companyId, unitNumber: `financial-2-${suffix}` } }), prisma.truck.create({ data: { companyId: foreignCompanyId, unitNumber: `financial-foreign-${suffix}` } })]);
  truckId = truck.id; secondTruckId = secondTruck.id; foreignTruckId = foreignTruck.id;
});

after(async () => {
  await prisma.adminFeeAgreement.deleteMany({ where: { operatingGroupId: groupId } });
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
  await prisma.financialProgram.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroupMembership.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroup.deleteMany({ where: { id: groupId } });
  await prisma.truck.deleteMany({ where: { id: { in: [truckId, secondTruckId, foreignTruckId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, memberId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
  await prisma.$disconnect();
});

test('minor-unit arithmetic is exact and currency is normalized', () => {
  assert.deepEqual(['0.01', '0.10', '1.00', '1,234.56', '999,999.99'].map((amount) => parsePositiveMinorUnits(amount)), [BigInt(1), BigInt(10), BigInt(100), BigInt(123456), BigInt(99999999)]);
  assert.equal(parsePositiveMinorUnits('0.10') + parsePositiveMinorUnits('0.20'), BigInt(30));
  assert.equal(parsePositiveMinorUnits('48,320.05'), BigInt(4832005));
  assert.equal(normalizeCurrency('usd'), 'USD');
  assert.throws(() => parsePositiveMinorUnits('-1.00'), FinancialValidationError);
  assert.throws(() => parsePositiveMinorUnits('1.001'), FinancialValidationError);
  assert.throws(() => parsePositiveMinorUnits(String(0.1 + 0.2)), FinancialValidationError);
  assert.equal(minorUnitsToDecimalInput(BigInt('9007199254740993')), '90071992547409.93');
  assert.equal(formatMinorUnitsDecimal(BigInt('9007199254740993')), '90,071,992,547,409.93');
});

test('financial calendar dates preserve the selected day without timezone conversion', () => {
  assert.equal(financialDate('2026-08-15', 'Date').toISOString(), '2026-08-15T00:00:00.000Z');
  assert.equal(financialDate('2024-02-29', 'Date').toISOString(), '2024-02-29T00:00:00.000Z');
  assert.throws(() => financialDate('2026-02-30', 'Date'), /invalid/);
  assert.throws(() => financialDate('08/15/2026', 'Date'), /invalid/);
});

test('category hierarchy supports arbitrary depth and full paths', async () => {
  const root = await service.createCategory({ name: `Company Expenses ${suffix}`, type: 'DIRECT_EXPENSE' }, context());
  const admin = await service.createCategory({ name: `Admin ${suffix}`, type: 'DIRECT_EXPENSE', parentCategoryId: root.id }, context());
  const compliance = await service.createCategory({ name: `Compliance ${suffix}`, type: 'DIRECT_EXPENSE', parentCategoryId: admin.id }, context());
  const mvr = await service.createCategory({ name: `MVR ${suffix}`, type: 'DIRECT_EXPENSE', parentCategoryId: compliance.id }, context());
  const categories = await service.listCategories(context());
  assert.equal(categories.find((category) => category.id === mvr.id)?.path, `Company Expenses ${suffix} / Admin ${suffix} / Compliance ${suffix} / MVR ${suffix}`);
  await assert.rejects(service.updateCategory(root.id, { parentCategoryId: mvr.id }, context()), /cycle/);
  await assert.rejects(service.updateCategory(root.id, { parentCategoryId: root.id }, context()), /own parent/);
  await service.updateCategory(mvr.id, { isActive: false }, context());
  assert.equal((await prisma.financialCategory.findUniqueOrThrow({ where: { id: mvr.id } })).isActive, false);
  await assert.rejects(service.createTransaction({ transactionDate: '2026-08-17', amount: '18.00', direction: 'OUTFLOW', description: 'Inactive MVR', categoryId: mvr.id, currency: 'USD' }, context()), /dimension/);
});

test('category parents cannot cross operating groups', async () => {
  const foreignGroup = await prisma.operatingGroup.create({ data: { name: `Category foreign ${suffix}` } });
  const foreignCategory = await prisma.financialCategory.create({ data: { operatingGroupId: foreignGroup.id, name: `Foreign category ${suffix}`, type: 'OTHER' } });
  await assert.rejects(service.createCategory({ name: `Invalid child ${suffix}`, type: 'OTHER', parentCategoryId: foreignCategory.id }, context()), /outside/);
  await prisma.financialCategory.delete({ where: { id: foreignCategory.id } });
  await prisma.operatingGroup.delete({ where: { id: foreignGroup.id } });
});

test('program is an independent allocation dimension and does not duplicate a transaction', async () => {
  const program = await service.createProgram({ code: `ADMIN-${suffix}`, name: `Admin program ${suffix}`, type: 'ADMIN' }, context());
  const transaction = await service.createTransaction({ transactionDate: '2026-08-18', amount: '50.00', direction: 'OUTFLOW', description: 'MVR expense', categoryId, currency: 'USD' }, context());
  const allocated = await service.replaceAllocations(transaction.id, [{ amount: '50.00', categoryId, programId: program.id }], context());
  assert.equal(allocated.totalMinor, '5000');
  assert.equal(await prisma.financialTransaction.count({ where: { id: transaction.id } }), 1);
  assert.equal((await prisma.financialAllocation.findFirstOrThrow({ where: { transactionId: transaction.id } })).programId, program.id);
});

test('bulk allocation tracks exact partial, remaining, complete, and over-allocation states', async () => {
  const transaction = await service.createTransaction({ transactionDate: '2026-08-19', amount: '50000.00', direction: 'OUTFLOW', description: 'Fuel statement', categoryId, currency: 'USD' }, context());
  const partial = await service.replaceAllocations(transaction.id, [{ amount: '1820.00', categoryId, truckId }, { amount: '1640.00', categoryId, truckId: secondTruckId }], context(), false);
  assert.deepEqual(partial, { allocationCount: 2, totalMinor: '346000', remainingMinor: '4654000', allocationStatus: 'PARTIAL' });
  await assert.rejects(service.replaceAllocations(transaction.id, [{ amount: '50000.01', categoryId }], context(), false), /exceed/);
  const complete = await service.replaceAllocations(transaction.id, [{ amount: '1820.00', categoryId, truckId }, { amount: '1640.00', categoryId, truckId: secondTruckId }, { amount: '46540.00', categoryId }], context());
  assert.equal(complete.allocationStatus, 'COMPLETE');
  assert.equal(complete.remainingMinor, '0');
  assert.equal(await prisma.truck.count({ where: { id: { in: [truckId, secondTruckId] } } }), 2);
});

test('dimension discovery reuses canonical equipment classification data', async () => {
  await prisma.truck.update({ where: { id: truckId }, data: { year: 2027, make: 'Volvo', model: 'VNL', isOwnerOp: true } });
  const trailer = await prisma.trailer.create({ data: { companyId, unitNumber: `dimension-${suffix}`, equipmentType: 'REEFER' } });
  const dimensions = await service.listDimensions(context());
  assert.deepEqual(dimensions.trucks.find((truck) => truck.id === truckId), { id: truckId, unitNumber: `financial-${suffix}`, year: 2027, make: 'Volvo', model: 'VNL', isOwnerOp: true });
  assert.equal(dimensions.trailers.find((item) => item.id === trailer.id)?.equipmentType, 'REEFER');
  assert.equal(await prisma.truck.count({ where: { id: truckId } }), 1);
  await prisma.trailer.delete({ where: { id: trailer.id } });
});

test('allocation rejects cross-group programs and preserves general overhead without a truck', async () => {
  const foreignGroup = await prisma.operatingGroup.create({ data: { name: `Program foreign ${suffix}` } });
  const foreignProgram = await prisma.financialProgram.create({ data: { operatingGroupId: foreignGroup.id, code: `FOREIGN-${suffix}`, name: `Foreign ${suffix}` } });
  const transaction = await service.createTransaction({ transactionDate: '2026-08-20', amount: '100.00', direction: 'OUTFLOW', description: 'Office software', categoryId, currency: 'USD' }, context());
  await assert.rejects(service.replaceAllocations(transaction.id, [{ amount: '100.00', categoryId, programId: foreignProgram.id }], context()), /outside/);
  const overhead = await service.replaceAllocations(transaction.id, [{ amount: '100.00', categoryId }], context());
  assert.equal(overhead.allocationStatus, 'COMPLETE');
  const stored = await prisma.financialAllocation.findFirstOrThrow({ where: { transactionId: transaction.id } });
  assert.equal(stored.truckId, null);
  await prisma.financialProgram.delete({ where: { id: foreignProgram.id } });
  await prisma.operatingGroup.delete({ where: { id: foreignGroup.id } });
});

test('Admin Fee agreements preserve owner and truck history with deterministic lookup', async () => {
  const ownerA = await prisma.financialParty.create({ data: { operatingGroupId: groupId, companyId, type: 'OWNER_OPERATOR', name: `Agreement owner A ${suffix}` } });
  const ownerB = await prisma.financialParty.create({ data: { operatingGroupId: groupId, companyId, type: 'OWNER_OPERATOR', name: `Agreement owner B ${suffix}` } });
  const may = await service.createAdminFeeAgreement({ scope: 'OWNER', ownerPartyId: ownerA.id, amount: '90.00', effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }, context());
  await service.createAdminFeeAgreement({ scope: 'OWNER', ownerPartyId: ownerA.id, amount: '100.00', effectiveFrom: '2026-07-01' }, context());
  const different = await service.createAdminFeeAgreement({ scope: 'OWNER', ownerPartyId: ownerB.id, amount: '95.00', effectiveFrom: '2026-01-01' }, context());
  const truck = await service.createAdminFeeAgreement({ scope: 'TRUCK', truckId, amount: '100.00', effectiveFrom: '2027-01-01' }, context());
  assert.equal(may.amountMinor, '9000');
  assert.equal(different.amountMinor, '9500');
  assert.equal(truck.amountMinor, '10000');
  assert.equal((await service.adminFeeAt({ ownerPartyId: ownerA.id, on: '2026-05-01' }, context()))?.amountMinor, '9000');
  assert.equal((await service.adminFeeAt({ ownerPartyId: ownerA.id, on: '2026-08-01' }, context()))?.amountMinor, '10000');
  assert.equal(await service.adminFeeAt({ ownerPartyId: ownerB.id, on: '2025-12-01' }, context()), null);
  await assert.rejects(service.createAdminFeeAgreement({ scope: 'OWNER', ownerPartyId: ownerA.id, amount: '91.00', effectiveFrom: '2026-06-01', effectiveTo: '2026-08-01' }, context()), /overlaps/);
  await assert.rejects(service.createAdminFeeAgreement({ scope: 'OWNER', ownerPartyId: ownerA.id, truckId, amount: '90.00', effectiveFrom: '2028-01-01' }, context()), /requires only/);
  assert.equal((await service.updateAdminFeeAgreement(may.id, { isActive: false }, context())).isActive, false);
  assert.equal((await prisma.adminFeeAgreement.findUniqueOrThrow({ where: { id: may.id } })).amountMinor, BigInt(9000));
});

test('Admin Fee dimensions reject foreign owner/truck references and create no actual charge', async () => {
  const foreignGroup = await prisma.operatingGroup.create({ data: { name: `Fee foreign ${suffix}` } });
  const foreignOwner = await prisma.financialParty.create({ data: { operatingGroupId: foreignGroup.id, type: 'OWNER_OPERATOR', name: `Foreign fee owner ${suffix}` } });
  await assert.rejects(service.createAdminFeeAgreement({ scope: 'OWNER', ownerPartyId: foreignOwner.id, amount: '90.00', effectiveFrom: '2026-01-01' }, context()), /outside/);
  await assert.rejects(service.createAdminFeeAgreement({ scope: 'TRUCK', truckId: foreignTruckId, amount: '90.00', effectiveFrom: '2026-01-01' }, context()), /outside/);
  assert.equal(await prisma.financialTransaction.count({ where: { description: { contains: 'Admin Fee' }, operatingGroupId: groupId } }), 0);
  await prisma.financialParty.delete({ where: { id: foreignOwner.id } });
  await prisma.operatingGroup.delete({ where: { id: foreignGroup.id } });
});

test('OWNER cleanup permanently deletes only dependency-free financial records', async () => {
  const manual = await service.createTransaction({ transactionDate: '2026-08-25', amount: '10.00', direction: 'OUTFLOW', description: `Disposable manual ${suffix}`, currency: 'USD' }, context());
  await assert.rejects(service.deleteTransaction(manual.id, context(adminId, 'ADMIN')), AuthorizationDeniedError);
  assert.deepEqual(await service.deleteTransaction(manual.id, context()), { deleted: true });
  assert.equal(await prisma.financialTransaction.findUnique({ where: { id: manual.id } }), null);

  const protectedTransaction = await service.createTransaction({ transactionDate: '2026-08-25', amount: '20.00', direction: 'OUTFLOW', description: `Protected allocation ${suffix}`, categoryId, currency: 'USD' }, context());
  await service.replaceAllocations(protectedTransaction.id, [{ amount: '20.00', categoryId }], context());
  await assert.rejects(service.deleteTransaction(protectedTransaction.id, context()), /financial history/);
  assert.deepEqual(await service.voidTransaction(protectedTransaction.id, context()), { status: 'VOIDED' });

  const recovery = await service.createTransaction({ transactionDate: '2026-08-25', amount: '30.00', direction: 'OUTFLOW', description: `Protected recovery ${suffix}`, recoverableFromOwner: true, currency: 'USD' }, context());
  await service.updateOwnerRecovery(recovery.id, { action: 'RECORD', amount: '5.00' }, context());
  await assert.rejects(service.deleteTransaction(recovery.id, context()), /financial history/);
  await service.updateOwnerRecovery(recovery.id, { action: 'WAIVE', notes: 'Cleanup-control regression fixture' }, context());

  const evidenceStatement = await service.registerStatement({ sourceId, type: 'BANK_STATEMENT', periodStart: new Date('2026-08-25'), periodEnd: new Date('2026-08-25'), originalFilename: `cleanup-${suffix}.csv`, displayFilename: `cleanup-${suffix}.csv`, mimeType: 'text/csv', byteSize: 32, storageKey: randomUUID(), checksumSha256: createHash('sha256').update(`cleanup-${suffix}`).digest('hex'), currency: 'USD' }, context());
  const [evidenceCandidate] = new GenericCsvImporter().parse(new TextEncoder().encode('date,description,amount\n2026-08-25,Evidence,35.00\n'));
  await service.importRawRecords(evidenceStatement.id, [evidenceCandidate], context());
  const evidenceRecord = await prisma.financialImportRecord.findFirstOrThrow({ where: { statementId: evidenceStatement.id } });
  const evidenceTransaction = await service.createTransaction({ transactionDate: '2026-08-25', amount: '35.00', direction: 'OUTFLOW', description: `Protected evidence ${suffix}`, currency: 'USD' }, context());
  await service.matchEvidence(evidenceTransaction.id, { importRecordId: evidenceRecord.id, amount: '35.00', method: 'EXACT' }, context());
  await assert.rejects(service.deleteTransaction(evidenceTransaction.id, context()), /financial history/);

  const foreignGroup = await prisma.operatingGroup.create({ data: { name: `Cleanup foreign ${suffix}`, companies: { create: { companyId: foreignCompanyId } } } });
  const foreignTransaction = await prisma.financialTransaction.create({ data: { operatingGroupId: foreignGroup.id, companyId: foreignCompanyId, transactionDate: new Date('2026-08-25'), amountMinor: BigInt(100), currency: 'USD', direction: 'OUTFLOW', description: `Foreign cleanup ${suffix}`, fingerprintSha256: createHash('sha256').update(`foreign-cleanup-${suffix}`).digest('hex'), createdByUserId: ownerId } });
  await assert.rejects(service.deleteTransaction(foreignTransaction.id, context()), FinancialNotFoundError);
  await prisma.financialTransaction.delete({ where: { id: foreignTransaction.id } });
  await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: foreignGroup.id } });
  await prisma.operatingGroup.delete({ where: { id: foreignGroup.id } });

  const unusedCategory = await service.createCategory({ name: `Disposable category ${suffix}`, type: 'OTHER' }, context());
  assert.deepEqual(await service.deleteCategory(unusedCategory.id, context()), { deleted: true });
  const parent = await service.createCategory({ name: `Protected parent ${suffix}`, type: 'OTHER' }, context());
  await service.createCategory({ name: `Protected child ${suffix}`, type: 'OTHER', parentCategoryId: parent.id }, context());
  await assert.rejects(service.deleteCategory(parent.id, context()), /dependent categories/);
  await assert.rejects(service.deleteCategory(categoryId, context()), /financial history/);
  await service.updateCategory(categoryId, { isActive: false }, context());
  assert.equal((await prisma.financialCategory.findUniqueOrThrow({ where: { id: categoryId } })).isActive, false);
  assert.equal((await prisma.financialTransaction.findUniqueOrThrow({ where: { id: protectedTransaction.id } })).categoryId, categoryId);
  await service.updateCategory(categoryId, { isActive: true }, context());

  const unusedProgram = await service.createProgram({ code: `DELETE-${suffix}`, name: `Delete ${suffix}` }, context());
  assert.deepEqual(await service.deleteProgram(unusedProgram.id, context()), { deleted: true });
  const usedProgram = await service.createProgram({ code: `KEEP-${suffix}`, name: `Keep ${suffix}` }, context());
  const programTransaction = await service.createTransaction({ transactionDate: '2026-08-25', amount: '40.00', direction: 'OUTFLOW', description: `Program history ${suffix}`, categoryId, currency: 'USD' }, context());
  await service.replaceAllocations(programTransaction.id, [{ amount: '40.00', categoryId, programId: usedProgram.id }], context());
  await assert.rejects(service.deleteProgram(usedProgram.id, context()), /financial history/);
  await service.updateProgram(usedProgram.id, { isActive: false }, context());
  assert.equal((await prisma.financialProgram.findUniqueOrThrow({ where: { id: usedProgram.id } })).isActive, false);

  const unusedSource = await service.createSource({ name: `Disposable source ${suffix}`, type: 'OTHER', currency: 'USD' }, context());
  assert.deepEqual(await service.deleteSource(unusedSource.id, context()), { deleted: true });
  await assert.rejects(service.deleteSource(sourceId, context()), /financial history/);
  await service.updateSource(sourceId, { isActive: false }, context());
  assert.equal((await prisma.financialSource.findUniqueOrThrow({ where: { id: sourceId } })).isActive, false);
  await service.updateSource(sourceId, { isActive: true }, context());

  const owner = await prisma.financialParty.create({ data: { operatingGroupId: groupId, companyId, type: 'OWNER_OPERATOR', name: `Cleanup owner ${suffix}` } });
  const future = await service.createAdminFeeAgreement({ scope: 'OWNER', ownerPartyId: owner.id, amount: '90.00', effectiveFrom: '2099-01-01' }, context());
  assert.deepEqual(await service.deleteAdminFeeAgreement(future.id, context()), { deleted: true });
  const historical = await service.createAdminFeeAgreement({ scope: 'OWNER', ownerPartyId: owner.id, amount: '100.00', effectiveFrom: '2020-01-01', effectiveTo: '2020-12-31' }, context());
  await assert.rejects(service.deleteAdminFeeAgreement(historical.id, context()), /Historical/);
  await service.updateAdminFeeAgreement(historical.id, { isActive: false }, context());
  assert.equal((await prisma.adminFeeAgreement.findUniqueOrThrow({ where: { id: historical.id } })).isActive, false);
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
  assert.equal(expense.recoveryStatus, 'OPEN');
});

test('TRANSFER uses distinct same-currency group accounts and is excluded from operating totals', async () => {
  const before = await service.overview(context());
  const transfer = await service.createTransaction({ transactionDate: '2026-08-04', amount: '1234.56', direction: 'TRANSFER', description: 'Move operating cash', sourceId, destinationSourceId, currency: 'USD' }, context());
  assert.equal(transfer.direction, 'TRANSFER');
  const after = await service.overview(context());
  assert.equal(after.inflowMinor, before.inflowMinor);
  assert.equal(after.outflowMinor, before.outflowMinor);
  assert.equal(after.operatingNetMinor, before.operatingNetMinor);
  assert.equal(after.transferCount, before.transferCount + 1);
  await assert.rejects(service.createTransaction({ transactionDate: '2026-08-04', amount: '1.00', direction: 'TRANSFER', description: 'Same account', sourceId, destinationSourceId: sourceId, currency: 'USD' }, context()), /distinct/);
  await assert.rejects(service.createTransaction({ transactionDate: '2026-08-04', amount: '1.00', direction: 'TRANSFER', description: 'FX blocked', sourceId, destinationSourceId: euroSourceId, currency: 'USD' }, context()), /currency/);
  const foreignGroup = await prisma.operatingGroup.create({ data: { name: `Foreign group ${suffix}`, companies: { create: { companyId: foreignCompanyId } } } });
  const foreignSource = await prisma.financialSource.create({ data: { operatingGroupId: foreignGroup.id, companyId: foreignCompanyId, name: `Foreign bank ${suffix}`, type: 'BANK_ACCOUNT', currency: 'USD' } });
  await assert.rejects(service.createTransaction({ transactionDate: '2026-08-04', amount: '1.00', direction: 'TRANSFER', description: 'Cross group', sourceId, destinationSourceId: foreignSource.id, currency: 'USD' }, context()), /outside/);
  await prisma.financialSource.delete({ where: { id: foreignSource.id } });
  await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: foreignGroup.id } });
  await prisma.operatingGroup.delete({ where: { id: foreignGroup.id } });
});

test('owner recovery supports multiple partials, full recovery, waiver, and exact outstanding values', async () => {
  const party = await prisma.financialParty.create({ data: { operatingGroupId: groupId, companyId, type: 'OWNER_OPERATOR', name: `Recovery owner ${suffix}` } });
  const foreignParty = await prisma.financialParty.create({ data: { operatingGroupId: groupId, companyId: foreignCompanyId, type: 'OWNER_OPERATOR', name: `Foreign recovery owner ${suffix}` } });
  await assert.rejects(service.createTransaction({ transactionDate: '2026-08-05', amount: '850.00', direction: 'OUTFLOW', description: 'Cross-company recovery', ownerId: foreignParty.id, recoverableFromOwner: true, expectedRecoveryAmount: '850.00', currency: 'USD' }, context()), /company/);
  const recovered = await service.createTransaction({ transactionDate: '2026-08-05', amount: '850.00', direction: 'OUTFLOW', description: 'Recoverable repair', ownerId: party.id, recoverableFromOwner: true, expectedRecoveryAmount: '850.00', currency: 'USD' }, context());
  assert.equal((await service.updateOwnerRecovery(recovered.id, { action: 'RECORD', amount: '200.00' }, context())).recoveryStatus, 'PARTIAL');
  const partial = await service.updateOwnerRecovery(recovered.id, { action: 'RECORD', amount: '300.00' }, context());
  assert.equal(partial.outstandingAmountMinor, '35000');
  await assert.rejects(service.updateOwnerRecovery(recovered.id, { action: 'RECORD', amount: '351.00' }, context()), /exceeds/);
  const full = await service.updateOwnerRecovery(recovered.id, { action: 'RECORD', amount: '350.00' }, context());
  assert.equal(full.recoveryStatus, 'RECOVERED');
  assert.equal(full.outstandingAmountMinor, '0');

  const waived = await service.createTransaction({ transactionDate: '2026-08-06', amount: '850.00', direction: 'OUTFLOW', description: 'Partially waived repair', ownerId: party.id, recoverableFromOwner: true, expectedRecoveryAmount: '850.00', currency: 'USD' }, context());
  await service.updateOwnerRecovery(waived.id, { action: 'RECORD', amount: '500.00' }, context());
  const result = await service.updateOwnerRecovery(waived.id, { action: 'WAIVE', notes: 'Approved waiver' }, context());
  assert.deepEqual(result, { recoveredAmountMinor: '50000', waivedAmountMinor: '35000', outstandingAmountMinor: '0', recoveryStatus: 'WAIVED' });
  const overview = await service.overview(context());
  assert.equal(overview.exceptions.outstandingOwnerRecoveries, 1);
  assert.equal(await prisma.financialAuditEvent.count({ where: { transactionId: waived.id, action: { in: ['OWNER_RECOVERY_RECORDED', 'OWNER_RECOVERY_WAIVED'] } } }), 2);
});

test('concurrent expected-money matches cannot collectively exceed either cap', async () => {
  const expectation = await service.createExpectation({ amount: '10000.00', direction: 'INFLOW', description: 'Concurrent expected', expectedDateStart: '2026-08-01', currency: 'USD' }, context());
  const [first, second] = await Promise.all([
    service.createTransaction({ transactionDate: '2026-08-07', amount: '7000.00', direction: 'INFLOW', description: 'Deposit A', currency: 'USD' }, context()),
    service.createTransaction({ transactionDate: '2026-08-08', amount: '7000.00', direction: 'INFLOW', description: 'Deposit B', currency: 'USD' }, context()),
  ]);
  const results = await Promise.allSettled([
    service.matchExpectation(expectation.id, { transactionId: first.id, amount: '7000.00' }, context()),
    service.matchExpectation(expectation.id, { transactionId: second.id, amount: '7000.00' }, context()),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const total = await prisma.financialExpectationMatch.aggregate({ where: { expectationId: expectation.id }, _sum: { matchedAmountMinor: true } });
  assert.equal(total._sum.matchedAmountMinor, BigInt(700000));
});

test('concurrent evidence matches cannot collectively exceed a transaction cap', async () => {
  const csv = new TextEncoder().encode('date,description,amount,reference\n2026-08-10,Deposit A,7000.00,C1\n2026-08-11,Deposit B,7000.00,C2\n');
  const metadata = validateFinancialStatement(new File([csv], 'concurrent.csv', { type: 'text/csv' }), csv);
  const { extension, ...documentMetadata } = metadata;
  assert.equal(extension, '.csv');
  const statement = await service.registerStatement({ sourceId, type: 'BANK_STATEMENT', periodStart: new Date('2026-08-10'), periodEnd: new Date('2026-08-11'), ...documentMetadata, storageKey: '22222222-2222-4222-8222-222222222222', currency: 'USD' }, context());
  await service.importRawRecords(statement.id, new GenericCsvImporter().parse(csv), context());
  const records = await prisma.financialImportRecord.findMany({ where: { statementId: statement.id } });
  const transaction = await service.createTransaction({ transactionDate: '2026-08-11', amount: '10000.00', direction: 'INFLOW', description: 'Concurrent evidence target', currency: 'USD' }, context());
  const results = await Promise.allSettled(records.map((record) => service.matchEvidence(transaction.id, { importRecordId: record.id, amount: '7000.00', method: 'PARTIAL' }, context())));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const total = await prisma.financialTransactionEvidence.aggregate({ where: { transactionId: transaction.id, role: 'PRIMARY' }, _sum: { matchedAmountMinor: true } });
  assert.equal(total._sum.matchedAmountMinor, BigInt(700000));
});

test('currency mismatches are rejected for evidence and expected money', async () => {
  const euroTransaction = await service.createTransaction({ transactionDate: '2026-08-12', amount: '10.00', direction: 'INFLOW', description: 'Euro receipt', sourceId: euroSourceId, currency: 'EUR' }, context());
  await assert.rejects(service.matchEvidence(euroTransaction.id, { importRecordId: recordId, amount: '10.00', method: 'PARTIAL' }, context()), /currencies/);
  const usdExpectation = await service.createExpectation({ amount: '10.00', direction: 'INFLOW', description: 'USD expectation', expectedDateStart: '2026-08-12', currency: 'USD' }, context());
  await assert.rejects(service.matchExpectation(usdExpectation.id, { transactionId: euroTransaction.id, amount: '10.00' }, context()), /currencies/);
});

test('allocation supports explicit partial state, exact multi-dimension totals, and large BigInt precision', async () => {
  const transaction = await service.createTransaction({ transactionDate: '2026-08-13', amount: '90071992547409.93', direction: 'OUTFLOW', description: 'Large exact allocation', currency: 'USD' }, context());
  const partial = await service.replaceAllocations(transaction.id, [{ amount: '3200.00', categoryId, truckId }], context(), false);
  assert.equal(partial.allocationStatus, 'PARTIAL');
  await assert.rejects(service.replaceAllocations(transaction.id, [{ amount: '90071992547410.00', categoryId }], context()), /exceed/);
  const exact = await service.replaceAllocations(transaction.id, [{ amount: '3200.00', categoryId, truckId }, { amount: '1500.00', categoryId, truckId: secondTruckId }, { amount: '90071992542709.93', categoryId }], context());
  assert.equal(exact.totalMinor, '9007199254740993');
  assert.equal(exact.remainingMinor, '0');
});

test('completeness metrics distinguish registered, successful, failed, and pending statements', async () => {
  await prisma.financialStatement.createMany({ data: [
    { operatingGroupId: groupId, sourceId, type: 'BANK_STATEMENT', periodStart: new Date('2026-07-01'), periodEnd: new Date('2026-07-31'), originalFilename: 'failed.csv', displayFilename: 'failed.csv', mimeType: 'text/csv', byteSize: 1, storageKey: '33333333-3333-4333-8333-333333333333', checksumSha256: '3'.repeat(64), currency: 'USD', importStatus: 'FAILED', importedByUserId: ownerId },
    { operatingGroupId: groupId, sourceId, type: 'BANK_STATEMENT', periodStart: new Date('2026-06-01'), periodEnd: new Date('2026-06-30'), originalFilename: 'pending.csv', displayFilename: 'pending.csv', mimeType: 'text/csv', byteSize: 1, storageKey: '44444444-4444-4444-8444-444444444444', checksumSha256: '4'.repeat(64), currency: 'USD', importStatus: 'UPLOADED', importedByUserId: ownerId },
  ] });
  const overview = await service.overview(context());
  assert.ok(overview.statementsRegistered >= 4);
  assert.ok(overview.statementsImportedSuccessfully >= 2);
  assert.equal(overview.statementsImportFailed, 1);
  assert.equal(overview.statementsPending, 1);
  assert.ok(overview.completenessBasisPoints === null || overview.completenessBasisPoints >= 0 && overview.completenessBasisPoints <= 10000);
});

test('expected-money reconciliation supports one-to-many and many-to-one with exact residuals', async () => {
  const splitExpectation = await service.createExpectation({ amount: '10000.00', direction: 'INFLOW', description: 'Split deposit expectation', expectedDateStart: '2026-08-14', currency: 'USD' }, context());
  const firstDeposit = await service.createTransaction({ transactionDate: '2026-08-14', amount: '6000.00', direction: 'INFLOW', description: 'Split deposit one', currency: 'USD' }, context());
  const secondDeposit = await service.createTransaction({ transactionDate: '2026-08-14', amount: '4000.00', direction: 'INFLOW', description: 'Split deposit two', currency: 'USD' }, context());
  await service.matchExpectation(splitExpectation.id, { transactionId: firstDeposit.id, amount: '6000.00' }, context());
  await service.matchExpectation(splitExpectation.id, { transactionId: secondDeposit.id, amount: '4000.00' }, context());
  assert.deepEqual(await prisma.financialExpectation.findUniqueOrThrow({ where: { id: splitExpectation.id }, select: { matchedAmountMinor: true, status: true } }), { matchedAmountMinor: BigInt(1000000), status: 'MATCHED' });

  const combinedDeposit = await service.createTransaction({ transactionDate: '2026-08-15', amount: '12000.00', direction: 'INFLOW', description: 'Combined deposit', currency: 'USD' }, context());
  const [firstExpectation, secondExpectation] = await Promise.all([
    service.createExpectation({ amount: '5000.00', direction: 'INFLOW', description: 'Combined part one', expectedDateStart: '2026-08-15', currency: 'USD' }, context()),
    service.createExpectation({ amount: '7000.00', direction: 'INFLOW', description: 'Combined part two', expectedDateStart: '2026-08-15', currency: 'USD' }, context()),
  ]);
  await service.matchExpectation(firstExpectation.id, { transactionId: combinedDeposit.id, amount: '5000.00' }, context());
  await service.matchExpectation(secondExpectation.id, { transactionId: combinedDeposit.id, amount: '7000.00' }, context());
  const total = await prisma.financialExpectationMatch.aggregate({ where: { transactionId: combinedDeposit.id }, _sum: { matchedAmountMinor: true } });
  assert.equal(total._sum.matchedAmountMinor, BigInt(1200000));
});

test('same-dollar transactions from distinct sources are preserved without automatic duplicate merging', async () => {
  const first = await service.createTransaction({ transactionDate: '2026-08-16', amount: '55.00', direction: 'OUTFLOW', description: 'Legitimate same amount', reference: 'SOURCE-A', sourceId, currency: 'USD' }, context());
  const second = await service.createTransaction({ transactionDate: '2026-08-16', amount: '55.00', direction: 'OUTFLOW', description: 'Legitimate same amount', reference: 'SOURCE-A', sourceId: destinationSourceId, currency: 'USD' }, context());
  assert.notEqual(first.id, second.id);
  assert.notEqual(second.reconciliationStatus, 'DUPLICATE_SUSPECTED');
});

test('zero-data completeness is explicit and divide-by-zero safe', async () => {
  const emptyGroup = await prisma.operatingGroup.create({ data: { name: `Empty group ${suffix}` } });
  const empty = await service.overview({ ...context(), operatingGroupId: emptyGroup.id, companyIds: [] });
  assert.equal(empty.statementsRegistered, 0);
  assert.equal(empty.rawRecordsImported, 0);
  assert.equal(empty.fullyReconciledCount, 0);
  assert.equal(empty.completenessBasisPoints, null);
  assert.equal(empty.reconciliationBasisPoints, null);
  await prisma.operatingGroup.delete({ where: { id: emptyGroup.id } });
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
