import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { TruckCompanyHistoryService, historyDate } from '../fleet/truck-company-history';
import { classifyFuelDeductionLine, corroboratesFuelIdentity, discrepancyStatus, expectedFuelDeduction, FuelDeductionReconciliationService, resolveApplicableFuelPolicy } from './fuel-deduction-reconciliation';

test('structured classifier rejects unaccepted and incomplete statement lines', () => {
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: true, amountMinor: BigInt(1509) }), false);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'deductions', kind: 'DEDUCTION', included: true, amountMinor: BigInt(1509) }), false);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'EARNING', included: true, amountMinor: BigInt(1509) }), false);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: false, amountMinor: BigInt(1509) }), false);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: true, amountMinor: null }), false);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: true, amountMinor: BigInt(1509), metadata: { diesel_amount: '0', def_amount: '15.09', reefer_amount: '0' } }), true);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: true, amountMinor: BigInt(1509), metadata: { diesel_amount: '0', def_amount: '0', reefer_amount: '15.09' } }), false);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: true, amountMinor: BigInt(1509), metadata: { diesel_amount: '10', def_amount: '0', reefer_amount: '5.09' } }), false);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: true, amountMinor: BigInt(1509), metadata: { diesel_amount: '15.09' } }), false);
});

test('policy arithmetic is exact in integer minor units', () => {
  const pilot = { amountMinor: BigInt(10_000), retailMinor: BigInt(12_000), savingsMinor: BigInt(2_000) };
  assert.deepEqual(expectedFuelDeduction(pilot, { responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0 }), { expectedMinor: BigInt(10_000), retainedDiscountMinor: BigInt(0) });
  assert.deepEqual(expectedFuelDeduction(pilot, { responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000 }), { expectedMinor: BigInt(10_200), retainedDiscountMinor: BigInt(200) });
  assert.deepEqual(expectedFuelDeduction(pilot, { responsibility: 'COMPANY', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0 }), { expectedMinor: BigInt(0), retainedDiscountMinor: BigInt(0) });
  assert.equal(expectedFuelDeduction({ amountMinor: BigInt(10_000), retailMinor: null, savingsMinor: null }, { responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000 }), null);
  assert.equal(expectedFuelDeduction({ amountMinor: BigInt(10_000), retailMinor: BigInt(9_000), savingsMinor: null }, { responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000 }), null);
  assert.deepEqual([discrepancyStatus(BigInt(10_000), BigInt(10_000), false), discrepancyStatus(BigInt(10_000), BigInt(9_999), false), discrepancyStatus(BigInt(10_000), BigInt(10_001), false), discrepancyStatus(BigInt(10_000), BigInt(0), false), discrepancyStatus(BigInt(10_000), BigInt(11_509), true)], ['MATCHED', 'UNDER_DEDUCTED', 'OVER_DEDUCTED', 'MISSING_DEDUCTION', 'TIMING_DIFFERENCE']);
});

test('10% retention truncates fractional cents like the real April 22 Truck 024 deduction', () => {
  const pilot = { amountMinor: BigInt(56_748), retailMinor: BigInt(71_847), savingsMinor: BigInt(15_099) };
  const result = expectedFuelDeduction(pilot, { responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000 });
  assert.deepEqual(result, { expectedMinor: BigInt(58_257), retainedDiscountMinor: BigInt(1_509) });
  assert.equal(discrepancyStatus(result!.expectedMinor, BigInt(58_257), false), 'MATCHED');
  assert.equal(discrepancyStatus(result!.expectedMinor, BigInt(58_257), true), 'TIMING_DIFFERENCE');
});

test('policy resolution prefers unique specificity and fails closed on equally specific scopes', () => {
  type Candidate = Parameters<typeof resolveApplicableFuelPolicy>[0][number];
  const policy = (id: string, truckId: string | null, providerRecipientId: string | null): Candidate => ({
    id, companyId: 'company', truckId, providerRecipientId, responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION',
    companyRetentionBasisPoints: 1000, effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: new Date('2027-01-01T00:00:00Z'),
  });
  const company = policy('company', null, null), truck = policy('truck', 'truck', null), recipient = policy('recipient', null, 'recipient'), exact = policy('exact', 'truck', 'recipient');
  assert.equal(resolveApplicableFuelPolicy([company, truck], 'company', 'truck', 'recipient', '2026-06-01').policy?.id, 'truck');
  assert.deepEqual(resolveApplicableFuelPolicy([company, truck, recipient], 'company', 'truck', 'recipient', '2026-06-01'), { policy: null, ambiguous: true });
  assert.equal(resolveApplicableFuelPolicy([company, truck, recipient, exact], 'company', 'truck', 'recipient', '2026-06-01').policy?.id, 'exact');
  assert.deepEqual(resolveApplicableFuelPolicy([exact], 'company', 'truck', 'recipient', '2027-01-01'), { policy: null, ambiguous: false });
});

