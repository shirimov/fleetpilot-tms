import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { FinancialAuthorization } from './financial-control-authorization';
import { FinancialControlService } from './financial-control-service';
import { FinancialConflictError, FinancialNotFoundError, FinancialValidationError } from './financial-control-errors';
import { PilotImportService } from './pilot-import-service';
import { OperatingGroupCompanyService } from './operating-group-company-service';
import { PilotProductMappingService, PILOT_GROUP_MAPPING_ACCOUNT } from './pilot-product-mapping-service';
import { pilotXlsFixture } from '../../../tests/fixtures/pilot-xls';
import type { PrivateFileStorage } from '@/lib/storage/private-file-storage';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const control = new FinancialControlService(prisma);
const importer = new PilotImportService(prisma);
const productMappings = new PilotProductMappingService(prisma);
const groupCompanies = new OperatingGroupCompanyService(prisma);
class MemoryStatementStorage implements PrivateFileStorage {
  readonly files = new Map<string, Uint8Array>();
  async put(bytes: Uint8Array) { const key = randomUUID(); this.files.set(key, bytes); return key; }
  async get(storageKey: string) { const bytes = this.files.get(storageKey); if (!bytes) throw new Error('missing test source'); return bytes; }
  async delete(storageKey: string) { this.files.delete(storageKey); }
}
const statementStorage = new MemoryStatementStorage();
const reparseImporter = new PilotImportService(prisma, statementStorage);
let companyId = ''; let relatedCompanyId = ''; let foreignCompanyId = ''; let userId = ''; let groupId = ''; let sourceId = ''; let truckId = ''; let relatedTruckId = ''; let foreignTruckId = ''; let fuelCategoryId = ''; let adjustmentCategoryId = '';
const importedInvoiceIds: string[] = [];
const extraTruckIds: string[] = [];
const extraCompanyIds: string[] = [];
const providerAccountHash = createHash('sha256').update('123456789').digest('hex');
const hashForTest = (value: string) => createHash('sha256').update(`${suffix}:${value}`).digest('hex');

const linkedExtraCompanyIds: string[] = [];
function context(): FinancialAuthorization { return { userId, role: 'OWNER', activeCompanyId: companyId, operatingGroupId: groupId, companyIds: [companyId, relatedCompanyId, ...linkedExtraCompanyIds] }; }
function partialContext(): FinancialAuthorization { return { ...context(), companyIds: [companyId] }; }
function metadata(name: string) { return { originalFilename: `${name}.xls`, displayFilename: `${name}.xls`, mimeType: 'application/vnd.ms-excel', byteSize: 1000, storageKey: randomUUID(), checksumSha256: name.padEnd(64, '0').slice(0, 64) }; }
async function storedMetadata(name: string, bytes: Uint8Array) {
  const storageKey = await statementStorage.put(bytes);
  return { ...metadata(name), byteSize: bytes.byteLength, storageKey, checksumSha256: createHash('sha256').update(bytes).digest('hex') };
}

async function markAsFaultyV1(invoiceId: string, parsedTotalMinor: bigint) {
  const invoice = await prisma.pilotProviderInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { invoiceTotalMinor: true } });
  await prisma.$transaction([
    prisma.pilotProviderInvoice.update({ where: { id: invoiceId }, data: { parseVersion: 'pilot-biff-v1', status: 'NEEDS_REVIEW', parsedTotalMinor, differenceMinor: parsedTotalMinor - invoice.invoiceTotalMinor } }),
    prisma.pilotImportIssue.create({ data: { invoiceId, code: 'AMOUNT_MISMATCH', message: 'Faulty v1 parser mismatch.' } }),
    prisma.financialAuditEvent.updateMany({ where: { pilotProviderInvoiceId: invoiceId, action: 'PILOT_INVOICE_PARSED' }, data: { metadata: { parseVersion: 'pilot-biff-v1', differenceMinor: (parsedTotalMinor - invoice.invoiceTotalMinor).toString() } } }),
  ]);
}

before(async () => {
  const company = await prisma.company.create({ data: { name: `Pilot ${suffix}` } }); companyId = company.id;
  const [related, foreign] = await Promise.all([
    prisma.company.create({ data: { name: `Pilot related ${suffix}` } }),
    prisma.company.create({ data: { name: `Pilot foreign ${suffix}` } }),
  ]); relatedCompanyId = related.id; foreignCompanyId = foreign.id;
  const user = await prisma.user.create({ data: { email: `pilot-${suffix}@test.dev`, displayName: 'Pilot owner', activeCompanyId: companyId } }); userId = user.id;
  await prisma.companyMembership.create({ data: { companyId, userId, role: 'OWNER' } });
  const group = await control.createGroup(`Pilot Group ${suffix}`, { companyId, role: 'OWNER', user: { id: userId, email: user.email, displayName: user.displayName, isActive: true, activeCompanyId: companyId } }); groupId = group.id;
  await prisma.$transaction([
    prisma.companyMembership.create({ data: { companyId: relatedCompanyId, userId, role: 'OWNER' } }),
    prisma.operatingGroupCompany.create({ data: { operatingGroupId: groupId, companyId: relatedCompanyId } }),
  ]);
  sourceId = (await control.createSource({ name: `Pilot EFS ${suffix}`, type: 'FUEL_CARD', companyId, currency: 'USD', provider: 'Pilot' }, context())).id;
  truckId = (await prisma.truck.create({ data: { companyId, unitNumber: '125' } })).id;
  relatedTruckId = (await prisma.truck.create({ data: { companyId: relatedCompanyId, unitNumber: '777', unitNumberNormalized: '777' } })).id;
  foreignTruckId = (await prisma.truck.create({ data: { companyId: foreignCompanyId, unitNumber: '777', unitNumberNormalized: '777' } })).id;
  fuelCategoryId = (await prisma.financialCategory.findFirstOrThrow({ where: { operatingGroupId: groupId, name: 'Fuel' } })).id;
  adjustmentCategoryId = (await prisma.financialCategory.findFirstOrThrow({ where: { operatingGroupId: groupId, name: 'Other' } })).id;
  await prisma.pilotProductMapping.createMany({ data: [
    { operatingGroupId: groupId, providerAccountHash, productCode: '020', productType: 'TRUCK_DIESEL', categoryId: fuelCategoryId, approvedByUserId: userId },
    { operatingGroupId: groupId, providerAccountHash, productCode: '033', productType: 'REEFER_FUEL', categoryId: fuelCategoryId, approvedByUserId: userId },
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
  await prisma.truck.deleteMany({ where: { id: { in: [truckId, relatedTruckId, foreignTruckId, ...extraTruckIds] } } });
  await prisma.companyMembership.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, relatedCompanyId, foreignCompanyId, ...extraCompanyIds] } } });
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
  await assert.rejects(() => importer.rematchTrucks(String(preview.id), context()), /cannot be rematched/);
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

test('inactive Truck requires explicit historical review, preserves provenance, and can post safely', async () => {
  const inactive = await prisma.truck.create({ data: { companyId: relatedCompanyId, unitNumber: '8558', unitNumberNormalized: '8558', status: 'INACTIVE' } });
  extraTruckIds.push(inactive.id);
  const authorizedContext = context();
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910018', unitNumber: '8558' }), metadata('pilot-910018'), sourceId, authorizedContext);
  importedInvoiceIds.push(String(preview.id));
  const event = (preview.events as Array<{ truckId: string | null; truckMatchStatus: string }>)[0];
  const issue = (preview.issues as Array<{ id: string; code: string; message: string }>).find(({ code }) => code === 'UNMATCHED_TRUCK');
  assert.deepEqual([event.truckId, event.truckMatchStatus], [null, 'UNMATCHED']);
  assert.match(issue?.message ?? '', /inactive Truck candidate.*explicit historical attribution review/);
  await assert.rejects(
    () => importer.resolveIssue(String(preview.id), issue!.id, { action: 'MATCH_TRUCK', truckId: inactive.id }, authorizedContext),
    /Explicit confirmation is required/,
  );
  assert.equal(await prisma.financialTransaction.count({ where: { reference: '910018' } }), 0);
  await importer.resolveIssue(String(preview.id), issue!.id, { action: 'MATCH_TRUCK', truckId: inactive.id, historicalInactiveAttribution: true }, authorizedContext);
  const reviewed = await importer.getInvoice(String(preview.id), authorizedContext);
  assert.equal(reviewed.status, 'READY_TO_POST');
  assert.deepEqual((reviewed.events as Array<{ truckId: string; truckMatchStatus: string }>).map(({ truckId, truckMatchStatus }) => ({ truckId, truckMatchStatus })), [{ truckId: inactive.id, truckMatchStatus: 'MANUALLY_MATCHED' }]);
  const audit = await prisma.financialAuditEvent.findFirstOrThrow({ where: { pilotProviderInvoiceId: String(preview.id), action: 'PILOT_IMPORT_ISSUE_RESOLVED' } });
  assert.equal((audit.metadata as Record<string, unknown>).historicalInactiveAttribution, true);
  assert.equal((audit.metadata as Record<string, unknown>).sourceUnitNumberNormalized, '8558');
  await importer.postInvoice(String(preview.id), authorizedContext);
  const allocation = await prisma.financialAllocation.findFirstOrThrow({ where: { transaction: { reference: '910018' } } });
  assert.equal(allocation.truckId, inactive.id);
  assert.equal((await prisma.truck.findUniqueOrThrow({ where: { id: inactive.id } })).status, 'INACTIVE');
});

