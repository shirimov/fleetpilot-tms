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
import type { PrivateFileStorage } from '@/lib/storage/private-file-storage';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const control = new FinancialControlService(prisma);
const importer = new PilotImportService(prisma);
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
const providerAccountHash = createHash('sha256').update('123456789').digest('hex');
const hashForTest = (value: string) => createHash('sha256').update(`${suffix}:${value}`).digest('hex');

function context(): FinancialAuthorization { return { userId, role: 'OWNER', activeCompanyId: companyId, operatingGroupId: groupId, companyIds: [companyId] }; }
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
  await prisma.company.deleteMany({ where: { id: { in: [companyId, relatedCompanyId, foreignCompanyId] } } });
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

test('Pilot matching spans authorized companies, preserves leading zeros, and posts to the truck company', async () => {
  const authorizedContext = { ...context(), companyIds: [companyId, relatedCompanyId] };
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
  const authorizedContext = { ...context(), companyIds: [companyId, relatedCompanyId] };
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
    assert.equal(concurrentResolution.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(concurrentResolution.filter(({ status }) => status === 'rejected').length, 1);
    const resolved = await importer.getInvoice(String(preview.id), authorizedContext);
    const sameUnitEvents = resolved.events as Array<{ truckId: string; truckMatchStatus: string }>;
    assert.equal(sameUnitEvents.length, 2);
    assert.ok(sameUnitEvents.every((event) => event.truckId === relatedTruckId && event.truckMatchStatus === 'MANUALLY_MATCHED'));
    assert.equal((resolved.issues as Array<{ code: string; status: string }>).filter(({ code, status }) => code === 'AMBIGUOUS_TRUCK' && status === 'OPEN').length, 0);
    const manualAudit = await prisma.financialAuditEvent.findFirstOrThrow({ where: { pilotProviderInvoiceId: String(preview.id), action: 'PILOT_IMPORT_ISSUE_RESOLVED' }, orderBy: { occurredAt: 'desc' } });
    assert.deepEqual(manualAudit.metadata, { issueId: issue.id, action: 'MATCH_TRUCK', truckId: relatedTruckId, companyId: relatedCompanyId, sourceUnitNumber: '777', affectedEventCount: '2' });
    const afterRematch = await importer.rematchTrucks(String(preview.id), authorizedContext);
    assert.ok((afterRematch.events as Array<{ truckId: string; truckMatchStatus: string }>).every((event) => event.truckId === relatedTruckId && event.truckMatchStatus === 'MANUALLY_MATCHED'));
  } finally {
    await prisma.truck.delete({ where: { id: duplicate.id } });
  }
});

test('safe rematch resolves only truck issues and preserves financial values and unrelated review', async () => {
  const authorizedContext = { ...context(), companyIds: [companyId, relatedCompanyId] };
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

test('posting revalidates the matched truck against the current authorized company scope', async () => {
  const preview = await importer.createImport(
    pilotXlsFixture({ invoiceNumber: '910024', unitNumber: '777' }),
    metadata('pilot-910024'), sourceId, { ...context(), companyIds: [companyId, relatedCompanyId] },
  );
  importedInvoiceIds.push(String(preview.id));
  assert.equal(preview.status, 'READY_TO_POST');
  await assert.rejects(() => importer.postInvoice(String(preview.id), context()), /authorized Accounting company scope/);
  assert.equal(await prisma.financialTransaction.count({ where: { reference: '910024' } }), 0);
});

test('posting re-reads membership, Truck status, and canonical company inside the transaction', async () => {
  const authorizedContext = { ...context(), companyIds: [companyId, relatedCompanyId] };
  const preview = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910025', unitNumber: '777' }), metadata('pilot-910025'), sourceId, authorizedContext);
  importedInvoiceIds.push(String(preview.id));

  await prisma.companyMembership.delete({ where: { userId_companyId: { userId, companyId: relatedCompanyId } } });
  await assert.rejects(() => importer.postInvoice(String(preview.id), authorizedContext), /current authorized Accounting company scope/);
  await prisma.companyMembership.create({ data: { userId, companyId: relatedCompanyId, role: 'OWNER' } });

  await prisma.truck.update({ where: { id: relatedTruckId }, data: { status: 'INACTIVE' } });
  await assert.rejects(() => importer.postInvoice(String(preview.id), authorizedContext), /current authorized Accounting company scope/);
  await prisma.truck.update({ where: { id: relatedTruckId }, data: { status: 'ACTIVE' } });

  await prisma.truck.update({ where: { id: foreignTruckId }, data: { unitNumber: `foreign-${suffix}`, unitNumberNormalized: `FOREIGN-${suffix}`.toUpperCase() } });
  await prisma.truck.update({ where: { id: relatedTruckId }, data: { companyId: foreignCompanyId } });
  await assert.rejects(() => importer.postInvoice(String(preview.id), authorizedContext), /current authorized Accounting company scope/);
  await prisma.truck.update({ where: { id: relatedTruckId }, data: { companyId: relatedCompanyId } });
  await prisma.truck.update({ where: { id: foreignTruckId }, data: { unitNumber: '777', unitNumberNormalized: '777' } });

  assert.equal(await prisma.financialTransaction.count({ where: { reference: '910025' } }), 0);
});

test('cross-company event posting counts each expense once at group level', async () => {
  const authorizedContext = { ...context(), companyIds: [companyId, relatedCompanyId] };
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
  await reparseImporter.resolveIssue(invoiceId, issues.find(({ code }) => code === 'UNMATCHED_TRUCK')!.id, { action: 'MATCH_TRUCK', truckId }, context());
  await reparseImporter.resolveIssue(invoiceId, issues.find(({ code }) => code === 'MISSING_CATEGORY')!.id, { action: 'SET_CATEGORY', categoryId: fuelCategoryId }, context());
  await markAsFaultyV1(invoiceId, BigInt(20200));
  const reparsed = await reparseImporter.reparseInvoice(invoiceId, context());
  assert.equal((reparsed.events as Array<{ truckId: string; truckMatchStatus: string }>)[0].truckId, truckId);
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
  await assert.rejects(() => importer.postInvoice(String(inactive.id), context()), /active and belong/);
  await control.updateCategory(fuelCategoryId, { isActive: true }, context());

  const stale = await importer.createImport(pilotXlsFixture({ invoiceNumber: '910007' }), metadata('pilot-910007'), sourceId, context());
  importedInvoiceIds.push(String(stale.id));
  const foreignGroup = await prisma.operatingGroup.create({ data: { name: `Foreign category group ${suffix}` } });
  const foreignCategory = await prisma.financialCategory.create({ data: { operatingGroupId: foreignGroup.id, name: `Foreign fuel ${suffix}`, type: 'DIRECT_EXPENSE' } });
  try {
    await prisma.pilotFuelProductLine.updateMany({ where: { invoiceId: String(stale.id) }, data: { categoryId: foreignCategory.id } });
    await assert.rejects(() => importer.postInvoice(String(stale.id), context()), /active and belong/);
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
  await assert.rejects(() => importer.resolveIssue(String(invoice.id), issue.id, { action: 'MATCH_TRUCK', truckId: foreignTruckId }, context()), FinancialValidationError);
  const unchanged = await importer.getInvoice(String(invoice.id), context());
  assert.equal((unchanged.events as Array<{ truckId: string | null }>)[0].truckId, null);
});