test('Truck/date fallback requires structured identity corroboration', () => {
  const pilot = { cardLastFour: '1234', locationNumber: '358', city: 'Paducah', state: 'KY' };
  assert.equal(corroboratesFuelIdentity(pilot, { cardLastFour: '1234', locationNumber: '358', city: 'Paducah', state: 'KY' }), true);
  assert.equal(corroboratesFuelIdentity(pilot, { cardLastFour: '1234', locationNumber: '999', city: 'Paducah', state: 'KY' }), false);
  assert.equal(corroboratesFuelIdentity(pilot, { cardLastFour: '1234', locationNumber: null, city: null, state: null }), false);
});

const rootUrl = new URL(process.env.DATABASE_URL!);
const dbName = `fuel_reconciliation_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: rootUrl.toString() });
rootUrl.pathname = `/${dbName}`;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: rootUrl.toString() }) });
const service = new FuelDeductionReconciliationService(db);
let companyId: string, groupId: string, userId: string, sourceId: string, archiveCompanyId: string, pilotStatementId: string;
const truckIds: Record<string, string> = {};
let importRow = 0;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const minor = (value: number) => BigInt(value);

async function importRecord(rawAmount = '0') {
  importRow += 1;
  return db.financialImportRecord.create({ data: { statementId: pilotStatementId, sourceRowIndex: importRow, rawAmount, fingerprintSha256: hash(`${dbName}:${importRow}`) } });
}

async function addEvent(input: { key: string; date: string; truckId?: string | null; unit: string; product?: 'TRUCK_DIESEL' | 'DEF' | 'REEFER_FUEL'; amount: bigint; retail?: bigint; savings?: bigint; reference?: string }) {
  const invoice = await db.pilotProviderInvoice.create({ data: { operatingGroupId: groupId, sourceId, providerAccountHash: hash('account'), invoiceNumber: `INV-${input.key}`, billingDate: historyDate(input.date), periodStart: historyDate(input.date), periodEnd: historyDate(input.date), invoiceTotalMinor: input.amount, parsedTotalMinor: input.amount, differenceMinor: BigInt(0), status: 'POSTED', parseVersion: 'test', uploadedByUserId: userId, postedByUserId: userId, postedAt: new Date() } });
  const event = await db.pilotFuelingEvent.create({ data: { invoiceId: invoice.id, eventKeyHash: hash(input.key), ticketHash: hash(input.reference ?? `ticket-${input.key}`), authorizationHash: hash(`auth-${input.key}`), cardLastFour: '1234', sourceUnitNumber: input.unit, locationNumber: '100', city: 'Test City', state: 'CA', transactionDate: historyDate(input.date), truckId: input.truckId, truckMatchStatus: input.truckId ? 'MATCHED' : 'UNMATCHED' } });
  const record = await importRecord(input.amount.toString());
  await db.pilotFuelProductLine.create({ data: { invoiceId: invoice.id, eventId: event.id, importRecordId: record.id, lineFingerprint: hash(`line-${input.key}`), sourceLineIdentity: input.key, sourceProductCode: input.product ?? 'DIESEL', productType: input.product ?? 'TRUCK_DIESEL', quantity: '20.00', unitPrice: '5.0000000', amountMinor: input.amount, retailAmountMinor: input.retail ?? input.amount, savingsMinor: input.savings ?? BigInt(0) } });
  return event;
}

async function archiveVersion(input: { key: string; pid: string; recipientId: string; recipientType: string; role?: string; workStart: string; workEnd: string; truckId: string; unit: string; amount?: bigint; sourceDate?: string; reference?: string }) {
  const document = await db.financialStatement.create({ data: { operatingGroupId: groupId, sourceId, type: 'OWNER_SETTLEMENT', periodStart: historyDate(input.workStart), periodEnd: historyDate(input.workEnd), originalFilename: `${input.key}.pdf`, displayFilename: `${input.key}.pdf`, mimeType: 'application/pdf', byteSize: 1, storageKey: `test/${dbName}/${input.key}.pdf`, checksumSha256: hash(`pdf-${input.key}`), importedByUserId: userId } });
  const statement = await db.archiveStatement.create({ data: { archiveCompanyId, providerStatementId: input.key, latestProviderVersion: 1, acceptedProviderVersion: 1 } });
  return db.$transaction(async tx => {
    const version = await tx.archiveVersion.create({ data: { statementId: statement.id, providerVersion: 1, documentId: document.id, detailStorageKey: `test/${dbName}/${input.key}.json`, detailChecksum: hash(`detail-${input.key}`), pdfChecksum: document.checksumSha256, bundleChecksum: hash(`bundle-${input.key}`), pid: input.pid, recipientId: input.recipientId, recipientName: input.recipientId, recipientType: input.recipientType, role: input.role, workStart: historyDate(input.workStart), workEnd: historyDate(input.workEnd), header: {}, issues: [], parserVersion: 'test', capturedByUserId: userId } });
    await tx.archiveTruck.create({ data: { versionId: version.id, sourceKey: input.unit, unit: input.unit, truckId: input.truckId, mappingStatus: 'MATCHED' } });
    if (input.amount !== undefined) await tx.archiveLine.create({ data: { versionId: version.id, kind: 'DEDUCTION', sourceArray: 'fuel_transactions', sourceOrder: 0, providerLineId: input.reference ?? input.key, description: 'Structured Pilot fuel recovery', sourceType: 'fuel', amountMinor: -input.amount, rawAmount: input.amount.toString(), sourceDate: input.sourceDate, reference: input.reference, sourceUnit: input.unit, included: true, metadata: { type: 'fuel', diesel_amount: input.amount.toString(), def_amount: '0', reefer_amount: '0', pay_amount: input.amount.toString(), card_number: '991234', merchant: '100', city: 'Test City', state: 'CA' } } });
    return tx.archiveVersion.update({ where: { id: version.id }, data: { sealed: true } });
  });
}

before(async () => {
  await admin.query(`CREATE DATABASE "${dbName}"`);
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: rootUrl.toString() }, stdio: 'pipe' });
  const company = await db.company.create({ data: { name: 'Synthetic reconciliation Company' } }); companyId = company.id;
  const user = await db.user.create({ data: { email: `${dbName}@example.test`, displayName: 'Fuel policy owner', activeCompanyId: companyId, memberships: { create: { companyId, role: 'OWNER' } } } }); userId = user.id;
  const group = await db.operatingGroup.create({ data: { name: 'Synthetic reconciliation group', companies: { create: { companyId } }, memberships: { create: { userId, role: 'OWNER' } } } }); groupId = group.id;
  const source = await db.financialSource.create({ data: { operatingGroupId: groupId, companyId, name: 'Synthetic Pilot and archive', type: 'FUEL_CARD', provider: 'PILOT' } }); sourceId = source.id;
  await db.archiveScopeGrant.create({ data: { operatingGroupId: groupId, companyId, grantedByUserId: userId, reason: 'Synthetic reconciliation fixture' } });
  archiveCompanyId = (await db.archiveCompany.create({ data: { operatingGroupId: groupId, companyId, sourceId, accountKey: 'synthetic', providerCompanyId: 'synthetic-company', providerCompanyName: company.name } })).id;
  pilotStatementId = (await db.financialStatement.create({ data: { operatingGroupId: groupId, sourceId, type: 'FUEL_STATEMENT', periodStart: historyDate('2026-04-01'), periodEnd: historyDate('2026-08-31'), originalFilename: 'pilot.csv', displayFilename: 'pilot.csv', mimeType: 'text/csv', byteSize: 1, storageKey: `test/${dbName}/pilot.csv`, checksumSha256: hash('pilot-document'), importedByUserId: userId } })).id;
  const history = new TruckCompanyHistoryService(db);
  for (const [name, withHistory] of [['exact', true], ['driver', true], ['timing', true], ['unknown', false]] as const) {
    const truck = await db.truck.create({ data: { companyId, unitNumber: `UNIT-${name.toUpperCase()}`, unitNumberNormalized: `UNIT-${name.toUpperCase()}` } }); truckIds[name] = truck.id;
    if (withHistory) await history.change(truck.id, { action: 'CONFIRM', expectedRevisionId: null, source: 'MANUAL_CONFIRMATION', sourceReference: 'Synthetic fixture', reason: 'Synthetic fixture', periods: [{ companyId, effectiveFrom: '2026-01-01', effectiveTo: '2026-09-01' }] }, userId);
  }
  await db.fuelDeductionPolicy.createMany({ data: [
    { operatingGroupId: groupId, companyId, truckId: truckIds.exact, providerRecipientId: 'contractor-exact', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic full pass through', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.timing, providerRecipientId: 'contractor-timing', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic timing policy', reason: 'Fixture', approvedByUserId: userId },
  ] });
  await addEvent({ key: 'exact', date: '2026-06-10', truckId: truckIds.exact, unit: 'UNIT-EXACT', product: 'TRUCK_DIESEL', amount: minor(10_000), retail: minor(12_000), savings: minor(2_000) });
  await archiveVersion({ key: 'exact-driver', pid: '10', recipientId: 'driver-pair', recipientType: 'DRIVER', workStart: '2026-06-08', workEnd: '2026-06-15', truckId: truckIds.exact, unit: 'UNIT-EXACT', amount: minor(10_000), sourceDate: '2026-06-10', reference: 'paired-ref' });
  await archiveVersion({ key: 'exact-contractor', pid: '10', recipientId: 'contractor-exact', recipientType: 'CONTRACTOR', workStart: '2026-06-08', workEnd: '2026-06-15', truckId: truckIds.exact, unit: 'UNIT-EXACT', amount: minor(10_000), sourceDate: '2026-06-10', reference: 'paired-ref' });
  await addEvent({ key: 'driver', date: '2026-06-11', truckId: truckIds.driver, unit: 'UNIT-DRIVER', amount: minor(7_500) });
  await archiveVersion({ key: 'driver-assignment', pid: '11', recipientId: 'company-driver', recipientType: 'DRIVER', role: 'Company Driver', workStart: '2026-06-08', workEnd: '2026-06-15', truckId: truckIds.driver, unit: 'UNIT-DRIVER' });
  await addEvent({ key: 'timing', date: '2026-04-22', truckId: truckIds.timing, unit: 'UNIT-TIMING', amount: minor(10_000), reference: 'APR22-PID30' });
  await archiveVersion({ key: 'timing-line', pid: '30', recipientId: 'contractor-timing', recipientType: 'CONTRACTOR', workStart: '2026-07-01', workEnd: '2026-07-07', truckId: truckIds.timing, unit: 'UNIT-TIMING', amount: minor(11_509), sourceDate: '2026-07-03', reference: 'APR22-PID30' });
  await addEvent({ key: 'unknown', date: '2026-06-12', truckId: truckIds.unknown, unit: 'UNIT-UNKNOWN', amount: minor(5_000) });
  await archiveVersion({ key: 'unknown-line', pid: '12', recipientId: 'contractor-unknown', recipientType: 'CONTRACTOR', workStart: '2026-07-01', workEnd: '2026-07-07', truckId: truckIds.unknown, unit: 'UNIT-UNKNOWN', amount: minor(6_509), sourceDate: '2026-06-12' });
  await addEvent({ key: 'unmapped', date: '2026-06-13', truckId: null, unit: 'UNIT-211', amount: minor(6_000) });
  await addEvent({ key: 'reefer', date: '2026-06-14', truckId: truckIds.exact, unit: 'UNIT-EXACT', product: 'REEFER_FUEL', amount: minor(500) });
  await archiveVersion({ key: 'statement-inside', pid: '20', recipientId: 'contractor-other', recipientType: 'CONTRACTOR', workStart: '2026-06-01', workEnd: '2026-06-07', truckId: truckIds.exact, unit: 'UNIT-EXACT', amount: minor(3_000) });
  await archiveVersion({ key: 'statement-outside', pid: '1', recipientId: 'contractor-other', recipientType: 'CONTRACTOR', workStart: '2026-01-01', workEnd: '2026-01-07', truckId: truckIds.exact, unit: 'UNIT-EXACT', amount: minor(4_000) });
  const invoice = await db.pilotProviderInvoice.findFirstOrThrow(); const record = await importRecord('-28.59');
  await db.pilotInvoiceAdjustment.create({ data: { invoiceId: invoice.id, importRecordId: record.id, fingerprint: hash('credit'), sourceLineIdentity: 'credit', description: 'Provider credit', signedAmountMinor: BigInt(-2859) } });
});

after(async () => { await db.$disconnect(); await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`); await admin.end(); });