test('inactive Truck posting fails closed without durable reviewed provenance', async () => {
  const inactive = await prisma.truck.create({ data: { companyId, unitNumber: '8559', unitNumberNormalized: '8559', status: 'INACTIVE' } });
  extraTruckIds.push(inactive.id);
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910019', unitNumber: '8559' }), metadata('pilot-910019'), sourceId, context());
  importedInvoiceIds.push(String(preview.id));
  await prisma.$transaction([
    prisma.pilotFuelingEvent.updateMany({ where: { invoiceId: String(preview.id) }, data: { truckId: inactive.id, truckMatchStatus: 'MANUALLY_MATCHED' } }),
    prisma.pilotImportIssue.updateMany({ where: { invoiceId: String(preview.id) }, data: { status: 'RESOLVED', resolvedByUserId: userId, resolvedAt: new Date() } }),
    prisma.pilotProviderInvoice.update({ where: { id: String(preview.id) }, data: { status: 'READY_TO_POST' } }),
  ]);
  await assert.rejects(() => importer.postInvoice(String(preview.id), context()), /explicit reviewed historical attribution/);
  assert.equal(await prisma.financialTransaction.count({ where: { reference: '910019' } }), 0);
  assert.equal(await prisma.financialExpectation.count({ where: { reference: '910019' } }), 0);
});

test('reviewed inactive attribution revalidates status, company, ambiguity, deletion, and current authorization', async () => {
  const authorizedContext = context();
  const makeReviewed = async (invoiceNumber: string, unitNumber: string) => {
    const inactive = await prisma.truck.create({ data: { companyId: relatedCompanyId, unitNumber, unitNumberNormalized: unitNumber, status: 'INACTIVE' } });
    extraTruckIds.push(inactive.id);
    const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber, unitNumber }), metadata(`pilot-${invoiceNumber}`), sourceId, authorizedContext);
    importedInvoiceIds.push(String(preview.id));
    const issue = (preview.issues as Array<{ id: string; code: string }>).find(({ code }) => code === 'UNMATCHED_TRUCK')!;
    await importer.resolveIssue(String(preview.id), issue.id, { action: 'MATCH_TRUCK', truckId: inactive.id, historicalInactiveAttribution: true }, authorizedContext);
    return { invoiceId: String(preview.id), truck: inactive };
  };

  const activated = await makeReviewed('910119', '8561');
  await prisma.truck.update({ where: { id: activated.truck.id }, data: { status: 'ACTIVE' } });
  await importer.postInvoice(activated.invoiceId, authorizedContext);
  assert.equal(await prisma.financialTransaction.count({ where: { reference: '910119' } }), 1);

  const unsupported = await makeReviewed('910120', '8562');
  await prisma.truck.update({ where: { id: unsupported.truck.id }, data: { status: 'MAINTENANCE' } });
  await assert.rejects(() => importer.postInvoice(unsupported.invoiceId, authorizedContext), /eligible Truck/);

  const moved = await makeReviewed('910121', '8563');
  await prisma.truck.update({ where: { id: moved.truck.id }, data: { companyId } });
  await assert.rejects(() => importer.postInvoice(moved.invoiceId, authorizedContext), /explicit reviewed historical attribution/);

  const ambiguous = await makeReviewed('910122', '8564');
  const duplicate = await prisma.truck.create({ data: { companyId, unitNumber: '8564', unitNumberNormalized: '8564', status: 'ACTIVE' } });
  extraTruckIds.push(duplicate.id);
  await assert.rejects(() => importer.postInvoice(ambiguous.invoiceId, authorizedContext), /became ambiguous/);
  await assert.rejects(() => prisma.truck.delete({ where: { id: ambiguous.truck.id } }));

  const revoked = await makeReviewed('910123', '8565');
  await prisma.companyMembership.delete({ where: { userId_companyId: { userId, companyId: relatedCompanyId } } });
  await assert.rejects(() => importer.postInvoice(revoked.invoiceId, authorizedContext), AuthorizationDeniedError);
  await prisma.companyMembership.create({ data: { userId, companyId: relatedCompanyId, role: 'OWNER' } });
  assert.equal(await prisma.financialTransaction.count({ where: { reference: { in: ['910120', '910121', '910122', '910123'] } } }), 0);
});

test('historical confirmation re-reads current user and membership authority', async () => {
  const inactive = await prisma.truck.create({ data: { companyId: relatedCompanyId, unitNumber: '8566', unitNumberNormalized: '8566', status: 'INACTIVE' } });
  extraTruckIds.push(inactive.id);
  const authorizedContext = context();
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910124', unitNumber: '8566' }), metadata('pilot-910124'), sourceId, authorizedContext);
  importedInvoiceIds.push(String(preview.id));
  const issue = (preview.issues as Array<{ id: string; code: string }>).find(({ code }) => code === 'UNMATCHED_TRUCK')!;
  await prisma.companyMembership.delete({ where: { userId_companyId: { userId, companyId: relatedCompanyId } } });
  await assert.rejects(() => importer.resolveIssue(String(preview.id), issue.id, { action: 'MATCH_TRUCK', truckId: inactive.id, historicalInactiveAttribution: true }, authorizedContext), AuthorizationDeniedError);
  await prisma.companyMembership.create({ data: { userId, companyId: relatedCompanyId, role: 'OWNER' } });
  assert.equal((await prisma.pilotFuelingEvent.findFirstOrThrow({ where: { invoiceId: String(preview.id) } })).truckId, null);
});

test('real-scale review changes only one inactive Truck attribution and creates no economics', async () => {
  const inactive = await prisma.truck.create({ data: { companyId: relatedCompanyId, unitNumber: '8560', unitNumberNormalized: '8560', status: 'INACTIVE' } });
  extraTruckIds.push(inactive.id);
  const detailRows = Array.from({ length: 258 }, (_, index) => {
    const eventIndex = index < 169 ? index : index - 169;
    return [
    '1111222233334444', '125', '0099', 'Dallas                  TX',
    `HIST-${eventIndex}`, `HIST-AUTH-${eventIndex}`, 'Driver One', '08/18', 123456 + eventIndex, index < 169 ? '020' : '033', 1, 395, index === 257 ? 433.55 : 395, 0, 0, 0, 0, 0, index === 257 ? 433.55 : 395, index === 257 ? 433.55 : 395,
    ];
  });
  const authorizedContext = context();
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910118', unitNumber: '8560', quantity: 162.49, unitPrice: 5.102, amount: 829.15, total: 102777.70, rowsBeforeTotal: detailRows }), metadata('pilot-910118'), sourceId, authorizedContext);
  importedInvoiceIds.push(String(preview.id));
  assert.deepEqual([preview.invoiceTotalMinor, preview.parsedTotalMinor, preview.differenceMinor], ['10277770', '10277770', '0']);
  assert.equal((preview.events as unknown[]).length, 170);
  assert.equal((preview.events as Array<{ productLines: unknown[] }>).reduce((count, event) => count + event.productLines.length, 0), 259);
  const issue = (preview.issues as Array<{ id: string; code: string }>).find(({ code }) => code === 'UNMATCHED_TRUCK');
  assert.ok(issue);
  const before = (preview.events as Array<{ id: string; truckId: string | null; truckMatchStatus: string }>).map(({ id, truckId, truckMatchStatus }) => ({ id, truckId, truckMatchStatus }));
  await importer.resolveIssue(String(preview.id), issue.id, { action: 'MATCH_TRUCK', truckId: inactive.id, historicalInactiveAttribution: true }, authorizedContext);
  const reviewed = await importer.getInvoice(String(preview.id), authorizedContext);
  const after = reviewed.events as Array<{ id: string; truckId: string | null; truckMatchStatus: string }>;
  assert.equal(after.filter(({ truckMatchStatus }) => truckMatchStatus === 'MANUALLY_MATCHED').length, 1);
  assert.equal(after.filter(({ truckMatchStatus }) => truckMatchStatus === 'MATCHED').length, 169);
  assert.equal(before.filter(({ truckId }) => truckId === null).length, 1);
  assert.equal(await prisma.financialTransaction.count({ where: { reference: '910118' } }), 0);
  assert.equal(await prisma.financialExpectation.count({ where: { reference: '910118' } }), 0);
});

test('active and inactive exact-unit candidates remain ambiguous and unauthorized inactive candidates do not leak', async () => {
  const activeDuplicate = await prisma.truck.create({ data: { companyId, unitNumber: '8557', unitNumberNormalized: '8557', status: 'ACTIVE' } });
  const inactiveDuplicate = await prisma.truck.create({ data: { companyId: relatedCompanyId, unitNumber: '8557', unitNumberNormalized: '8557', status: 'INACTIVE' } });
  const foreignInactive = await prisma.truck.create({ data: { companyId: foreignCompanyId, unitNumber: '8556', unitNumberNormalized: '8556', status: 'INACTIVE' } });
  extraTruckIds.push(activeDuplicate.id, inactiveDuplicate.id, foreignInactive.id);
  const ambiguous = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910116', unitNumber: '8557' }), metadata('pilot-910116'), sourceId, context());
  importedInvoiceIds.push(String(ambiguous.id));
  assert.equal((ambiguous.events as Array<{ truckMatchStatus: string }>)[0].truckMatchStatus, 'AMBIGUOUS');
  await prisma.truck.update({ where: { id: activeDuplicate.id }, data: { status: 'INACTIVE' } });
  const twoInactive = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910115', unitNumber: '8557' }), metadata('pilot-910115'), sourceId, context());
  importedInvoiceIds.push(String(twoInactive.id));
  assert.equal((twoInactive.events as Array<{ truckMatchStatus: string }>)[0].truckMatchStatus, 'AMBIGUOUS');
  const hidden = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910117', unitNumber: '8556' }), metadata('pilot-910117'), sourceId, context());
  importedInvoiceIds.push(String(hidden.id));
  assert.match((hidden.issues as Array<{ message: string }>).find(() => true)?.message ?? '', /did not match/);
});

