import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { FinancialAuthorization } from './financial-control-authorization';
import { FinancialControlService } from './financial-control-service';
import { FinancialConflictError, FinancialValidationError } from './financial-control-errors';
import { PilotImportService } from './pilot-import-service';
import { pilotXlsFixture } from '../../../tests/fixtures/pilot-xls';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const control = new FinancialControlService(prisma);
const importer = new PilotImportService(prisma);
let companyId = ''; let foreignCompanyId = ''; let userId = ''; let groupId = ''; let sourceId = ''; let truckId = ''; let foreignTruckId = ''; let fuelCategoryId = ''; let adjustmentCategoryId = '';
const importedInvoiceIds: string[] = [];
const providerAccountHash = createHash('sha256').update('123456789').digest('hex');

function context(): FinancialAuthorization { return { userId, role: 'OWNER', activeCompanyId: companyId, operatingGroupId: groupId, companyIds: [companyId] }; }
function metadata(name: string) { return { originalFilename: `${name}.xls`, displayFilename: `${name}.xls`, mimeType: 'application/vnd.ms-excel', byteSize: 1000, storageKey: randomUUID(), checksumSha256: name.padEnd(64, '0').slice(0, 64) }; }

before(async () => {
  const company = await prisma.company.create({ data: { name: `Pilot ${suffix}` } }); companyId = company.id;
  const foreign = await prisma.company.create({ data: { name: `Pilot foreign ${suffix}` } }); foreignCompanyId = foreign.id;
  const user = await prisma.user.create({ data: { email: `pilot-${suffix}@test.dev`, displayName: 'Pilot owner', activeCompanyId: companyId } }); userId = user.id;
  await prisma.companyMembership.create({ data: { companyId, userId, role: 'OWNER' } });
  const group = await control.createGroup(`Pilot Group ${suffix}`, { companyId, role: 'OWNER', user: { id: userId, email: user.email, displayName: user.displayName, isActive: true, activeCompanyId: companyId } }); groupId = group.id;
  sourceId = (await control.createSource({ name: `Pilot EFS ${suffix}`, type: 'FUEL_CARD', companyId, currency: 'USD', provider: 'Pilot' }, context())).id;
  truckId = (await prisma.truck.create({ data: { companyId, unitNumber: '125' } })).id;
  foreignTruckId = (await prisma.truck.create({ data: { companyId: foreignCompanyId, unitNumber: `foreign-${suffix}` } })).id;
  fuelCategoryId = (await prisma.financialCategory.findFirstOrThrow({ where: { operatingGroupId: groupId, name: 'Fuel' } })).id;
  adjustmentCategoryId = (await prisma.financialCategory.findFirstOrThrow({ where: { operatingGroupId: groupId, name: 'Other' } })).id;
  await prisma.pilotProductMapping.createMany({ data: [
    { operatingGroupId: groupId, providerAccountHash, productCode: '020', productType: 'TRUCK_DIESEL', categoryId: fuelCategoryId, approvedByUserId: userId },
    { operatingGroupId: groupId, providerAccountHash, productCode: '140', productType: 'DEF', categoryId: fuelCategoryId, approvedByUserId: userId },
    { operatingGroupId: groupId, providerAccountHash, productCode: 'ADJUSTMENT:FREIGHT_RATE', productType: 'UNKNOWN_PRODUCT', categoryId: adjustmentCategoryId, approvedByUserId: userId },
  ] });
});

after(async () => {
  await prisma.financialExpectationMatch.deleteMany({ where: { expectation: { operatingGroupId: groupId } } });
  await prisma.financialAllocation.deleteMany({ where: { transaction: { operatingGroupId: groupId } } });
  await prisma.financialTransactionEvidence.deleteMany({ where: { transaction: { operatingGroupId: groupId } } });
  await prisma.pilotImportIssue.deleteMany({ where: { invoice: { operatingGroupId: groupId } } });
  await prisma.pilotFuelProductLine.deleteMany({ where: { invoice: { operatingGroupId: groupId } } });
  await prisma.pilotInvoiceAdjustment.deleteMany({ where: { invoice: { operatingGroupId: groupId } } });
  await prisma.pilotFuelingEvent.deleteMany({ where: { invoice: { operatingGroupId: groupId } } });
  await prisma.financialAuditEvent.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.financialTransaction.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.pilotInvoiceDocument.deleteMany({ where: { invoice: { operatingGroupId: groupId } } });
  await prisma.pilotProviderInvoice.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.financialExpectation.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.financialImportRecord.deleteMany({ where: { statement: { operatingGroupId: groupId } } });
  await prisma.financialStatement.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.pilotProductMapping.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.financialSource.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.financialCategory.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroupMembership.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroup.deleteMany({ where: { id: groupId } });
  await prisma.truck.deleteMany({ where: { id: { in: [truckId, foreignTruckId] } } });
  await prisma.companyMembership.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
  await prisma.$disconnect();
});