test('full preview covers matching, timing, coverage, responsibility, history, mapping and exclusions without economic writes', async () => {
  const context = { userId, activeCompanyId: companyId, operatingGroupId: groupId, role: 'OWNER' as const, companyIds: [companyId] };
  const protectedBefore = [await db.financialTransaction.count(), await db.financialExpectation.count(), await db.financialAllocation.count(), await db.financialExpectationBankMatch.count()];
  const result = await service.preview(context);
  assert.deepEqual(result.coverage, { start: '2026-04-22', end: '2026-06-13' });
  assert.equal(result.summary.reeferExcludedMinor, minor(500)); assert.equal(result.summary.providerCreditExcludedMinor, BigInt(-2859));
  const exact = result.rows.find(row => row.pilotEventId && row.truckId === truckIds.exact && row.purchaseDate === '2026-06-10')!;
  assert.equal(exact.status, 'MATCHED'); assert.equal(exact.statementMinor, minor(10_000)); assert.equal(exact.statementEvidence?.lineIds.length, 2); assert.equal(exact.recipientId, 'contractor-exact');
  const driver = result.rows.find(row => row.truckId === truckIds.driver)!;
  assert.equal(driver.status, 'MATCHED'); assert.equal(driver.expectedMinor, minor(0)); assert.equal(driver.statementMinor, minor(0));
  const timing = result.rows.find(row => row.truckId === truckIds.timing)!;
  assert.equal(timing.status, 'TIMING_DIFFERENCE'); assert.equal(timing.pid, '30'); assert.equal(timing.differenceMinor, minor(1509)); assert.equal(timing.matchMethod, 'REFERENCE');
  const unknown = result.rows.find(row => row.truckId === truckIds.unknown)!;
  assert.equal(unknown.status, 'NEEDS_COMPANY_HISTORY'); assert.equal(unknown.pid, '12'); assert.equal(unknown.observedAmountDeltaMinor, minor(1509));
  assert.equal(result.rows.find(row => row.truckUnit === 'UNIT-211')?.status, 'NEEDS_TRUCK_MAPPING');
  assert.equal(result.rows.find(row => row.pid === '20')?.status, 'STATEMENT_ONLY');
  assert.equal(result.rows.find(row => row.pid === '1')?.status, 'NO_PILOT_DATA_IMPORTED');
  assert.deepEqual([await db.financialTransaction.count(), await db.financialExpectation.count(), await db.financialAllocation.count(), await db.financialExpectationBankMatch.count()], protectedBefore);
});