test('Pilot matching spans authorized companies, preserves leading zeros, and posts to the truck company', async () => {
  const authorizedContext = context();
  await assert.rejects(() => importer.createImport(pilotXlsFixture({ invoiceNumber: '910020', unitNumber: ' 777 ' }), metadata('pilot-910020-denied'), sourceId, partialContext()), AuthorizationDeniedError);
  assert.equal(await prisma.pilotProviderInvoice.count({ where: { operatingGroupId: groupId, invoiceNumber: '910020' } }), 0);
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910020', unitNumber: ' 777 ' }), metadata('pilot-910020'), sourceId, authorizedContext);
  importedInvoiceIds.push(String(preview.id));
  const event = (preview.events as Array<{ truckId: string; truck: { company: { name: string } } }>)[0];
  assert.equal(event.truckId, relatedTruckId);
  assert.equal(event.truck.company.name, `Pilot related ${suffix}`);
  assert.ok(!(preview.issues as Array<{ code: string }>).some(({ code }) => code === 'AMBIGUOUS_TRUCK'));
  await importer.postInvoice(String(preview.id), authorizedContext);
  const transaction = await prisma.financialTransaction.findFirstOrThrow({ where: { reference: '910020' }, include: { allocations: true } });
  assert.equal(transaction.companyId, relatedCompanyId);
  assert.equal(transaction.allocations[0].companyId, relatedCompanyId);

  const leadingZero = await prisma.truck.create({ data: { companyId: relatedCompanyId, unitNumber: '0777', unitNumberNormalized: '0777' } });
  try {
    const unmatched = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910021', unitNumber: '00777' }), metadata('pilot-910021'), sourceId, authorizedContext);
    importedInvoiceIds.push(String(unmatched.id));
    assert.equal((unmatched.events as Array<{ truckId: string | null; truckMatchStatus: string }>)[0].truckId, null);
    assert.equal((unmatched.events as Array<{ truckMatchStatus: string }>)[0].truckMatchStatus, 'UNMATCHED');
  } finally {
    await prisma.truck.delete({ where: { id: leadingZero.id } });
  }
});

test('duplicate authorized units remain ambiguous until explicit company-aware selection', async () => {
  const duplicate = await prisma.truck.create({ data: { companyId, unitNumber: '777', unitNumberNormalized: '777' } });
  const authorizedContext = context();
  try {
    const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910022', unitNumber: '777' }), metadata('pilot-910022'), sourceId, authorizedContext);
    importedInvoiceIds.push(String(preview.id));
    assert.equal((preview.events as Array<{ truckMatchStatus: string }>)[0].truckMatchStatus, 'AMBIGUOUS');
    const issue = (preview.issues as Array<{ id: string; code: string }>).find(({ code }) => code === 'AMBIGUOUS_TRUCK');
    assert.ok(issue);
    const repeatedEvent = await prisma.pilotFuelingEvent.create({ data: {
      invoiceId: String(preview.id), eventKeyHash: hashForTest('repeat-event'), ticketHash: hashForTest('repeat-ticket'), authorizationHash: hashForTest('repeat-auth'),
      sourceUnitNumber: ' 777 ', transactionDate: new Date('2026-08-19T00:00:00.000Z'), truckMatchStatus: 'AMBIGUOUS',
    } });
    await prisma.pilotImportIssue.create({ data: { invoiceId: String(preview.id), eventId: repeatedEvent.id, code: 'AMBIGUOUS_TRUCK', message: 'Repeated unit requires review.' } });
    const concurrentResolution = await Promise.allSettled([
      importer.resolveIssue(String(preview.id), issue.id, { action: 'MATCH_TRUCK', truckId: relatedTruckId }, authorizedContext),
      importer.resolveIssue(String(preview.id), issue.id, { action: 'MATCH_TRUCK', truckId: relatedTruckId }, authorizedContext),
    ]);
    assert.equal(concurrentResolution.filter(({ status }) => status === 'fulfilled').length, 2);
    assert.equal(concurrentResolution.filter(({ status }) => status === 'rejected').length, 0);
    const resolved = await importer.getInvoice(String(preview.id), authorizedContext);
    const sameUnitEvents = resolved.events as Array<{ truckId: string; truckMatchStatus: string }>;
    assert.equal(sameUnitEvents.length, 2);
    assert.ok(sameUnitEvents.every((event) => event.truckId === relatedTruckId && event.truckMatchStatus === 'MANUALLY_MATCHED'));
    assert.equal((resolved.issues as Array<{ code: string; status: string }>).filter(({ code, status }) => code === 'AMBIGUOUS_TRUCK' && status === 'OPEN').length, 0);
    const manualAudit = await prisma.financialAuditEvent.findFirstOrThrow({ where: { pilotProviderInvoiceId: String(preview.id), action: 'PILOT_IMPORT_ISSUE_RESOLVED' }, orderBy: { occurredAt: 'desc' } });
    assert.deepEqual(manualAudit.metadata, { issueId: issue.id, action: 'MATCH_TRUCK', truckId: relatedTruckId, companyId: relatedCompanyId, sourceUnitNumber: '777', affectedEventCount: '2', sourceUnitNumberNormalized: '777', truckStatus: 'ACTIVE', historicalInactiveAttribution: false });
    const afterRematch = await importer.rematchTrucks(String(preview.id), authorizedContext);
    assert.ok((afterRematch.events as Array<{ truckId: string; truckMatchStatus: string }>).every((event) => event.truckId === relatedTruckId && event.truckMatchStatus === 'MANUALLY_MATCHED'));
  } finally {
    await prisma.truck.delete({ where: { id: duplicate.id } });
  }
});

test('safe rematch resolves only truck issues and preserves financial values and unrelated review', async () => {
  const authorizedContext = context();
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910023', unitNumber: 'REMATCH', productCode: '999' }), metadata('pilot-910023'), sourceId, authorizedContext);
  importedInvoiceIds.push(String(preview.id));
  const before = await prisma.pilotProviderInvoice.findUniqueOrThrow({ where: { id: String(preview.id) }, include: { productLines: true, adjustments: true } });
  const added = await prisma.truck.create({ data: { companyId: relatedCompanyId, unitNumber: 'rematch', unitNumberNormalized: 'REMATCH' } });
  extraTruckIds.push(added.id);
  const rematched = await importer.rematchTrucks(String(preview.id), authorizedContext);
  assert.equal((rematched.events as Array<{ truckId: string; truckMatchStatus: string }>)[0].truckId, added.id);
  assert.equal((rematched.events as Array<{ truckMatchStatus: string }>)[0].truckMatchStatus, 'MATCHED');
  assert.equal((rematched.issues as Array<{ code: string; status: string }>).find(({ code }) => code === 'UNMATCHED_TRUCK')?.status, 'RESOLVED');
  assert.ok((rematched.issues as Array<{ code: string; status: string }>).some(({ code, status }) => code === 'MISSING_CATEGORY' && status === 'OPEN'));
  assert.equal(rematched.status, 'NEEDS_REVIEW');
  const after = await prisma.pilotProviderInvoice.findUniqueOrThrow({ where: { id: String(preview.id) }, include: { productLines: true, adjustments: true } });
  assert.deepEqual(
    { invoice: after.invoiceTotalMinor, parsed: after.parsedTotalMinor, difference: after.differenceMinor, lines: after.productLines.map(({ amountMinor, quantity, unitPrice, categoryId }) => ({ amountMinor, quantity: quantity.toString(), unitPrice: unitPrice.toString(), categoryId })), adjustments: after.adjustments },
    { invoice: before.invoiceTotalMinor, parsed: before.parsedTotalMinor, difference: before.differenceMinor, lines: before.productLines.map(({ amountMinor, quantity, unitPrice, categoryId }) => ({ amountMinor, quantity: quantity.toString(), unitPrice: unitPrice.toString(), categoryId })), adjustments: before.adjustments },
  );
  assert.equal(await prisma.financialAuditEvent.count({ where: { pilotProviderInvoiceId: String(preview.id), action: 'PILOT_TRUCK_MATCHING_RERUN' } }), 1);
});