test('Pilot import creates exact canonical rows and posts Model C idempotently', async () => {
  const bytes = pilotXlsFixture({ invoiceNumber: '910001', adjustment: 2, total: 103 });
  const preview = await importer.createImport(bytes, metadata('pilot-910001'), sourceId, context());
  importedInvoiceIds.push(String(preview.id));
  assert.equal(preview.status, 'READY_TO_POST');
  assert.equal(preview.differenceMinor, '0');
  assert.equal((preview.events as unknown[]).length, 1);
  assert.equal((preview.adjustments as unknown[]).length, 1);
  assert.equal((preview.issues as unknown[]).length, 0);
  const posted = await importer.postInvoice(String(preview.id), context());
  assert.equal(posted.status, 'POSTED');
  const transactions = await prisma.financialTransaction.findMany({ where: { operatingGroupId: groupId, reference: '910001' }, include: { allocations: true, evidence: true } });
  assert.equal(transactions.length, 2);
  assert.deepEqual(transactions.map((row) => row.role), ['ECONOMIC', 'ECONOMIC']);
  assert.equal(transactions.reduce((sum, row) => sum + (row.direction === 'OUTFLOW' ? row.amountMinor : -row.amountMinor), BigInt(0)), BigInt(10300));
  assert.equal(transactions.reduce((sum, row) => sum + row.allocations.reduce((lineSum, line) => lineSum + line.amountMinor, BigInt(0)), BigInt(0)), BigInt(10300));
  assert.ok(transactions.every((row) => row.reconciliationStatus === 'RECONCILED' && row.evidence.length === row.allocations.length));
  assert.equal(await prisma.financialExpectation.count({ where: { operatingGroupId: groupId, reference: '910001', expectedAmountMinor: BigInt(10300) } }), 1);
  await importer.postInvoice(String(preview.id), context());
  assert.equal(await prisma.financialTransaction.count({ where: { operatingGroupId: groupId, reference: '910001' } }), 2);
  assert.equal(await prisma.financialExpectation.count({ where: { operatingGroupId: groupId, reference: '910001' } }), 1);
  await assert.rejects(() => importer.createImport(bytes, metadata('pilot-910001-copy'), sourceId, context()), FinancialConflictError);
});

test('Pilot mismatch and unknown data remain blocked for explicit review', async () => {
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910002', productCode: '999', unitNumber: 'missing', total: 102 }), metadata('pilot-910002'), sourceId, context());
  importedInvoiceIds.push(String(preview.id));
  assert.equal(preview.status, 'NEEDS_REVIEW');
  const codes = (preview.issues as Array<{ code: string }>).map((issue) => issue.code);
  assert.ok(codes.includes('UNMATCHED_TRUCK'));
  assert.ok(codes.includes('UNKNOWN_PRODUCT'));
  assert.ok(codes.includes('MISSING_CATEGORY'));
  assert.ok(codes.includes('AMOUNT_MISMATCH'));
  await assert.rejects(() => importer.postInvoice(String(preview.id), context()), FinancialConflictError);
  assert.equal(await prisma.financialTransaction.count({ where: { operatingGroupId: groupId, reference: '910002' } }), 0);
});

test('multiple product rows sharing a ticket post as one event transaction with line allocations', async () => {
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910003', additionalProductCode: '140' }), metadata('pilot-910003'), sourceId, context());
  importedInvoiceIds.push(String(preview.id));
  assert.equal(preview.status, 'READY_TO_POST');
  assert.equal((preview.events as Array<{ productLines: unknown[] }>).length, 1);
  assert.equal((preview.events as Array<{ productLines: unknown[] }>)[0].productLines.length, 2);
  await importer.postInvoice(String(preview.id), context());
  const transaction = await prisma.financialTransaction.findFirstOrThrow({ where: { operatingGroupId: groupId, reference: '910003' }, include: { allocations: true, evidence: true } });
  assert.equal(transaction.amountMinor, BigInt(12100));
  assert.equal(transaction.allocations.length, 2);
  assert.equal(transaction.evidence.length, 2);
  assert.equal(transaction.allocations.reduce((sum, row) => sum + row.amountMinor, BigInt(0)), transaction.amountMinor);
  await assert.rejects(() => importer.createImport(pilotXlsFixture({ invoiceNumber: '910003', amount: 102, total: 102, additionalProductCode: undefined }), metadata('pilot-910003-corrected'), sourceId, context()), FinancialConflictError);
});

test('manual truck resolution rejects cross-company canonical references', async () => {
  const invoice = await importer.getInvoice(importedInvoiceIds[1], context());
  const issue = (invoice.issues as Array<{ id: string; code: string }>).find((row) => row.code === 'UNMATCHED_TRUCK');
  assert.ok(issue);
  await assert.rejects(() => importer.resolveIssue(String(invoice.id), issue.id, { action: 'MATCH_TRUCK', truckId: foreignTruckId }, context()), FinancialValidationError);
  const unchanged = await importer.getInvoice(String(invoice.id), context());
  assert.equal((unchanged.events as Array<{ truckId: string | null }>)[0].truckId, null);
});