test('policy creation requires Company authority, records audit evidence and database rejects overlap', async () => {
  const context = { userId, activeCompanyId: companyId, operatingGroupId: groupId, role: 'OWNER' as const, companyIds: [companyId] };
  const policy = await service.createPolicy({ companyId, truckId: truckIds.driver, providerRecipientId: 'new-recipient', responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000, effectiveFrom: '2026-01-01', effectiveTo: '2026-05-01', sourceReference: 'Signed synthetic agreement', reason: 'Validate effective-dated 10% retention' }, context);
  assert.equal(policy.companyRetentionBasisPoints, 1000);
  assert.equal(await db.financialAuditEvent.count({ where: { action: 'FUEL_DEDUCTION_POLICY_CREATED', actorUserId: userId } }), 1);
  await assert.rejects(service.createPolicy({ companyId, truckId: truckIds.driver, providerRecipientId: 'new-recipient', responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000, effectiveFrom: '2026-04-01', sourceReference: 'Overlap', reason: 'Must fail closed' }, context));
  const outsider = await db.user.create({ data: { email: `${dbName}-outsider@example.test`, displayName: 'Outsider' } });
  await assert.rejects(service.createPolicy({ companyId, responsibility: 'COMPANY', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: '2026-01-01', sourceReference: 'None', reason: 'Unauthorized' }, { ...context, userId: outsider.id }));
});