test('adding an OWNER-authorized company expands a fresh Pilot rematch without changing invoice financial values', async () => {
  const candidateCompany = await prisma.company.create({ data: { name: `Pilot candidate ${suffix}` } });
  extraCompanyIds.push(candidateCompany.id);
  await prisma.companyMembership.create({ data: { companyId: candidateCompany.id, userId, role: 'OWNER' } });
  const candidateTruck = await prisma.truck.create({ data: { companyId: candidateCompany.id, unitNumber: 'GROUPADD', unitNumberNormalized: 'GROUPADD' } });
  extraTruckIds.push(candidateTruck.id);

  const preview = await importer.createImport(
    pilotXlsFixture({ invoiceNumber: '910030', unitNumber: 'GROUPADD', productCode: '999' }),
    metadata('pilot-910030'),
    sourceId,
    context(),
  );
  importedInvoiceIds.push(String(preview.id));
  assert.equal((preview.events as Array<{ truckId: string | null }>)[0].truckId, null);
  const before = await prisma.pilotProviderInvoice.findUniqueOrThrow({
    where: { id: String(preview.id) },
    select: { invoiceTotalMinor: true, parsedTotalMinor: true, differenceMinor: true },
  });

  const staleContext = context();
  await groupCompanies.add(candidateCompany.id, staleContext);
  linkedExtraCompanyIds.push(candidateCompany.id);
  await assert.rejects(() => importer.rematchTrucks(String(preview.id), staleContext), AuthorizationDeniedError);
  const unchangedUntilRematch = await prisma.pilotFuelingEvent.findFirstOrThrow({ where: { invoiceId: String(preview.id) } });
  assert.equal(unchangedUntilRematch.truckId, null);
  assert.equal(context().activeCompanyId, companyId);
  assert.equal((await prisma.financialSource.findUniqueOrThrow({ where: { id: sourceId } })).companyId, companyId);
  const expandedContext = context();
  const rematched = await importer.rematchTrucks(String(preview.id), expandedContext);
  assert.equal((rematched.events as Array<{ truckId: string | null }>)[0].truckId, candidateTruck.id);
  assert.ok((rematched.issues as Array<{ code: string; status: string }>).some(({ code, status }) => code === 'MISSING_CATEGORY' && status === 'OPEN'));
  const after = await prisma.pilotProviderInvoice.findUniqueOrThrow({
    where: { id: String(preview.id) },
    select: { invoiceTotalMinor: true, parsedTotalMinor: true, differenceMinor: true },
  });
  assert.deepEqual(after, before);
  assert.equal(await prisma.financialTransaction.count({ where: { reference: '910030' } }), 0);
});

test('group expansion makes a previously unique automatic unit match ambiguous on explicit rematch', async () => {
  const candidateCompany = await prisma.company.create({ data: { name: `Pilot duplicate expansion ${suffix}` } });
  extraCompanyIds.push(candidateCompany.id);
  await prisma.companyMembership.create({ data: { companyId: candidateCompany.id, userId, role: 'OWNER' } });
  const [activeCompanyTruck, candidateTruck] = await Promise.all([
    prisma.truck.create({ data: { companyId, unitNumber: 'EXPAND123', unitNumberNormalized: 'EXPAND123' } }),
    prisma.truck.create({ data: { companyId: candidateCompany.id, unitNumber: 'EXPAND123', unitNumberNormalized: 'EXPAND123' } }),
  ]);
  extraTruckIds.push(activeCompanyTruck.id, candidateTruck.id);
  const preview = await importer.createImport(
    pilotXlsFixture({ invoiceNumber: '910031', unitNumber: 'EXPAND123', productCode: '999' }),
    metadata('pilot-910031'),
    sourceId,
    context(),
  );
  importedInvoiceIds.push(String(preview.id));
  assert.equal((preview.events as Array<{ truckId: string | null; truckMatchStatus: string }>)[0].truckId, activeCompanyTruck.id);
  assert.equal((preview.events as Array<{ truckMatchStatus: string }>)[0].truckMatchStatus, 'MATCHED');

  const staleContext = context();
  await groupCompanies.add(candidateCompany.id, staleContext);
  linkedExtraCompanyIds.push(candidateCompany.id);
  await assert.rejects(() => importer.rematchTrucks(String(preview.id), staleContext), AuthorizationDeniedError);
  const rematched = await importer.rematchTrucks(String(preview.id), context());
  assert.equal((rematched.events as Array<{ truckId: string | null; truckMatchStatus: string }>)[0].truckId, null);
  assert.equal((rematched.events as Array<{ truckMatchStatus: string }>)[0].truckMatchStatus, 'AMBIGUOUS');
  assert.ok((rematched.issues as Array<{ code: string; status: string }>).some(({ code, status }) => code === 'AMBIGUOUS_TRUCK' && status === 'OPEN'));
  assert.equal(await prisma.financialTransaction.count({ where: { reference: '910031' } }), 0);
});

test('posting revalidates the matched truck against the current authorized company scope', async () => {
  const preview = await importer.createImport(
    pilotXlsFixture({ invoiceNumber: '910024', unitNumber: '777' }),
    metadata('pilot-910024'), sourceId, context(),
  );
  importedInvoiceIds.push(String(preview.id));
  assert.equal(preview.status, 'READY_TO_POST');
  await assert.rejects(() => importer.postInvoice(String(preview.id), partialContext()), AuthorizationDeniedError);
  assert.equal(await prisma.financialTransaction.count({ where: { reference: '910024' } }), 0);
  const posted = await importer.postInvoice(String(preview.id), context());
  assert.equal(posted.status, 'POSTED');
  const transaction = await prisma.financialTransaction.findFirstOrThrow({ where: { reference: '910024' }, include: { allocations: true } });
  assert.equal(transaction.companyId, relatedCompanyId);
  assert.equal(transaction.amountMinor, BigInt(10100));
  assert.equal(transaction.allocations[0].truckId, relatedTruckId);
});

test('posting re-reads membership, Truck status, and canonical company inside the transaction', async () => {
  const authorizedContext = context();
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910025', unitNumber: '777' }), metadata('pilot-910025'), sourceId, authorizedContext);
  importedInvoiceIds.push(String(preview.id));

  await prisma.companyMembership.delete({ where: { userId_companyId: { userId, companyId: relatedCompanyId } } });
  await assert.rejects(() => importer.postInvoice(String(preview.id), authorizedContext), AuthorizationDeniedError);
  await prisma.companyMembership.create({ data: { userId, companyId: relatedCompanyId, role: 'OWNER' } });

  await prisma.truck.update({ where: { id: relatedTruckId }, data: { status: 'INACTIVE' } });
  await assert.rejects(() => importer.postInvoice(String(preview.id), authorizedContext), /explicit reviewed historical attribution/);
  await prisma.truck.update({ where: { id: relatedTruckId }, data: { status: 'ACTIVE' } });

  await prisma.truck.update({ where: { id: foreignTruckId }, data: { unitNumber: `foreign-${suffix}`, unitNumberNormalized: `FOREIGN-${suffix}`.toUpperCase() } });
  await prisma.truck.update({ where: { id: relatedTruckId }, data: { companyId: foreignCompanyId } });
  await assert.rejects(() => importer.postInvoice(String(preview.id), authorizedContext), /current authorized Accounting company scope/);
  await prisma.truck.update({ where: { id: relatedTruckId }, data: { companyId: relatedCompanyId } });
  await prisma.truck.update({ where: { id: foreignTruckId }, data: { unitNumber: '777', unitNumberNormalized: '777' } });

  assert.equal(await prisma.financialTransaction.count({ where: { reference: '910025' } }), 0);
});

test('cross-company event posting counts each expense once at group level', async () => {
  const authorizedContext = context();
  const secondEvent = ['1111222233334444', '777', '0099', 'Austin                  TX', 'TICKET-2', 'AUTH-2', 'Driver Two', '08/19', 123457, '020', 5, 10, 200, 0, 0, 0, 0, 0, 200, 200];
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910026', amount: 100, total: 300, rowsBeforeTotal: [secondEvent] }), metadata('pilot-910026'), sourceId, authorizedContext);
  importedInvoiceIds.push(String(preview.id));
  await importer.postInvoice(String(preview.id), authorizedContext);
  const transactions = await prisma.financialTransaction.findMany({ where: { reference: '910026' }, include: { allocations: true } });
  assert.equal(transactions.length, 2);
  assert.equal(transactions.reduce((sum, transaction) => sum + transaction.amountMinor, BigInt(0)), BigInt(30000));
  assert.deepEqual(new Set(transactions.map(({ companyId }) => companyId)), new Set([companyId, relatedCompanyId]));
  assert.equal(transactions.reduce((sum, transaction) => sum + transaction.allocations.reduce((allocationSum, allocation) => allocationSum + allocation.amountMinor, BigInt(0)), BigInt(0)), BigInt(30000));
});

test('explicit v1 to v2 reparse rebuilds review state without creating economics and is idempotent', async () => {
  const bytes = pilotXlsFixture({ invoiceNumber: '910011', productCode: '999', unitNumber: 'missing' });
  const preview = await reparseImporter.createImport(bytes, await storedMetadata('pilot-910011', bytes), sourceId, context());
  const invoiceId = String(preview.id); importedInvoiceIds.push(invoiceId);
  await markAsFaultyV1(invoiceId, BigInt(519527057));

  const [first, concurrent] = await Promise.all([
    reparseImporter.reparseInvoice(invoiceId, context()),
    reparseImporter.reparseInvoice(invoiceId, context()),
  ]);
  for (const reparsed of [first, concurrent]) {
    assert.equal(reparsed.parseVersion, 'pilot-biff-v2');
    assert.equal(reparsed.status, 'NEEDS_REVIEW');
    assert.equal(reparsed.invoiceTotalMinor, '10100');
    assert.equal(reparsed.parsedTotalMinor, '10100');
    assert.equal(reparsed.differenceMinor, '0');
    assert.equal(reparsed.canReparse, false);
  }
  const codes = (first.issues as Array<{ code: string }>).map(({ code }) => code);
  assert.ok(codes.includes('UNMATCHED_TRUCK'));
  assert.ok(codes.includes('UNKNOWN_PRODUCT'));
  assert.ok(codes.includes('MISSING_CATEGORY'));
  assert.equal(codes.includes('AMOUNT_MISMATCH'), false);
  assert.equal(await prisma.financialTransaction.count({ where: { OR: [{ pilotFuelingEvent: { invoiceId } }, { pilotInvoiceAdjustment: { invoiceId } }] } }), 0);
  assert.equal(await prisma.financialAllocation.count({ where: { OR: [{ pilotProductLine: { invoiceId } }, { pilotAdjustment: { invoiceId } }] } }), 0);
  assert.equal(await prisma.financialExpectation.count({ where: { pilotProviderInvoice: { id: invoiceId } } }), 0);
  assert.equal(await prisma.financialAuditEvent.count({ where: { pilotProviderInvoiceId: invoiceId, action: 'PILOT_INVOICE_POSTED' } }), 0);
  const reparseEvents = await prisma.financialAuditEvent.findMany({ where: { pilotProviderInvoiceId: invoiceId, action: 'PILOT_INVOICE_REPARSED' } });
  assert.equal(reparseEvents.length, 1);
  assert.deepEqual(reparseEvents[0].before, {
    parseVersion: 'pilot-biff-v1', status: 'NEEDS_REVIEW', invoiceTotalMinor: '10100', parsedTotalMinor: '519527057', differenceMinor: '519516957',
    issueCounts: { 'OPEN:AMOUNT_MISMATCH': 1, 'OPEN:MISSING_CATEGORY': 1, 'OPEN:UNMATCHED_TRUCK': 1, 'OPEN:UNKNOWN_PRODUCT': 1 },
    eventCount: 1, productLineCount: 1, adjustmentCount: 0,
  });
  assert.equal((reparseEvents[0].after as { parseVersion: string }).parseVersion, 'pilot-biff-v2');
  assert.equal(await prisma.financialAuditEvent.count({ where: { pilotProviderInvoiceId: invoiceId, action: 'PILOT_INVOICE_PARSED' } }), 1);

  await reparseImporter.reparseInvoice(invoiceId, context());
  assert.equal(await prisma.financialAuditEvent.count({ where: { pilotProviderInvoiceId: invoiceId, action: 'PILOT_INVOICE_REPARSED' } }), 1);
});

test('reparse preserves valid manual truck and category resolutions', async () => {
  const bytes = pilotXlsFixture({ invoiceNumber: '910012', productCode: '999', unitNumber: 'missing' });
  const preview = await reparseImporter.createImport(bytes, await storedMetadata('pilot-910012', bytes), sourceId, context());
  const invoiceId = String(preview.id); importedInvoiceIds.push(invoiceId);
  const issues = preview.issues as Array<{ id: string; code: string }>;
  const exactTruck = await prisma.truck.create({ data: { companyId, unitNumber: 'missing', unitNumberNormalized: 'MISSING' } });
  extraTruckIds.push(exactTruck.id);
  await reparseImporter.resolveIssue(invoiceId, issues.find(({ code }) => code === 'UNMATCHED_TRUCK')!.id, { action: 'MATCH_TRUCK', truckId: exactTruck.id }, context());
  await reparseImporter.resolveIssue(invoiceId, issues.find(({ code }) => code === 'MISSING_CATEGORY')!.id, { action: 'SET_CATEGORY', categoryId: fuelCategoryId }, context());
  await markAsFaultyV1(invoiceId, BigInt(20200));
  const reparsed = await reparseImporter.reparseInvoice(invoiceId, context());
  assert.equal((reparsed.events as Array<{ truckId: string; truckMatchStatus: string }>)[0].truckId, exactTruck.id);
  assert.equal((reparsed.events as Array<{ truckId: string; truckMatchStatus: string }>)[0].truckMatchStatus, 'MANUALLY_MATCHED');
  assert.equal((reparsed.events as Array<{ productLines: Array<{ category: { id: string } }> }>)[0].productLines[0].category.id, fuelCategoryId);
  const remainingCodes = (reparsed.issues as Array<{ code: string }>).map(({ code }) => code);
  assert.equal(remainingCodes.includes('UNMATCHED_TRUCK'), false);
  assert.equal(remainingCodes.includes('MISSING_CATEGORY'), false);
  assert.ok(remainingCodes.includes('UNKNOWN_PRODUCT'));
  assert.equal(remainingCodes.includes('AMOUNT_MISMATCH'), false);
});

test('posted Pilot invoices reject reparse without changing canonical economics', async () => {
  const bytes = pilotXlsFixture({ invoiceNumber: '910013' });
  const preview = await reparseImporter.createImport(bytes, await storedMetadata('pilot-910013', bytes), sourceId, context());
  const invoiceId = String(preview.id); importedInvoiceIds.push(invoiceId);
  await reparseImporter.postInvoice(invoiceId, context());
  const transactionCount = await prisma.financialTransaction.count({ where: { reference: '910013', operatingGroupId: groupId } });
  await assert.rejects(() => reparseImporter.reparseInvoice(invoiceId, context()), /cannot be reparsed/);
  assert.equal(await prisma.financialTransaction.count({ where: { reference: '910013', operatingGroupId: groupId } }), transactionCount);
  assert.equal(await prisma.financialAuditEvent.count({ where: { pilotProviderInvoiceId: invoiceId, action: 'PILOT_INVOICE_REPARSED' } }), 0);
});

test('wrong and malformed stored sources fail before modifying the existing preview', async () => {
  for (const [invoiceNumber, replacement] of [
    ['910014', pilotXlsFixture({ invoiceNumber: '999999' })],
    ['910015', new TextEncoder().encode('not a Pilot XLS')],
  ] as const) {
    const bytes = pilotXlsFixture({ invoiceNumber });
    const preview = await reparseImporter.createImport(bytes, await storedMetadata(`pilot-${invoiceNumber}`, bytes), sourceId, context());
    const invoiceId = String(preview.id); importedInvoiceIds.push(invoiceId);
    await markAsFaultyV1(invoiceId, BigInt(20200));
    const document = await prisma.pilotInvoiceDocument.findFirstOrThrow({ where: { invoiceId, role: 'STRUCTURED_SOURCE' }, include: { statement: true } });
    statementStorage.files.set(document.statement.storageKey, replacement);
    await prisma.financialStatement.update({ where: { id: document.statementId }, data: { checksumSha256: createHash('sha256').update(replacement).digest('hex') } });
    await assert.rejects(() => reparseImporter.reparseInvoice(invoiceId, context()));
    const unchanged = await prisma.pilotProviderInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(unchanged.parseVersion, 'pilot-biff-v1');
    assert.equal(unchanged.parsedTotalMinor, BigInt(20200));
    assert.equal(await prisma.pilotImportIssue.count({ where: { invoiceId, code: 'AMOUNT_MISMATCH' } }), 1);
    assert.equal(await prisma.financialAuditEvent.count({ where: { pilotProviderInvoiceId: invoiceId, action: 'PILOT_INVOICE_REPARSED' } }), 0);
  }
});

test('late reparse failure rolls back preview replacement and audit atomically', async () => {
  const bytes = pilotXlsFixture({ invoiceNumber: '910016' });
  const preview = await reparseImporter.createImport(bytes, await storedMetadata('pilot-910016', bytes), sourceId, context());
  const invoiceId = String(preview.id); importedInvoiceIds.push(invoiceId);
  await markAsFaultyV1(invoiceId, BigInt(20200));
  const beforeLineIds = (await prisma.pilotFuelProductLine.findMany({ where: { invoiceId }, select: { id: true }, orderBy: { id: 'asc' } })).map(({ id }) => id);
  const trigger = `reject_pilot_reparse_${suffix.replaceAll('-', '_')}`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger AS $$ BEGIN IF NEW.action = 'PILOT_INVOICE_REPARSED' THEN RAISE EXCEPTION 'forced reparse rollback'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON "FinancialAuditEvent" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
  try {
    await assert.rejects(() => reparseImporter.reparseInvoice(invoiceId, context()), /forced reparse rollback/);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON "FinancialAuditEvent"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`);
  }
  const unchanged = await prisma.pilotProviderInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  assert.equal(unchanged.parseVersion, 'pilot-biff-v1');
  assert.equal(unchanged.parsedTotalMinor, BigInt(20200));
  assert.deepEqual((await prisma.pilotFuelProductLine.findMany({ where: { invoiceId }, select: { id: true }, orderBy: { id: 'asc' } })).map(({ id }) => id), beforeLineIds);
  assert.equal(await prisma.pilotImportIssue.count({ where: { invoiceId, code: 'AMOUNT_MISMATCH' } }), 1);
  assert.equal(await prisma.financialAuditEvent.count({ where: { pilotProviderInvoiceId: invoiceId, action: 'PILOT_INVOICE_REPARSED' } }), 0);
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

test('summary rows never become economics or double-count the invoice', async () => {
  const preview = await importer.createImport(pilotXlsFixture({
    invoiceNumber: '910004', amount: 100, total: 100,
    rowsBeforeTotal: [['020 Subtotal', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 100, '']],
  }), metadata('pilot-910004'), sourceId, context());
  importedInvoiceIds.push(String(preview.id));
  assert.equal(preview.status, 'READY_TO_POST');
  assert.equal((preview.events as unknown[]).length, 1);
  assert.equal((preview.adjustments as unknown[]).length, 0);
  await importer.postInvoice(String(preview.id), context());
  const transactions = await prisma.financialTransaction.findMany({ where: { operatingGroupId: groupId, reference: '910004' } });
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amountMinor, BigInt(10000));
});

test('020, 033, and 140 lines aggregate once into one exact event expense', async () => {
  const detail = (productCode: string, amount: number) => ['1111222233334444', '125', '0099', 'Dallas                  TX', 'TICKET-1', 'AUTH-1', 'Driver One', '08/18', 123456, productCode, 1, amount, amount, 0, 0, 0, 0, 0, amount, amount];
  const preview = await importer.createImport(pilotXlsFixture({
    invoiceNumber: '910008', amount: 800, total: 880,
    rowsBeforeTotal: [detail('033', 50), detail('140', 30)],
  }), metadata('pilot-910008'), sourceId, context());
  importedInvoiceIds.push(String(preview.id));
  await importer.postInvoice(String(preview.id), context());
  const transaction = await prisma.financialTransaction.findFirstOrThrow({ where: { operatingGroupId: groupId, reference: '910008' }, include: { allocations: true } });
  assert.equal(transaction.amountMinor, BigInt(88000));
  assert.equal(transaction.allocations.length, 3);
  assert.equal(transaction.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, BigInt(0)), BigInt(88000));
});

test('unknown amount-bearing structural rows fail closed and cannot be categorized into economics', async () => {
  const preview = await importer.createImport(pilotXlsFixture({
    invoiceNumber: '910005',
    rowsBeforeTotal: [['Unsupported provider control', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 25, '']],
  }), metadata('pilot-910005'), sourceId, context());
  importedInvoiceIds.push(String(preview.id));
  assert.equal(preview.status, 'NEEDS_REVIEW');
  assert.equal((preview.adjustments as unknown[]).length, 0);
  assert.ok((preview.issues as Array<{ code: string }>).some((issue) => issue.code === 'INVALID_STRUCTURE'));
  await assert.rejects(() => importer.postInvoice(String(preview.id), context()), FinancialConflictError);
  assert.equal(await prisma.financialTransaction.count({ where: { operatingGroupId: groupId, reference: '910005' } }), 0);
});

test('posted Pilot transactions are protected from generic transaction mutation', async () => {
  const transactions = await prisma.financialTransaction.findMany({ where: { operatingGroupId: groupId, reference: '910001' }, include: { pilotFuelingEvent: true, pilotInvoiceAdjustment: true } });
  assert.equal(transactions.length, 2);
  for (const transaction of transactions) {
    await assert.rejects(() => control.voidTransaction(transaction.id, context()), /posted provider invoice/);
    await assert.rejects(() => control.deleteTransaction(transaction.id, context()), /posted provider invoice/);
    await assert.rejects(() => control.replaceAllocations(transaction.id, [{ amount: '1.00', categoryId: fuelCategoryId }], context()), /posted provider invoice/);
  }
  assert.ok(transactions.some((transaction) => transaction.pilotFuelingEvent));
  assert.ok(transactions.some((transaction) => transaction.pilotInvoiceAdjustment));
  assert.equal(await prisma.financialTransaction.count({ where: { operatingGroupId: groupId, reference: '910001', status: 'POSTED' } }), 2);
});

test('posting revalidates active same-group categories inside the authoritative transaction', async () => {
  const inactive = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910006' }), metadata('pilot-910006'), sourceId, context());
  importedInvoiceIds.push(String(inactive.id));
  await control.updateCategory(fuelCategoryId, { isActive: false }, context());
  try {
    await assert.rejects(() => importer.postInvoice(String(inactive.id), context()), /active Direct Expense/);
  } finally {
    await control.updateCategory(fuelCategoryId, { isActive: true }, context());
  }

  const stale = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910007' }), metadata('pilot-910007'), sourceId, context());
  importedInvoiceIds.push(String(stale.id));
  const foreignGroup = await prisma.operatingGroup.create({ data: { name: `Foreign category group ${suffix}` } });
  const foreignCategory = await prisma.financialCategory.create({ data: { operatingGroupId: foreignGroup.id, name: `Foreign fuel ${suffix}`, type: 'DIRECT_EXPENSE' } });
  try {
    await prisma.pilotFuelProductLine.updateMany({ where: { invoiceId: String(stale.id) }, data: { categoryId: foreignCategory.id } });
    await assert.rejects(() => importer.postInvoice(String(stale.id), context()), /active Direct Expense/);
  } finally {
    await prisma.pilotFuelProductLine.updateMany({ where: { invoiceId: String(stale.id) }, data: { categoryId: fuelCategoryId } });
    await prisma.financialCategory.delete({ where: { id: foreignCategory.id } });
    await prisma.operatingGroup.delete({ where: { id: foreignGroup.id } });
  }
});

test('concurrent Post calls produce one economic result and one ExpectedMoney record', async () => {
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910009' }), metadata('pilot-910009'), sourceId, context());
  importedInvoiceIds.push(String(preview.id));
  await Promise.all([importer.postInvoice(String(preview.id), context()), importer.postInvoice(String(preview.id), context())]);
  assert.equal(await prisma.financialTransaction.count({ where: { operatingGroupId: groupId, reference: '910009' } }), 1);
  assert.equal(await prisma.financialExpectation.count({ where: { operatingGroupId: groupId, reference: '910009' } }), 1);
});

test('a late posting failure rolls back transactions, allocations, evidence, and ExpectedMoney atomically', async () => {
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910010' }), metadata('pilot-910010'), sourceId, context());
  importedInvoiceIds.push(String(preview.id));
  await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_pilot_expectation_${suffix.replaceAll('-', '_')}() RETURNS trigger AS $$ BEGIN IF NEW.reference = '910010' THEN RAISE EXCEPTION 'forced Pilot rollback'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_pilot_expectation_${suffix.replaceAll('-', '_')} BEFORE INSERT ON "FinancialExpectation" FOR EACH ROW EXECUTE FUNCTION reject_pilot_expectation_${suffix.replaceAll('-', '_')}()`);
  try {
    await assert.rejects(() => importer.postInvoice(String(preview.id), context()), /forced Pilot rollback/);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER reject_pilot_expectation_${suffix.replaceAll('-', '_')} ON "FinancialExpectation"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION reject_pilot_expectation_${suffix.replaceAll('-', '_')}()`);
  }
  assert.equal(await prisma.financialTransaction.count({ where: { operatingGroupId: groupId, reference: '910010' } }), 0);
  assert.equal(await prisma.financialExpectation.count({ where: { operatingGroupId: groupId, reference: '910010' } }), 0);
  assert.equal(await prisma.financialAllocation.count({ where: { transaction: { reference: '910010' } } }), 0);
  assert.equal(await prisma.financialTransactionEvidence.count({ where: { transaction: { reference: '910010' } } }), 0);
  assert.equal((await prisma.pilotProviderInvoice.findUniqueOrThrow({ where: { id: String(preview.id) } })).status, 'READY_TO_POST');
});

test('manual truck resolution rejects cross-company canonical references', async () => {
  const invoice = await importer.getInvoice(importedInvoiceIds[1], context());
  const issue = (invoice.issues as Array<{ id: string; code: string }>).find((row) => row.code === 'UNMATCHED_TRUCK');
  assert.ok(issue);
  await assert.rejects(() => importer.resolveIssue(String(invoice.id), issue.id, { action: 'MATCH_TRUCK', truckId: foreignTruckId }, context()), AuthorizationDeniedError);
  const unchanged = await importer.getInvoice(String(invoice.id), context());
  assert.equal((unchanged.events as Array<{ truckId: string | null }>)[0].truckId, null);
});

test('group product mappings apply to future and existing unposted invoices without overwriting manual review', async () => {
  const alternate = await prisma.financialCategory.create({ data: { operatingGroupId: groupId, name: `Reefer alternate ${suffix}`, type: 'DIRECT_EXPENSE' } });
  await prisma.pilotProductMapping.deleteMany({ where: { operatingGroupId: groupId, providerAccountHash, productCode: '033' } });
  const existing = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910098', productCode: '033' }), metadata('pilot-910098'), sourceId, context());
  importedInvoiceIds.push(String(existing.id));
  const missing = (existing.issues as Array<{ id: string; code: string }>).find(({ code }) => code === 'MISSING_CATEGORY');
  assert.ok(missing);
  await assert.rejects(() => importer.resolveIssue(String(existing.id), missing.id, { action: 'SET_CATEGORY', categoryId: adjustmentCategoryId }, context()), FinancialValidationError);
  await importer.resolveIssue(String(existing.id), missing.id, { action: 'SET_CATEGORY', categoryId: alternate.id }, context());
  await productMappings.save('033', fuelCategoryId, context());
  const noOpAuditBefore = await prisma.financialAuditEvent.count({ where: { pilotProviderInvoiceId: String(existing.id), action: 'PILOT_PRODUCT_MAPPINGS_APPLIED' } });
  const reapplied = await importer.applyProductMappings(String(existing.id), context());
  const manuallyReviewedLine = (reapplied.events as Array<{ productLines: Array<{ categoryId: string }> }>)[0].productLines[0];
  assert.equal(manuallyReviewedLine.categoryId, alternate.id);
  assert.equal(await prisma.financialAuditEvent.count({ where: { pilotProviderInvoiceId: String(existing.id), action: 'PILOT_PRODUCT_MAPPINGS_APPLIED' } }), noOpAuditBefore);

  const future = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910099', productCode: '033', additionalProductCode: '033', total: 121 }), metadata('pilot-910099'), sourceId, context());
  importedInvoiceIds.push(String(future.id));
  const lines = (future.events as Array<{ productLines: Array<{ categoryId: string; productType: string }> }>)[0].productLines;
  assert.equal(lines.length, 2);
  assert.ok(lines.every(({ categoryId, productType }) => categoryId === fuelCategoryId && productType === 'REEFER_FUEL'));
  assert.equal((future.issues as Array<{ code: string }>).some(({ code }) => code === 'MISSING_CATEGORY'), false);
  const totalsBefore = [future.invoiceTotalMinor, future.parsedTotalMinor, future.differenceMinor];
  const applied = await importer.applyProductMappings(String(future.id), context());
  assert.deepEqual([applied.invoiceTotalMinor, applied.parsedTotalMinor, applied.differenceMinor], totalsBefore);
  assert.equal(await prisma.financialAuditEvent.count({ where: { pilotProviderInvoiceId: String(future.id), action: 'PILOT_PRODUCT_MAPPINGS_APPLIED' } }), 0);
  await importer.postInvoice(String(future.id), context());
  await assert.rejects(() => importer.applyProductMappings(String(future.id), context()), /cannot be reclassified/);
  await productMappings.save('033', alternate.id, context());
  const postedAllocations = await prisma.financialAllocation.findMany({ where: { transaction: { operatingGroupId: groupId, reference: '910099' } }, select: { categoryId: true } });
  assert.ok(postedAllocations.length > 0 && postedAllocations.every(({ categoryId }) => categoryId === fuelCategoryId));
  const later = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910097', productCode: '033' }), metadata('pilot-910097'), sourceId, context());
  importedInvoiceIds.push(String(later.id));
  assert.equal((later.events as Array<{ productLines: Array<{ categoryId: string }> }>)[0].productLines[0].categoryId, alternate.id);

  await productMappings.save('020', alternate.id, context());
  const exactWins = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910096', productCode: '020' }), metadata('pilot-910096'), sourceId, context());
  importedInvoiceIds.push(String(exactWins.id));
  assert.equal((exactWins.events as Array<{ productLines: Array<{ categoryId: string }> }>)[0].productLines[0].categoryId, fuelCategoryId);
  assert.equal(await prisma.pilotProductMapping.count({ where: { operatingGroupId: groupId, providerAccountHash: PILOT_GROUP_MAPPING_ACCOUNT, productCode: '033' } }), 1);
});

test('174-line real-scale mapping refresh preserves exact invoice, source, truck, and economic invariants', async () => {
  await prisma.pilotProductMapping.deleteMany({ where: { operatingGroupId: groupId, productCode: { in: ['020', '033', '140'] } } });
  const detailRows = Array.from({ length: 173 }, (_, index) => {
    const productCode = ['020', '033', '140'][index % 3];
    return ['1111222233334444', '125', '0099', 'Dallas                  TX', `SCALE-${index}`, `AUTH-${index}`, 'Driver One', '08/18', 123456 + index, productCode, 1, 300, 300, 0, 0, 0, 0, 0, 300, 300];
  });
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '788363802', amount: 7630.73, total: 59530.73, rowsBeforeTotal: detailRows }), metadata('pilot-real-scale'), sourceId, context());
  importedInvoiceIds.push(String(preview.id));
  assert.equal(preview.invoiceTotalMinor, '5953073');
  assert.equal(preview.parsedTotalMinor, '5953073');
  assert.equal(preview.differenceMinor, '0');
  assert.equal((preview.issues as Array<{ code: string }>).filter(({ code }) => code === 'MISSING_CATEGORY').length, 174);
  const eventStateBefore = (preview.events as Array<{ id: string; truckId: string | null; truckMatchStatus: string }>).map(({ id, truckId, truckMatchStatus }) => ({ id, truckId, truckMatchStatus }));
  const documentBefore = await prisma.pilotInvoiceDocument.findFirstOrThrow({ where: { invoiceId: String(preview.id) }, include: { statement: { select: { checksumSha256: true } } } });
  const economicsBefore = await prisma.financialTransaction.count({ where: { operatingGroupId: groupId, reference: '788363802' } });

  await Promise.all([productMappings.save('020', fuelCategoryId, context()), productMappings.save('033', fuelCategoryId, context()), productMappings.save('140', fuelCategoryId, context())]);
  const refreshed = await importer.applyProductMappings(String(preview.id), context());
  assert.deepEqual([refreshed.invoiceTotalMinor, refreshed.parsedTotalMinor, refreshed.differenceMinor], ['5953073', '5953073', '0']);
  assert.equal((refreshed.issues as Array<{ code: string; status: string }>).filter(({ code, status }) => code === 'MISSING_CATEGORY' && status === 'OPEN').length, 0);
  assert.deepEqual((refreshed.events as Array<{ id: string; truckId: string | null; truckMatchStatus: string }>).map(({ id, truckId, truckMatchStatus }) => ({ id, truckId, truckMatchStatus })), eventStateBefore);
  assert.equal((await prisma.pilotInvoiceDocument.findUniqueOrThrow({ where: { id: documentBefore.id }, include: { statement: { select: { checksumSha256: true } } } })).statement.checksumSha256, documentBefore.statement.checksumSha256);
  assert.equal(await prisma.financialTransaction.count({ where: { operatingGroupId: groupId, reference: '788363802' } }), economicsBefore);
  assert.equal(await prisma.financialExpectation.count({ where: { operatingGroupId: groupId, reference: '788363802' } }), 0);
});

test('generic matchExpectation requires original and current whole-Pilot authority while manual expectations remain usable', async () => {
  const originalContext = context();
  const links = await prisma.operatingGroupCompany.findMany({ where: { operatingGroupId: groupId } });
  assert.deepEqual(new Set(originalContext.companyIds), new Set(links.map(({ companyId }) => companyId)));
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '961701', amount: 137, total: 137, billingDate: '09/18/26', dueDate: '09/25/26', transactionDate: '09/11' }), metadata(`synthetic-generic-expectation-${suffix}`), sourceId, originalContext);
  const invoiceId = String(preview.id); importedInvoiceIds.push(invoiceId);
  assert.equal((await importer.postInvoice(invoiceId, originalContext)).status, 'POSTED');
  const expectation = await prisma.financialExpectation.findFirstOrThrow({ where: { operatingGroupId: groupId, pilotProviderInvoice: { id: invoiceId } } });
  assert.equal(expectation.companyId, companyId);
  assert.equal(expectation.expectedAmountMinor, BigInt(13700));
  const target = await control.createTransaction({ companyId, transactionDate: '2026-09-18', amount: '200.00', currency: 'USD', direction: 'OUTFLOW', description: `Synthetic generic expectation target ${suffix}`, reference: 'synthetic-961701-target' }, originalContext);
  const persistedTarget = await prisma.financialTransaction.findUniqueOrThrow({ where: { id: target.id }, include: { pilotFuelingEvent: true, pilotInvoiceAdjustment: true } });
  assert.equal(persistedTarget.operatingGroupId, groupId);
  assert.equal(persistedTarget.createdByUserId, userId);
  assert.equal(persistedTarget.pilotFuelingEvent, null);
  assert.equal(persistedTarget.pilotInvoiceAdjustment, null);
  const snapshot = async () => ({
    invoice: await prisma.pilotProviderInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { events: { orderBy: { id: 'asc' } }, productLines: { orderBy: { id: 'asc' } }, adjustments: { orderBy: { id: 'asc' } } } }),
    statements: await prisma.financialStatement.findMany({ where: { operatingGroupId: groupId }, orderBy: { id: 'asc' } }),
    records: await prisma.financialImportRecord.findMany({ where: { statement: { operatingGroupId: groupId } }, orderBy: { id: 'asc' } }),
    transactions: await prisma.financialTransaction.findMany({ where: { operatingGroupId: groupId }, orderBy: { id: 'asc' } }),
    allocations: await prisma.financialAllocation.findMany({ where: { transaction: { operatingGroupId: groupId } }, orderBy: { id: 'asc' } }),
    expectations: await prisma.financialExpectation.findMany({ where: { operatingGroupId: groupId }, orderBy: { id: 'asc' } }),
    matches: await prisma.financialExpectationMatch.findMany({ where: { expectation: { operatingGroupId: groupId } }, orderBy: { id: 'asc' } }),
    evidence: await prisma.financialTransactionEvidence.findMany({ where: { transaction: { operatingGroupId: groupId } }, orderBy: { id: 'asc' } }),
    audits: await prisma.financialAuditEvent.findMany({ where: { operatingGroupId: groupId }, orderBy: { id: 'asc' } }),
  });
  const before = await snapshot();
  const request = { transactionId: target.id, amount: '137.00' };
  await assert.rejects(() => control.matchExpectation(expectation.id, request, partialContext()), { constructor: FinancialNotFoundError });
  assert.deepEqual(await snapshot(), before);
  await prisma.companyMembership.delete({ where: { userId_companyId: { userId, companyId: relatedCompanyId } } });
  try {
    await assert.rejects(() => control.matchExpectation(expectation.id, request, originalContext), { constructor: FinancialNotFoundError });
    assert.deepEqual(await snapshot(), before);
  } finally {
    await prisma.companyMembership.create({ data: { userId, companyId: relatedCompanyId, role: 'OWNER' } });
  }
  const match = await control.matchExpectation(expectation.id, request, context());
  assert.equal(match.matchedAmountMinor, '13700');
  assert.equal((await prisma.financialExpectationMatch.findUniqueOrThrow({ where: { id: match.id } })).matchedAmountMinor, BigInt(13700));
  const after = await snapshot();
  assert.deepEqual(after.invoice, before.invoice);
  assert.deepEqual(after.statements, before.statements);
  assert.deepEqual(after.records, before.records);
  assert.deepEqual(after.transactions, before.transactions);
  assert.deepEqual(after.allocations, before.allocations);
  assert.deepEqual(after.evidence, before.evidence);
  assert.equal(after.matches.length, before.matches.length + 1);
  assert.deepEqual(after.matches.filter(({ id }) => id !== match.id), before.matches);
  assert.equal(after.audits.length, before.audits.length + 1);
  assert.equal(after.audits.find(({ transactionId, action }) => transactionId === target.id && action === 'EXPECTATION_MATCHED')?.actorUserId, userId);
  assert.deepEqual(after.expectations.filter(({ id }) => id !== expectation.id), before.expectations.filter(({ id }) => id !== expectation.id));
  const matched = after.expectations.find(({ id }) => id === expectation.id)!;
  assert.equal(matched.expectedAmountMinor, expectation.expectedAmountMinor);
  assert.equal(matched.matchedAmountMinor, BigInt(13700));
  assert.equal(matched.status, 'MATCHED');
  const manual = await control.createExpectation({ companyId, amount: '10.00', currency: 'USD', direction: 'OUTFLOW', description: `Synthetic non-Pilot expectation ${suffix}`, expectedDateStart: '2026-09-18' }, partialContext());
  const manualMatch = await control.matchExpectation(manual.id, { transactionId: target.id, amount: '10.00' }, partialContext());
  assert.equal(manualMatch.matchedAmountMinor, '1000');
  assert.equal((await prisma.financialExpectation.findUniqueOrThrow({ where: { id: manual.id } })).status, 'MATCHED');
});

test('generic matchEvidence requires original and current whole-Pilot authority while non-Pilot evidence remains usable', async () => {
  const originalContext = context();
  const links = await prisma.operatingGroupCompany.findMany({ where: { operatingGroupId: groupId } });
  assert.deepEqual(new Set(originalContext.companyIds), new Set(links.map(({ companyId }) => companyId)));
  // The normal importer retains this synthetic subtotal as unconsumed source evidence, not another expense.
  const subtotal = ['020 Subtotal', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 149, ''];
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '961702', amount: 149, total: 149, billingDate: '10/18/26', dueDate: '10/25/26', transactionDate: '10/11', rowsBeforeTotal: [subtotal] }), metadata(`synthetic-generic-evidence-${suffix}`), sourceId, originalContext);
  const invoiceId = String(preview.id); importedInvoiceIds.push(invoiceId);
  assert.equal((await importer.postInvoice(invoiceId, originalContext)).status, 'POSTED');
  const document = await prisma.pilotInvoiceDocument.findFirstOrThrow({ where: { invoiceId, role: 'STRUCTURED_SOURCE' }, include: { statement: true } });
  const records = await prisma.financialImportRecord.findMany({ where: { statementId: document.statementId, rawDescription: 'Pilot product subtotal' }, include: { evidence: true } });
  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.candidateAmountMinor, BigInt(14900));
  assert.equal(record.evidence.length, 0);
  assert.equal(document.statement.sourceTotalMinor, BigInt(14900));
  const target = await control.createTransaction({ companyId, transactionDate: '2026-10-18', amount: '200.00', currency: 'USD', direction: 'OUTFLOW', description: `Synthetic generic evidence target ${suffix}`, reference: 'synthetic-961702-target' }, originalContext);
  const persistedTarget = await prisma.financialTransaction.findUniqueOrThrow({ where: { id: target.id }, include: { pilotFuelingEvent: true, pilotInvoiceAdjustment: true } });
  assert.equal(persistedTarget.operatingGroupId, groupId);
  assert.equal(persistedTarget.createdByUserId, userId);
  assert.equal(persistedTarget.pilotFuelingEvent, null);
  assert.equal(persistedTarget.pilotInvoiceAdjustment, null);
  const snapshot = async () => ({
    invoice: await prisma.pilotProviderInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { events: { orderBy: { id: 'asc' } }, productLines: { orderBy: { id: 'asc' } }, adjustments: { orderBy: { id: 'asc' } } } }),
    statements: await prisma.financialStatement.findMany({ where: { operatingGroupId: groupId }, orderBy: { id: 'asc' } }),
    records: await prisma.financialImportRecord.findMany({ where: { statement: { operatingGroupId: groupId } }, orderBy: { id: 'asc' } }),
    transactions: await prisma.financialTransaction.findMany({ where: { operatingGroupId: groupId }, orderBy: { id: 'asc' } }),
    allocations: await prisma.financialAllocation.findMany({ where: { transaction: { operatingGroupId: groupId } }, orderBy: { id: 'asc' } }),
    expectations: await prisma.financialExpectation.findMany({ where: { operatingGroupId: groupId }, orderBy: { id: 'asc' } }),
    matches: await prisma.financialExpectationMatch.findMany({ where: { expectation: { operatingGroupId: groupId } }, orderBy: { id: 'asc' } }),
    evidence: await prisma.financialTransactionEvidence.findMany({ where: { transaction: { operatingGroupId: groupId } }, orderBy: { id: 'asc' } }),
    audits: await prisma.financialAuditEvent.findMany({ where: { operatingGroupId: groupId }, orderBy: { id: 'asc' } }),
  });
  const before = await snapshot();
  const request = { importRecordId: record.id, amount: '149.00', method: 'MANUAL', role: 'PRIMARY' };
  await assert.rejects(() => control.matchEvidence(target.id, request, partialContext()), { constructor: FinancialNotFoundError });
  assert.deepEqual(await snapshot(), before);
  await prisma.companyMembership.delete({ where: { userId_companyId: { userId, companyId: relatedCompanyId } } });
  try {
    await assert.rejects(() => control.matchEvidence(target.id, request, originalContext), { constructor: FinancialNotFoundError });
    assert.deepEqual(await snapshot(), before);
  } finally {
    await prisma.companyMembership.create({ data: { userId, companyId: relatedCompanyId, role: 'OWNER' } });
  }
  const evidence = await control.matchEvidence(target.id, request, context());
  assert.equal(evidence.matchedAmountMinor, '14900');
  const persisted = await prisma.financialTransactionEvidence.findUniqueOrThrow({ where: { id: evidence.id } });
  assert.equal(persisted.matchedAmountMinor, BigInt(14900));
  assert.equal(persisted.matchedByUserId, userId);
  const after = await snapshot();
  assert.deepEqual(after.invoice, before.invoice);
  assert.deepEqual(after.statements, before.statements);
  assert.deepEqual(after.allocations, before.allocations);
  assert.deepEqual(after.expectations, before.expectations);
  assert.deepEqual(after.matches, before.matches);
  assert.deepEqual(after.transactions.filter(({ id }) => id !== target.id), before.transactions.filter(({ id }) => id !== target.id));
  assert.deepEqual(after.records.filter(({ id }) => id !== record.id), before.records.filter(({ id }) => id !== record.id));
  const matchedTarget = after.transactions.find(({ id }) => id === target.id)!;
  assert.equal(matchedTarget.amountMinor, persistedTarget.amountMinor);
  assert.equal(matchedTarget.reconciliationStatus, 'PARTIALLY_MATCHED');
  const matchedRecord = after.records.find(({ id }) => id === record.id)!;
  assert.equal(matchedRecord.candidateAmountMinor, record.candidateAmountMinor);
  assert.equal(matchedRecord.rawAmount, record.rawAmount);
  assert.deepEqual(matchedRecord.rawMetadata, record.rawMetadata);
  assert.equal(matchedRecord.status, 'MATCHED');
  assert.equal(after.evidence.length, before.evidence.length + 1);
  assert.deepEqual(after.evidence.filter(({ id }) => id !== evidence.id), before.evidence);
  assert.equal(after.audits.length, before.audits.length + 1);
  assert.equal(after.audits.find(({ transactionId, action }) => transactionId === target.id && action === 'EVIDENCE_MATCHED')?.actorUserId, userId);
  const manualSource = await control.createSource({ name: `Synthetic non-Pilot bank ${suffix}`, type: 'BANK_ACCOUNT', companyId, currency: 'USD' }, partialContext());
  const manualStatement = await prisma.financialStatement.create({ data: { operatingGroupId: groupId, sourceId: manualSource.id, type: 'BANK_STATEMENT', periodStart: new Date('2026-10-18'), periodEnd: new Date('2026-10-18'), ...metadata(`synthetic-manual-evidence-${suffix}`), currency: 'USD', sourceTotalMinor: BigInt(1000), importedByUserId: userId } });
  const manualRecord = await prisma.financialImportRecord.create({ data: { statementId: manualStatement.id, sourceRowIndex: 1, rawDescription: 'Synthetic manual bank evidence', rawAmount: '1000', candidateAmountMinor: BigInt(1000), candidateDirection: 'OUTFLOW', fingerprintSha256: hashForTest('synthetic-generic-manual-evidence') } });
  const manualEvidence = await control.matchEvidence(target.id, { importRecordId: manualRecord.id, amount: '10.00', method: 'MANUAL', role: 'PRIMARY' }, partialContext());
  assert.equal(manualEvidence.matchedAmountMinor, '1000');
  assert.equal((await prisma.financialTransactionEvidence.findUniqueOrThrow({ where: { id: manualEvidence.id } })).matchedAmountMinor, BigInt(1000));
  assert.equal((await prisma.financialImportRecord.findUniqueOrThrow({ where: { id: manualRecord.id } })).status, 'MATCHED');
});
