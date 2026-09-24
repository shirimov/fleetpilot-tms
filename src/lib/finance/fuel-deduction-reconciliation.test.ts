import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { TruckCompanyHistoryService, historyDate } from '../fleet/truck-company-history';
import { acceptsHistoricalCrossRecipientRouting, classifyFuelDeductionLine, corroboratesFuelIdentity, corroboratesFuelIdentityStrict, corroboratesFuelProducts, discrepancyStatus, expectedFuelDeduction, expectedFuelDeductionForComponents, fuelAmountsWithinOwnerTolerance, fuelMonetaryToleranceMinor, FuelDeductionReconciliationService, isDieselReeferClassificationDifference, quickManageDateRelation, resolveApplicableFuelPolicy, type FuelReconciliationRow } from './fuel-deduction-reconciliation';

test('structured classifier rejects unaccepted and incomplete statement lines', () => {
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: true, amountMinor: BigInt(1509) }), false);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'deductions', kind: 'DEDUCTION', included: true, amountMinor: BigInt(1509) }), false);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'EARNING', included: true, amountMinor: BigInt(1509) }), false);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: false, amountMinor: BigInt(1509) }), false);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: true, amountMinor: null }), false);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: true, amountMinor: BigInt(1509), metadata: { diesel_amount: '0', def_amount: '15.09', reefer_amount: '0' } }), true);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: true, amountMinor: BigInt(1509), metadata: { diesel_amount: '0', def_amount: '0', reefer_amount: '15.09' } }), true);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: true, amountMinor: BigInt(1509), metadata: { diesel_amount: '10', def_amount: '0', reefer_amount: '5.09' } }), true);
  assert.equal(classifyFuelDeductionLine({ sourceArray: 'fuel_transactions', kind: 'DEDUCTION', included: true, amountMinor: BigInt(1509), metadata: { diesel_amount: '15.09' } }), false);
});

test('policy arithmetic is exact in integer minor units', () => {
  const pilot = { amountMinor: BigInt(10_000), retailMinor: BigInt(12_000), savingsMinor: BigInt(2_000) };
  assert.deepEqual(expectedFuelDeduction(pilot, { responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0 }), { expectedMinor: BigInt(10_000), retainedDiscountMinor: BigInt(0) });
  assert.deepEqual(expectedFuelDeduction(pilot, { responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000 }), { expectedMinor: BigInt(10_200), retainedDiscountMinor: BigInt(200) });
  assert.deepEqual(expectedFuelDeduction(pilot, { responsibility: 'COMPANY', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0 }), { expectedMinor: BigInt(0), retainedDiscountMinor: BigInt(0) });
  assert.equal(expectedFuelDeduction({ amountMinor: BigInt(10_000), retailMinor: null, savingsMinor: null }, { responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000 }), null);
  assert.equal(expectedFuelDeduction({ amountMinor: BigInt(10_000), retailMinor: BigInt(9_000), savingsMinor: null }, { responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000 }), null);
  assert.deepEqual([discrepancyStatus(BigInt(10_000), BigInt(10_000), false), discrepancyStatus(BigInt(10_000), BigInt(9_994), false), discrepancyStatus(BigInt(10_000), BigInt(10_006), false), discrepancyStatus(BigInt(10_000), BigInt(0), false), discrepancyStatus(BigInt(10_000), BigInt(11_509), true)], ['MATCHED', 'UNDER_DEDUCTED', 'OVER_DEDUCTED', 'MISSING_DEDUCTION', 'TIMING_DIFFERENCE']);
});

test('OWNER fuel tolerance is five cents per total comparison and preserves the exact variance', () => {
  const expected = BigInt(58_257);
  assert.equal(fuelMonetaryToleranceMinor, BigInt(5));
  for (const variance of [0, 1, 4, 5, -5]) {
    const actual = expected + BigInt(variance);
    assert.equal(fuelAmountsWithinOwnerTolerance(expected, actual), true);
    assert.equal(discrepancyStatus(expected, actual, false), 'MATCHED');
    assert.equal(actual - expected, BigInt(variance));
  }
  assert.equal(fuelAmountsWithinOwnerTolerance(expected, expected + BigInt(6)), false);
  assert.equal(fuelAmountsWithinOwnerTolerance(expected, expected - BigInt(6)), false);
  assert.equal(discrepancyStatus(expected, expected + BigInt(6), false), 'OVER_DEDUCTED');
  assert.equal(discrepancyStatus(expected, expected - BigInt(6), false), 'UNDER_DEDUCTED');
  assert.equal(discrepancyStatus(BigInt(5), BigInt(0), false), 'MISSING_DEDUCTION');
  // The rule accepts only the two total amounts; gallons cannot multiply it.
  assert.equal(fuelAmountsWithinOwnerTolerance(expected, expected + BigInt(6)), false);
});

test('10% retention truncates fractional cents like the real April 22 Truck 024 deduction', () => {
  const pilot = { amountMinor: BigInt(56_748), retailMinor: BigInt(71_847), savingsMinor: BigInt(15_099) };
  const result = expectedFuelDeduction(pilot, { responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000 });
  assert.deepEqual(result, { expectedMinor: BigInt(58_257), retainedDiscountMinor: BigInt(1_509) });
  assert.equal(discrepancyStatus(result!.expectedMinor, BigInt(58_257), false), 'MATCHED');
  assert.equal(discrepancyStatus(result!.expectedMinor, BigInt(58_257), true), 'TIMING_DIFFERENCE');
});

test('Diesel and Reefer components retain separately before their accepted recovery is totaled', () => {
  const policy = { responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000 } as const;
  assert.deepEqual(expectedFuelDeductionForComponents([
    { amountMinor: BigInt(26_099), retailMinor: BigInt(31_134), savingsMinor: BigInt(5_035) },
    { amountMinor: BigInt(7_569), retailMinor: BigInt(9_028), savingsMinor: BigInt(1_459) },
    { amountMinor: BigInt(7_712), retailMinor: BigInt(7_712), savingsMinor: BigInt(0) },
  ], policy), { expectedMinor: BigInt(42_028), retainedDiscountMinor: BigInt(648) });
  assert.deepEqual(expectedFuelDeductionForComponents([
    { amountMinor: BigInt(13_216), retailMinor: BigInt(14_864), savingsMinor: BigInt(1_648) },
    { amountMinor: BigInt(3_170), retailMinor: BigInt(3_170), savingsMinor: BigInt(0) },
  ], policy), { expectedMinor: BigInt(16_550), retainedDiscountMinor: BigInt(164) });
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

test('Pilot Sunday and QuickManage Saturday use the observed provider calendar boundary only', () => {
  assert.equal(quickManageDateRelation('2026-07-12', '2026-07-11T13:25:00Z'), 'PILOT_SUNDAY_QUICKMANAGE_SATURDAY');
  assert.equal(quickManageDateRelation('2026-07-12', '2026-07-12T01:00:00Z'), 'EXACT');
  assert.equal(quickManageDateRelation('2026-07-13', '2026-07-12T23:59:00Z'), null);
  assert.equal(quickManageDateRelation('2026-07-12', '2026-07-11'), null);
  assert.equal(quickManageDateRelation('2026-07-12', '2026-07-10T23:59:00Z'), null);
});

test('weekend matching requires card, location, geography and product composition', () => {
  const pilot = { cardLastFour: '1234', locationNumber: '1110', city: 'Colorado Spri', state: 'CO' };
  assert.equal(corroboratesFuelIdentityStrict(pilot, { cardLastFour: '1234', locationNumber: '1110', city: 'Colorado Springs', state: 'CO' }), true);
  assert.equal(corroboratesFuelIdentityStrict(pilot, { cardLastFour: '9999', locationNumber: '1110', city: 'Colorado Springs', state: 'CO' }), false);
  assert.equal(corroboratesFuelIdentityStrict(pilot, { cardLastFour: '1234', locationNumber: '9999', city: 'Colorado Springs', state: 'CO' }), false);
  assert.equal(corroboratesFuelProducts({ dieselFamilyQuantityHundredths: BigInt(15041), defAmountMinor: BigInt(0) }, { dieselFamilyQuantityHundredths: BigInt(15041), defAmountMinor: BigInt(0) }), true);
  assert.equal(corroboratesFuelProducts({ dieselFamilyQuantityHundredths: BigInt(15041), defAmountMinor: BigInt(0) }, { dieselFamilyQuantityHundredths: BigInt(15040), defAmountMinor: BigInt(0) }), false);
});

test('OWNER rules accept only pre-cutoff routing and only Diesel/Reefer classification differences', () => {
  assert.equal(acceptsHistoricalCrossRecipientRouting('2026-09-21'), true);
  assert.equal(acceptsHistoricalCrossRecipientRouting('2026-09-22'), false);
  assert.equal(acceptsHistoricalCrossRecipientRouting('2026-09-23'), false);
  assert.equal(isDieselReeferClassificationDifference(['TRUCK_DIESEL'], ['REEFER_FUEL']), true);
  assert.equal(isDieselReeferClassificationDifference(['REEFER_FUEL'], ['TRUCK_DIESEL']), true);
  assert.equal(isDieselReeferClassificationDifference(['TRUCK_DIESEL', 'DEF'], ['REEFER_FUEL', 'DEF']), true);
  assert.equal(isDieselReeferClassificationDifference(['DEF'], ['TRUCK_DIESEL']), false);
  assert.equal(isDieselReeferClassificationDifference(['TRUCK_DIESEL'], ['DEF']), false);
  assert.equal(isDieselReeferClassificationDifference(['REEFER_FUEL'], ['DEF']), false);
  assert.equal(isDieselReeferClassificationDifference(['DEF'], ['REEFER_FUEL']), false);
});

const auditedWeekendCases = [
  ['2026-07-05','2026-07-04T03:40:00Z',67713,'149.93',5436],['2026-07-05','2026-07-04T10:40:00Z',67374,'125.82',6227],
  ['2026-07-12','2026-07-11T13:25:00Z',33074,'79.77',0],['2026-07-12','2026-07-11T17:14:00Z',112590,'176.25',7482],['2026-07-12','2026-07-11T19:35:00Z',59121,'124.40',3589],['2026-07-12','2026-07-11T11:53:00Z',48427,'118.75',0],['2026-07-12','2026-07-11T09:55:00Z',70590,'146.58',6576],['2026-07-12','2026-07-11T02:17:00Z',78398,'123.57',6741],['2026-07-12','2026-07-11T13:26:00Z',67786,'150.41',0],['2026-07-12','2026-07-11T18:15:00Z',73119,'161.64',0],['2026-07-12','2026-07-11T05:10:00Z',51186,'103.79',6212],['2026-07-12','2026-07-11T11:35:00Z',87842,'193.38',3111],['2026-07-12','2026-07-11T05:19:00Z',3856,'8.90',0],['2026-07-12','2026-07-11T20:33:00Z',46651,'83.32',0],
  ['2026-07-19','2026-07-18T05:24:00Z',93396,'141.55',3038],['2026-07-19','2026-07-18T09:19:00Z',87516,'166.62',3996],['2026-07-19','2026-07-18T21:08:00Z',50551,'106.51',0],['2026-07-19','2026-07-18T05:27:00Z',83895,'152.08',3472],['2026-07-19','2026-07-18T07:52:00Z',118515,'176.25',6525],['2026-07-19','2026-07-18T14:05:00Z',112130,'169.25',5092],['2026-07-19','2026-07-18T18:25:00Z',41979,'74.52',0],['2026-07-19','2026-07-18T05:17:00Z',33840,'64.35',0],['2026-07-19','2026-07-18T13:18:00Z',50910,'107.30',0],['2026-07-19','2026-07-18T11:43:00Z',22835,'44.74',493],['2026-07-19','2026-07-18T21:49:00Z',97372,'141.00',6156],['2026-07-19','2026-07-18T16:48:00Z',79425,'117.75',6903],
  ['2026-07-26','2026-07-25T20:22:00Z',42010,'89.66',0],['2026-07-26','2026-07-25T16:54:00Z',74942,'117.62',0],['2026-07-26','2026-07-25T06:05:00Z',72029,'149.59',0],['2026-07-26','2026-07-25T20:23:00Z',41185,'64.60',0],['2026-07-26','2026-07-25T20:41:00Z',73071,'144.09',3547],['2026-07-26','2026-07-25T13:33:00Z',82041,'144.74',7818],['2026-07-26','2026-07-25T07:12:00Z',42906,'65.11',0],['2026-07-26','2026-07-25T19:59:00Z',61044,'112.37',4194],['2026-07-26','2026-07-25T17:21:00Z',74021,'153.41',0],['2026-07-26','2026-07-25T04:05:00Z',104408,'196.25',8506],['2026-07-26','2026-07-25T15:06:00Z',83879,'163.57',0],['2026-07-26','2026-07-25T21:15:00Z',103631,'209.56',3089],['2026-07-26','2026-07-25T21:59:00Z',91185,'177.99',0],
] as const;

test('all 39 audited weekend cases satisfy the narrow date and product rule', () => {
  assert.equal(auditedWeekendCases.length, 39);
  for (const [pilotDate, statementTimestamp, , dieselQuantity, defAmountMinor] of auditedWeekendCases) {
    const quantity = BigInt(dieselQuantity.replace('.', ''));
    assert.equal(quickManageDateRelation(pilotDate, statementTimestamp), 'PILOT_SUNDAY_QUICKMANAGE_SATURDAY');
    assert.equal(corroboratesFuelProducts({ dieselFamilyQuantityHundredths: quantity, defAmountMinor: BigInt(defAmountMinor) }, { dieselFamilyQuantityHundredths: quantity, defAmountMinor: BigInt(defAmountMinor) }), true);
  }
  assert.equal(auditedWeekendCases.reduce((sum, value) => sum + value[2], 0), 2_686_443);
});

test('audited Trucks 8479 and 6011 reconcile Diesel/Reefer classification while DEF stays exact', () => {
  const cases = [
    { truck: '8479', pilot: { dieselFamilyQuantityHundredths: BigInt(8034), defAmountMinor: BigInt(7712) }, statement: { dieselFamilyQuantityHundredths: BigInt(8034), defAmountMinor: BigInt(7712) } },
    { truck: '6011', pilot: { dieselFamilyQuantityHundredths: BigInt(17653), defAmountMinor: BigInt(4231) }, statement: { dieselFamilyQuantityHundredths: BigInt(17653), defAmountMinor: BigInt(4231) } },
    { truck: '6011', pilot: { dieselFamilyQuantityHundredths: BigInt(2805), defAmountMinor: BigInt(3170) }, statement: { dieselFamilyQuantityHundredths: BigInt(2805), defAmountMinor: BigInt(3170) } },
  ];
  assert.deepEqual(cases.map(item => [item.truck, corroboratesFuelProducts(item.pilot, item.statement)]), [['8479', true], ['6011', true], ['6011', true]]);
});

const rootUrl = new URL(process.env.DATABASE_URL!);
const dbName = `fuel_reconciliation_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: rootUrl.toString() });
rootUrl.pathname = `/${dbName}`;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: rootUrl.toString() }) });
const service = new FuelDeductionReconciliationService(db);
let companyId: string, groupId: string, userId: string, sourceId: string, archiveCompanyId: string, conflictCompanyId: string, conflictArchiveCompanyId: string, pilotStatementId: string;
const truckIds: Record<string, string> = {};
const caseEventIds: Record<string, string> = {};
let importRow = 0;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const minor = (value: number) => BigInt(value);

async function importRecord(rawAmount = '0') {
  importRow += 1;
  return db.financialImportRecord.create({ data: { statementId: pilotStatementId, sourceRowIndex: importRow, rawAmount, fingerprintSha256: hash(`${dbName}:${importRow}`) } });
}

async function addEvent(input: { key: string; date: string; truckId?: string | null; unit: string; product?: 'TRUCK_DIESEL' | 'DEF' | 'REEFER_FUEL'; quantity?: string; amount: bigint; retail?: bigint; savings?: bigint; reference?: string }) {
  const invoice = await db.pilotProviderInvoice.create({ data: { operatingGroupId: groupId, sourceId, providerAccountHash: hash('account'), invoiceNumber: `INV-${input.key}`, billingDate: historyDate(input.date), periodStart: historyDate(input.date), periodEnd: historyDate(input.date), invoiceTotalMinor: input.amount, parsedTotalMinor: input.amount, differenceMinor: BigInt(0), status: 'POSTED', parseVersion: 'test', uploadedByUserId: userId, postedByUserId: userId, postedAt: new Date() } });
  const event = await db.pilotFuelingEvent.create({ data: { invoiceId: invoice.id, eventKeyHash: hash(input.key), ticketHash: hash(input.reference ?? `ticket-${input.key}`), authorizationHash: hash(`auth-${input.key}`), cardLastFour: '1234', sourceUnitNumber: input.unit, locationNumber: '100', city: 'Test City', state: 'CA', transactionDate: historyDate(input.date), truckId: input.truckId, truckMatchStatus: input.truckId ? 'MATCHED' : 'UNMATCHED' } });
  const record = await importRecord(input.amount.toString());
  await db.pilotFuelProductLine.create({ data: { invoiceId: invoice.id, eventId: event.id, importRecordId: record.id, lineFingerprint: hash(`line-${input.key}`), sourceLineIdentity: input.key, sourceProductCode: input.product ?? 'DIESEL', productType: input.product ?? 'TRUCK_DIESEL', quantity: input.quantity ?? '20.00', unitPrice: '5.0000000', amountMinor: input.amount, retailAmountMinor: input.retail ?? input.amount, savingsMinor: input.savings ?? BigInt(0) } });
  return event;
}

async function archiveVersion(input: { key: string; pid: string; recipientId: string; recipientType: string; role?: string; workStart: string; workEnd: string; truckId: string | null; unit: string; lineUnit?: string; vin?: string; providerTruckId?: string; duplicateProviderTruck?: boolean; archiveCompanyId?: string; mappingStatus?: string; amount?: bigint; sourceDate?: string; sourceTimestamp?: string; reference?: string; dieselAmount?: string; dieselQuantity?: string; reeferAmount?: string; reeferQuantity?: string; defAmount?: string }) {
  const document = await db.financialStatement.create({ data: { operatingGroupId: groupId, sourceId, type: 'OWNER_SETTLEMENT', periodStart: historyDate(input.workStart), periodEnd: historyDate(input.workEnd), originalFilename: `${input.key}.pdf`, displayFilename: `${input.key}.pdf`, mimeType: 'application/pdf', byteSize: 1, storageKey: `test/${dbName}/${input.key}.pdf`, checksumSha256: hash(`pdf-${input.key}`), importedByUserId: userId } });
  const statement = await db.archiveStatement.create({ data: { archiveCompanyId: input.archiveCompanyId ?? archiveCompanyId, providerStatementId: input.key, latestProviderVersion: 1, acceptedProviderVersion: 1 } });
  return db.$transaction(async tx => {
    const version = await tx.archiveVersion.create({ data: { statementId: statement.id, providerVersion: 1, documentId: document.id, detailStorageKey: `test/${dbName}/${input.key}.json`, detailChecksum: hash(`detail-${input.key}`), pdfChecksum: document.checksumSha256, bundleChecksum: hash(`bundle-${input.key}`), pid: input.pid, recipientId: input.recipientId, recipientName: input.recipientId, recipientType: input.recipientType, role: input.role, workStart: historyDate(input.workStart), workEnd: historyDate(input.workEnd), header: {}, issues: [], parserVersion: 'test', capturedByUserId: userId } });
    await tx.archiveTruck.create({ data: { versionId: version.id, sourceKey: input.unit, providerTruckId: input.providerTruckId, unit: input.unit, vin: input.vin, truckId: input.truckId, mappingStatus: input.mappingStatus ?? 'MATCHED' } });
    if (input.duplicateProviderTruck) await tx.archiveTruck.create({ data: { versionId: version.id, sourceKey: `${input.unit}-duplicate`, providerTruckId: input.providerTruckId, unit: input.unit, vin: input.vin, truckId: input.truckId, mappingStatus: input.mappingStatus ?? 'MATCHED' } });
    if (input.amount !== undefined) await tx.archiveLine.create({ data: { versionId: version.id, kind: 'DEDUCTION', sourceArray: 'fuel_transactions', sourceOrder: 0, providerLineId: input.reference ?? input.key, description: 'Structured Pilot fuel recovery', sourceType: 'fuel', amountMinor: -input.amount, rawAmount: input.amount.toString(), sourceDate: input.sourceDate, reference: input.reference, sourceUnit: input.lineUnit ?? input.unit, included: true, metadata: { type: 'fuel', date: input.sourceTimestamp ?? (input.sourceDate ? `${input.sourceDate}T12:00:00Z` : null), diesel_amount: input.dieselAmount ?? input.amount.toString(), diesel_qty: input.dieselQuantity ?? '20.00', def_amount: input.defAmount ?? '0', reefer_amount: input.reeferAmount ?? '0', reefer_qty: input.reeferQuantity ?? '0', pay_amount: input.amount.toString(), card_number: '991234', merchant: '100', city: 'Test City', state: 'CA' } } });
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
  const conflictCompany = await db.company.create({ data: { name: 'Conflicting archive Company' } }); conflictCompanyId = conflictCompany.id;
  await db.operatingGroupCompany.create({ data: { operatingGroupId: groupId, companyId: conflictCompanyId } });
  const conflictSource = await db.financialSource.create({ data: { operatingGroupId: groupId, companyId: conflictCompanyId, name: 'Conflicting archive', type: 'OWNER_SETTLEMENT', provider: 'QUICKMANAGE' } });
  await db.archiveScopeGrant.create({ data: { operatingGroupId: groupId, companyId: conflictCompanyId, grantedByUserId: userId, reason: 'Synthetic identity-conflict fixture' } });
  conflictArchiveCompanyId = (await db.archiveCompany.create({ data: { operatingGroupId: groupId, companyId: conflictCompanyId, sourceId: conflictSource.id, accountKey: 'conflict', providerCompanyId: 'conflict-company', providerCompanyName: conflictCompany.name } })).id;
  pilotStatementId = (await db.financialStatement.create({ data: { operatingGroupId: groupId, sourceId, type: 'FUEL_STATEMENT', periodStart: historyDate('2026-04-01'), periodEnd: historyDate('2026-08-31'), originalFilename: 'pilot.csv', displayFilename: 'pilot.csv', mimeType: 'text/csv', byteSize: 1, storageKey: `test/${dbName}/pilot.csv`, checksumSha256: hash('pilot-document'), importedByUserId: userId } })).id;
  const history = new TruckCompanyHistoryService(db);
  for (const [name, withHistory] of [['exact', true], ['driver', true], ['timing', true], ['unknown', false], ['weekend', true], ['crossExpected', true], ['crossActual', true], ['product', true], ['ambiguous', true], ['identityConflict', true]] as const) {
    const truck = await db.truck.create({ data: { companyId, unitNumber: `UNIT-${name.toUpperCase()}`, unitNumberNormalized: `UNIT-${name.toUpperCase()}` } }); truckIds[name] = truck.id;
    if (withHistory) await history.change(truck.id, { action: 'CONFIRM', expectedRevisionId: null, source: 'MANUAL_CONFIRMATION', sourceReference: 'Synthetic fixture', reason: 'Synthetic fixture', periods: [{ companyId, effectiveFrom: '2026-01-01', effectiveTo: '2026-10-01' }] }, userId);
  }
  await db.fuelDeductionPolicy.createMany({ data: [
    { operatingGroupId: groupId, companyId, truckId: truckIds.exact, providerRecipientId: 'contractor-exact', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic full pass through', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.timing, providerRecipientId: 'contractor-timing', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic timing policy', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.weekend, providerRecipientId: 'contractor-weekend', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic weekend policy', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.crossExpected, providerRecipientId: 'contractor-expected', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic recipient policy', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.product, providerRecipientId: 'contractor-product', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic product policy', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.ambiguous, providerRecipientId: 'contractor-ambiguous', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic ambiguity policy', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.identityConflict, providerRecipientId: 'contractor-identity', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic identity-conflict policy', reason: 'Fixture', approvedByUserId: userId },
  ] });
  await addEvent({ key: 'exact', date: '2026-06-10', truckId: truckIds.exact, unit: 'UNIT-EXACT', product: 'TRUCK_DIESEL', amount: minor(10_000), retail: minor(12_000), savings: minor(2_000) });
  await archiveVersion({ key: 'exact-driver', pid: '10', recipientId: 'driver-pair', recipientType: 'DRIVER', workStart: '2026-06-08', workEnd: '2026-06-15', truckId: truckIds.exact, unit: 'UNIT-EXACT', amount: minor(10_005), sourceDate: '2026-06-10', reference: 'paired-ref' });
  await archiveVersion({ key: 'exact-contractor', pid: '10', recipientId: 'contractor-exact', recipientType: 'CONTRACTOR', workStart: '2026-06-08', workEnd: '2026-06-15', truckId: truckIds.exact, unit: 'UNIT-EXACT', amount: minor(10_005), sourceDate: '2026-06-10', reference: 'paired-ref' });
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
  caseEventIds.weekend = (await addEvent({ key: 'weekend', date: '2026-07-12', truckId: truckIds.weekend, unit: 'UNIT-WEEKEND', amount: minor(8_000) })).id;
  await archiveVersion({ key: 'weekend-line', pid: '28', recipientId: 'contractor-weekend', recipientType: 'CONTRACTOR', workStart: '2026-07-05', workEnd: '2026-07-11', truckId: truckIds.weekend, unit: 'UNIT-WEEKEND', amount: minor(8_000), sourceDate: '2026-07-11', sourceTimestamp: '2026-07-11T13:25:00Z' });
  caseEventIds.cross = (await addEvent({ key: 'cross', date: '2026-07-14', truckId: truckIds.crossExpected, unit: 'UNIT-CROSSEXPECTED', amount: minor(9_000) })).id;
  await archiveVersion({ key: 'cross-assignment', pid: '29', recipientId: 'contractor-expected', recipientType: 'CONTRACTOR', workStart: '2026-07-12', workEnd: '2026-07-18', truckId: truckIds.crossExpected, unit: 'UNIT-CROSSEXPECTED' });
  await archiveVersion({ key: 'cross-line', pid: '29', recipientId: 'contractor-actual', recipientType: 'CONTRACTOR', workStart: '2026-07-12', workEnd: '2026-07-18', truckId: truckIds.crossActual, unit: 'UNIT-CROSSACTUAL', amount: minor(9_000), sourceDate: '2026-07-14' });
  caseEventIds.crossSep21 = (await addEvent({ key: 'cross-sep21', date: '2026-09-21', truckId: truckIds.crossExpected, unit: 'UNIT-CROSSEXPECTED', amount: minor(9_100) })).id;
  await archiveVersion({ key: 'cross-sep21-assignment', pid: '38', recipientId: 'contractor-expected', recipientType: 'CONTRACTOR', workStart: '2026-09-20', workEnd: '2026-09-26', truckId: truckIds.crossExpected, unit: 'UNIT-CROSSEXPECTED' });
  await archiveVersion({ key: 'cross-sep21-line', pid: '38', recipientId: 'contractor-actual', recipientType: 'CONTRACTOR', workStart: '2026-09-20', workEnd: '2026-09-26', truckId: truckIds.crossActual, unit: 'UNIT-CROSSACTUAL', amount: minor(9_100), sourceDate: '2026-09-21' });
  caseEventIds.crossSep22 = (await addEvent({ key: 'cross-sep22', date: '2026-09-22', truckId: truckIds.crossExpected, unit: 'UNIT-CROSSEXPECTED', amount: minor(9_200) })).id;
  await archiveVersion({ key: 'cross-sep22-line', pid: '38', recipientId: 'contractor-actual', recipientType: 'CONTRACTOR', workStart: '2026-09-20', workEnd: '2026-09-26', truckId: truckIds.crossActual, unit: 'UNIT-CROSSACTUAL', amount: minor(9_200), sourceDate: '2026-09-22' });
  caseEventIds.crossSep23 = (await addEvent({ key: 'cross-sep23', date: '2026-09-23', truckId: truckIds.crossExpected, unit: 'UNIT-CROSSEXPECTED', amount: minor(9_300) })).id;
  await archiveVersion({ key: 'cross-sep23-line', pid: '38', recipientId: 'contractor-actual', recipientType: 'CONTRACTOR', workStart: '2026-09-20', workEnd: '2026-09-26', truckId: truckIds.crossActual, unit: 'UNIT-CROSSACTUAL', amount: minor(9_300), sourceDate: '2026-09-23' });
  caseEventIds.product = (await addEvent({ key: 'product', date: '2026-07-15', truckId: truckIds.product, unit: 'UNIT-PRODUCT', amount: minor(7_000) })).id;
  await archiveVersion({ key: 'product-line', pid: '29', recipientId: 'contractor-product', recipientType: 'CONTRACTOR', workStart: '2026-07-12', workEnd: '2026-07-18', truckId: truckIds.product, unit: 'UNIT-PRODUCT', amount: minor(8_500), sourceDate: '2026-07-15', dieselQuantity: '28.05' });
  caseEventIds.dieselToReefer = (await addEvent({ key: 'diesel-to-reefer', date: '2026-08-10', truckId: truckIds.product, unit: 'UNIT-PRODUCT', product: 'TRUCK_DIESEL', quantity: '20.00', amount: minor(7_000) })).id;
  await archiveVersion({ key: 'diesel-to-reefer-line', pid: '32', recipientId: 'contractor-product', recipientType: 'CONTRACTOR', workStart: '2026-08-09', workEnd: '2026-08-15', truckId: truckIds.product, unit: 'UNIT-PRODUCT', amount: minor(7_000), sourceDate: '2026-08-10', dieselAmount: '0', dieselQuantity: '0', reeferAmount: '70.00', reeferQuantity: '20.00' });
  caseEventIds.reeferToDiesel = (await addEvent({ key: 'reefer-to-diesel', date: '2026-08-11', truckId: truckIds.product, unit: 'UNIT-PRODUCT', product: 'REEFER_FUEL', quantity: '20.00', amount: minor(7_100) })).id;
  await archiveVersion({ key: 'reefer-to-diesel-line', pid: '32', recipientId: 'contractor-product', recipientType: 'CONTRACTOR', workStart: '2026-08-09', workEnd: '2026-08-15', truckId: truckIds.product, unit: 'UNIT-PRODUCT', amount: minor(7_100), sourceDate: '2026-08-11', dieselAmount: '71.00', dieselQuantity: '20.00' });
  caseEventIds.defMismatch = (await addEvent({ key: 'def-mismatch', date: '2026-08-12', truckId: truckIds.product, unit: 'UNIT-PRODUCT', product: 'DEF', quantity: '6.00', amount: minor(3_000) })).id;
  await archiveVersion({ key: 'def-mismatch-line', pid: '32', recipientId: 'contractor-product', recipientType: 'CONTRACTOR', workStart: '2026-08-09', workEnd: '2026-08-15', truckId: truckIds.product, unit: 'UNIT-PRODUCT', amount: minor(3_000), sourceDate: '2026-08-12', dieselAmount: '0', dieselQuantity: '0', defAmount: '40.00' });
  caseEventIds.dieselToDef = (await addEvent({ key: 'diesel-to-def', date: '2026-08-13', truckId: truckIds.product, unit: 'UNIT-PRODUCT', product: 'TRUCK_DIESEL', quantity: '6.00', amount: minor(3_100) })).id;
  await archiveVersion({ key: 'diesel-to-def-line', pid: '32', recipientId: 'contractor-product', recipientType: 'CONTRACTOR', workStart: '2026-08-09', workEnd: '2026-08-15', truckId: truckIds.product, unit: 'UNIT-PRODUCT', amount: minor(3_100), sourceDate: '2026-08-13', dieselAmount: '0', dieselQuantity: '0', defAmount: '31.00' });
  caseEventIds.reeferToDef = (await addEvent({ key: 'reefer-to-def', date: '2026-08-14', truckId: truckIds.product, unit: 'UNIT-PRODUCT', product: 'REEFER_FUEL', quantity: '6.00', amount: minor(3_200) })).id;
  await archiveVersion({ key: 'reefer-to-def-line', pid: '32', recipientId: 'contractor-product', recipientType: 'CONTRACTOR', workStart: '2026-08-09', workEnd: '2026-08-15', truckId: truckIds.product, unit: 'UNIT-PRODUCT', amount: minor(3_200), sourceDate: '2026-08-14', dieselAmount: '0', dieselQuantity: '0', defAmount: '32.00' });
  caseEventIds.ambiguous = (await addEvent({ key: 'ambiguous', date: '2026-07-19', truckId: truckIds.ambiguous, unit: 'UNIT-AMBIGUOUS', amount: minor(6_000) })).id;
  await archiveVersion({ key: 'ambiguous-one', pid: '29', recipientId: 'contractor-ambiguous', recipientType: 'CONTRACTOR', workStart: '2026-07-12', workEnd: '2026-07-18', truckId: truckIds.ambiguous, unit: 'UNIT-AMBIGUOUS', amount: minor(6_000), sourceDate: '2026-07-18', sourceTimestamp: '2026-07-18T10:00:00Z' });
  await archiveVersion({ key: 'ambiguous-two', pid: '29', recipientId: 'contractor-ambiguous', recipientType: 'CONTRACTOR', workStart: '2026-07-12', workEnd: '2026-07-18', truckId: truckIds.ambiguous, unit: 'UNIT-AMBIGUOUS', amount: minor(6_000), sourceDate: '2026-07-18', sourceTimestamp: '2026-07-18T11:00:00Z' });
  await archiveVersion({ key: 'ambiguous-assignment', pid: '30', recipientId: 'contractor-ambiguous', recipientType: 'CONTRACTOR', workStart: '2026-07-19', workEnd: '2026-07-25', truckId: truckIds.ambiguous, unit: 'UNIT-AMBIGUOUS' });
  caseEventIds.identityConflict = (await addEvent({ key: 'identity-conflict', date: '2026-07-26', truckId: truckIds.identityConflict, unit: 'UNIT-IDENTITYCONFLICT', amount: minor(6_325), quantity: '20.00' })).id;
  await archiveVersion({ key: 'identity-assignment', pid: '31', recipientId: 'contractor-identity', recipientType: 'CONTRACTOR', workStart: '2026-07-26', workEnd: '2026-08-01', truckId: truckIds.identityConflict, unit: 'UNIT-IDENTITYCONFLICT' });
  await archiveVersion({ key: 'identity-conflicting-line', pid: '30', recipientId: 'contractor-conflicting', recipientType: 'CONTRACTOR', workStart: '2026-07-19', workEnd: '2026-07-25', truckId: null, unit: 'UNIT-IDENTITYCONFLICT', archiveCompanyId: conflictArchiveCompanyId, mappingStatus: 'NEEDS_REVIEW', amount: minor(6_325), sourceDate: '2026-07-25', sourceTimestamp: '2026-07-25T23:44:00Z', dieselQuantity: '20.00' });
  const invoice = await db.pilotProviderInvoice.findFirstOrThrow(); const record = await importRecord('-28.59');
  await db.pilotInvoiceAdjustment.create({ data: { invoiceId: invoice.id, importRecordId: record.id, fingerprint: hash('credit'), sourceLineIdentity: 'credit', description: 'Provider credit', signedAmountMinor: BigInt(-2859) } });
});

after(async () => { await db.$disconnect(); await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`); await admin.end(); });

test('full preview covers matching, timing, coverage, responsibility, history, mapping and exclusions without economic writes', async () => {
  const context = { userId, activeCompanyId: companyId, operatingGroupId: groupId, role: 'OWNER' as const, companyIds: [companyId] };
  const protectedBefore = [await db.financialTransaction.count(), await db.financialExpectation.count(), await db.financialAllocation.count(), await db.financialExpectationBankMatch.count()];
  const result = await service.preview(context);
  assert.deepEqual(result.coverage, { start: '2026-04-22', end: '2026-09-23' });
  assert.equal(result.summary.reeferExcludedMinor, BigInt(0)); assert.equal(result.summary.providerCreditExcludedMinor, BigInt(-2859));
  const exact = result.rows.find(row => row.pilotEventId && row.truckId === truckIds.exact && row.purchaseDate === '2026-06-10')!;
  assert.equal(exact.status, 'MATCHED'); assert.equal(exact.expectedMinor, minor(10_000)); assert.equal(exact.statementMinor, minor(10_005)); assert.equal(exact.differenceMinor, minor(5)); assert.equal(exact.statementEvidence?.lineIds.length, 2); assert.equal(exact.recipientId, 'contractor-exact');
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

test('preview resolves the weekend provider boundary and fails closed for recipient, product, Company identity and ambiguous evidence', async () => {
  const context = { userId, activeCompanyId: companyId, operatingGroupId: groupId, role: 'OWNER' as const, companyIds: [companyId, conflictCompanyId] };
  const result = await service.preview(context, { pageSize: 10000 });
  const weekend = result.rows.find(row => row.pilotEventId === caseEventIds.weekend)!;
  assert.equal(weekend.status, 'MATCHED'); assert.equal(weekend.matchMethod, 'PILOT_SUNDAY_QUICKMANAGE_SATURDAY'); assert.equal(weekend.statementMinor, minor(8_000));
  const cross = result.rows.find(row => row.pilotEventId === caseEventIds.cross)!;
  assert.equal(cross.status, 'MATCHED'); assert.equal(cross.matchMethod, 'HISTORICAL_CROSS_RECIPIENT_RECOVERED'); assert.equal(cross.statementMinor, minor(9_000));
  assert.equal(cross.statementTruckUnit, 'UNIT-CROSSACTUAL'); assert.equal(cross.statementRecipientId, 'contractor-actual');
  const crossSep21 = result.rows.find(row => row.pilotEventId === caseEventIds.crossSep21)!;
  assert.equal(crossSep21.status, 'MATCHED'); assert.equal(crossSep21.matchMethod, 'HISTORICAL_CROSS_RECIPIENT_RECOVERED'); assert.equal(crossSep21.differenceMinor, BigInt(0));
  const crossSep22 = result.rows.find(row => row.pilotEventId === caseEventIds.crossSep22)!;
  assert.equal(crossSep22.status, 'NEEDS_RECIPIENT_REVIEW'); assert.equal(crossSep22.matchMethod, 'CROSS_RECIPIENT_STRUCTURED_IDENTITY'); assert.equal(crossSep22.differenceMinor, null);
  const crossSep23 = result.rows.find(row => row.pilotEventId === caseEventIds.crossSep23)!;
  assert.equal(crossSep23.status, 'NEEDS_RECIPIENT_REVIEW'); assert.equal(crossSep23.matchMethod, 'CROSS_RECIPIENT_STRUCTURED_IDENTITY'); assert.equal(crossSep23.differenceMinor, null);
  const product = result.rows.find(row => row.pilotEventId === caseEventIds.product)!;
  assert.equal(product.status, 'PRODUCT_CLASSIFICATION_REVIEW'); assert.equal(product.matchMethod, 'PRODUCT_CLASSIFICATION_CONFLICT'); assert.equal(product.differenceMinor, null);
  const dieselToReefer = result.rows.find(row => row.pilotEventId === caseEventIds.dieselToReefer)!;
  assert.equal(dieselToReefer.status, 'MATCHED'); assert.equal(dieselToReefer.matchMethod, 'DIESEL_REEFER_CLASSIFICATION_ACCEPTED'); assert.deepEqual(dieselToReefer.statementProducts, ['REEFER_FUEL']);
  const reeferToDiesel = result.rows.find(row => row.pilotEventId === caseEventIds.reeferToDiesel)!;
  assert.equal(reeferToDiesel.status, 'MATCHED'); assert.equal(reeferToDiesel.matchMethod, 'DIESEL_REEFER_CLASSIFICATION_ACCEPTED'); assert.deepEqual(reeferToDiesel.statementProducts, ['TRUCK_DIESEL']);
  const defMismatch = result.rows.find(row => row.pilotEventId === caseEventIds.defMismatch)!;
  assert.equal(defMismatch.status, 'PRODUCT_CLASSIFICATION_REVIEW'); assert.equal(defMismatch.matchMethod, 'PRODUCT_CLASSIFICATION_CONFLICT');
  const dieselToDef = result.rows.find(row => row.pilotEventId === caseEventIds.dieselToDef)!;
  assert.equal(dieselToDef.status, 'PRODUCT_CLASSIFICATION_REVIEW'); assert.equal(dieselToDef.matchMethod, 'PRODUCT_CLASSIFICATION_CONFLICT');
  const reeferToDef = result.rows.find(row => row.pilotEventId === caseEventIds.reeferToDef)!;
  assert.equal(reeferToDef.status, 'PRODUCT_CLASSIFICATION_REVIEW'); assert.equal(reeferToDef.matchMethod, 'PRODUCT_CLASSIFICATION_CONFLICT');
  const ambiguous = result.rows.find(row => row.pilotEventId === caseEventIds.ambiguous)!;
  assert.equal(ambiguous.status, 'NEEDS_REVIEW'); assert.equal(ambiguous.matchMethod, 'INSUFFICIENT_TRUCK_DATE_CORROBORATION'); assert.equal(ambiguous.statementEvidence, null);
  const identityConflict = result.rows.find(row => row.pilotEventId === caseEventIds.identityConflict)!;
  assert.equal(identityConflict.status, 'NEEDS_REVIEW'); assert.equal(identityConflict.matchMethod, 'CROSS_COMPANY_IDENTITY_REVIEW');
  assert.equal(identityConflict.statementMinor, minor(6_325)); assert.equal(identityConflict.differenceMinor, null);
  assert.equal(identityConflict.statementTruckUnit, 'UNIT-IDENTITYCONFLICT'); assert.equal(identityConflict.statementRecipientId, 'contractor-conflicting');
  assert.equal(result.rows.some(row => row.key.startsWith('statement:') && row.statementEvidence?.lineIds.some(id => identityConflict.statementEvidence?.lineIds.includes(id))), false);
  const consumedIds = result.rows.flatMap(row => row.statementEvidence?.lineIds ?? []);
  assert.equal(new Set(consumedIds).size, consumedIds.length);
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

test('OWNER can add an audited provider identity mapping only from repeated exact immutable fuel evidence', async () => {
  const context = { userId, activeCompanyId: companyId, operatingGroupId: groupId, role: 'OWNER' as const, companyIds: [companyId] };
  const providerTruckId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const vin = '1M8GDM9AXKP042788';
  const truck = await db.truck.create({ data: { companyId, unitNumber: 'UNIT-MAP', unitNumberNormalized: 'UNIT-MAP', vin, vinNormalized: vin } });
  const eventOne = await addEvent({ key: 'mapping-one', date: '2026-08-20', truckId: truck.id, unit: 'UNIT-MAP', quantity: '20.00', amount: minor(7_000) });
  const eventTwo = await addEvent({ key: 'mapping-two', date: '2026-08-21', truckId: truck.id, unit: 'UNIT-MAP', quantity: '20.00', amount: minor(7_100) });
  const versionOne = await archiveVersion({ key: 'mapping-one', pid: '34', recipientId: 'mapping-recipient', recipientType: 'CONTRACTOR', workStart: '2026-08-16', workEnd: '2026-08-22', truckId: null, providerTruckId, unit: 'UNIT-MAP', vin, mappingStatus: 'NEEDS_REVIEW', amount: minor(7_000), sourceDate: '2026-08-20', dieselQuantity: '20.00' });
  const versionTwo = await archiveVersion({ key: 'mapping-two', pid: '34', recipientId: 'mapping-recipient', recipientType: 'CONTRACTOR', workStart: '2026-08-16', workEnd: '2026-08-22', truckId: null, providerTruckId, duplicateProviderTruck: true, unit: 'UNIT-MAP', vin, mappingStatus: 'NEEDS_REVIEW', amount: minor(7_100), sourceDate: '2026-08-21', dieselQuantity: '20.00' });
  const [lineOne, lineTwo] = await Promise.all([
    db.archiveLine.findFirstOrThrow({ where: { versionId: versionOne.id } }),
    db.archiveLine.findFirstOrThrow({ where: { versionId: versionTwo.id } }),
  ]);
  const evidenceReferences = [
    { pilotEventId: eventOne.id, statementVersionId: versionOne.id, statementLineIds: [lineOne.id] },
    { pilotEventId: eventTwo.id, statementVersionId: versionTwo.id, statementLineIds: [lineTwo.id] },
  ];
  const request = { providerTruckId, truckId: truck.id, sourceReference: 'Two exact Pilot and immutable QuickManage fuel identities.', reason: 'Stable provider UUID and repeated exact card, location, date, product, and unit evidence.', evidenceReferences };
  const archiveBefore = await db.archiveTruck.findMany({ where: { providerTruckId }, orderBy: { id: 'asc' } });
  const canonicalBefore = await db.truck.findUniqueOrThrow({ where: { id: truck.id } });
  const economicsBefore = [await db.financialTransaction.count(), await db.financialAllocation.count(), await db.financialExpectation.count(), await db.financialExpectationBankMatch.count(), await db.fuelDeductionPolicy.count(), await db.pilotFuelingEvent.count(), await db.archiveLine.count()];
  const auditBefore = await db.financialAuditEvent.count({ where: { action: 'HISTORICAL_TRUCK_MAPPING_CREATED', actorUserId: userId } });
  const [mapping, retry] = await Promise.all([service.createHistoricalTruckMapping(request, context), service.createHistoricalTruckMapping(request, context)]);
  assert.equal(mapping.truckId, truck.id); assert.equal(retry.id, mapping.id);
  assert.equal((await service.createHistoricalTruckMapping(request, context)).id, mapping.id);
  assert.equal(await db.historicalTruckMapping.count({ where: { providerTruckId } }), 1);
  assert.equal(await db.financialAuditEvent.count({ where: { action: 'HISTORICAL_TRUCK_MAPPING_CREATED', actorUserId: userId } }), auditBefore + 1);
  assert.deepEqual(await db.archiveTruck.findMany({ where: { providerTruckId }, orderBy: { id: 'asc' } }), archiveBefore);
  assert.deepEqual(await db.truck.findUniqueOrThrow({ where: { id: truck.id } }), canonicalBefore);
  assert.deepEqual([await db.financialTransaction.count(), await db.financialAllocation.count(), await db.financialExpectation.count(), await db.financialExpectationBankMatch.count(), await db.fuelDeductionPolicy.count(), await db.pilotFuelingEvent.count(), await db.archiveLine.count()], economicsBefore);
  const mappedRows = (await service.preview(context, { truck: 'UNIT-MAP', pageSize: 10000 })).rows.filter(row => row.truckId === truck.id);
  assert.equal(mappedRows.some(row => row.status === 'NEEDS_TRUCK_MAPPING'), false);
  assert.equal(mappedRows.some(row => row.status === 'NEEDS_COMPANY_HISTORY'), true);
  await assert.rejects(db.historicalTruckMapping.update({ where: { id: mapping.id }, data: { reason: 'Tampered mapping' } }));
  await assert.rejects(db.historicalTruckMapping.delete({ where: { id: mapping.id } }));
  await assert.rejects(service.createHistoricalTruckMapping({ providerTruckId, truckId: truck.id, sourceReference: 'Duplicate mapping attempt.', reason: 'Must remain unique and fail closed.', evidenceReferences }, context));
  await assert.rejects(service.createHistoricalTruckMapping({ providerTruckId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', truckId: truck.id, sourceReference: 'Insufficient evidence attempt.', reason: 'Must require repeated immutable corroboration.', evidenceReferences: evidenceReferences.slice(0, 1) }, context));

  const member = await db.user.create({ data: { email: `${dbName}-mapping-member@example.test`, displayName: 'Mapping member', activeCompanyId: companyId, memberships: { create: { companyId, role: 'MEMBER' } }, operatingGroupMemberships: { create: { operatingGroupId: groupId, role: 'MEMBER' } } } });
  await assert.rejects(service.createHistoricalTruckMapping(request, { ...context, userId: member.id, role: 'OWNER' }));
  const inactive = await db.user.create({ data: { email: `${dbName}-mapping-inactive@example.test`, displayName: 'Inactive mapping owner', activeCompanyId: companyId, isActive: false, memberships: { create: { companyId, role: 'OWNER' } }, operatingGroupMemberships: { create: { operatingGroupId: groupId, role: 'OWNER' } } } });
  await assert.rejects(service.createHistoricalTruckMapping(request, { ...context, userId: inactive.id }));
  const revoked = await db.user.create({ data: { email: `${dbName}-mapping-revoked@example.test`, displayName: 'Revoked mapping owner', activeCompanyId: companyId, operatingGroupMemberships: { create: { operatingGroupId: groupId, role: 'OWNER' } } } });
  await assert.rejects(service.createHistoricalTruckMapping(request, { ...context, userId: revoked.id }));
  await assert.rejects(service.createHistoricalTruckMapping(request, { ...context, operatingGroupId: 'outside-group' }));

  const repeatedEvent = await addEvent({ key: 'mapping-repeated-line', date: '2026-08-20', truckId: truck.id, unit: 'UNIT-MAP', quantity: '20.00', amount: minor(7_000) });
  await assert.rejects(service.createHistoricalTruckMapping({ ...request, providerTruckId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', evidenceReferences: [evidenceReferences[0], { pilotEventId: repeatedEvent.id, statementVersionId: versionOne.id, statementLineIds: [lineOne.id] }] }, context));

  const conflictVin = '1M8GDM9AXKP042789';
  const vinProviderId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const canonicalConflictVin = `TESTVIN${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
  const vinTruck = await db.truck.create({ data: { companyId, unitNumber: 'UNIT-VIN', unitNumberNormalized: 'UNIT-VIN', vin: canonicalConflictVin, vinNormalized: canonicalConflictVin } });
  const vinEventOne = await addEvent({ key: 'vin-conflict-one', date: '2026-08-22', truckId: vinTruck.id, unit: 'UNIT-VIN', amount: minor(7_200) });
  const vinEventTwo = await addEvent({ key: 'vin-conflict-two', date: '2026-08-23', truckId: vinTruck.id, unit: 'UNIT-VIN', amount: minor(7_300) });
  const vinVersionOne = await archiveVersion({ key: 'vin-conflict-one', pid: '35', recipientId: 'vin-conflict', recipientType: 'CONTRACTOR', workStart: '2026-08-22', workEnd: '2026-08-24', truckId: null, providerTruckId: vinProviderId, unit: 'UNIT-VIN', vin: conflictVin, mappingStatus: 'NEEDS_REVIEW', amount: minor(7_200), sourceDate: '2026-08-22' });
  const vinVersionTwo = await archiveVersion({ key: 'vin-conflict-two', pid: '35', recipientId: 'vin-conflict', recipientType: 'CONTRACTOR', workStart: '2026-08-22', workEnd: '2026-08-24', truckId: null, providerTruckId: vinProviderId, unit: 'UNIT-VIN', vin: conflictVin, mappingStatus: 'NEEDS_REVIEW', amount: minor(7_300), sourceDate: '2026-08-23' });
  const vinLines = await db.archiveLine.findMany({ where: { versionId: { in: [vinVersionOne.id, vinVersionTwo.id] } }, orderBy: { sourceDate: 'asc' } });
  await assert.rejects(service.createHistoricalTruckMapping({ providerTruckId: vinProviderId, truckId: vinTruck.id, sourceReference: 'Conflicting archived VIN evidence.', reason: 'Physical identity contradiction must fail closed.', evidenceReferences: [{ pilotEventId: vinEventOne.id, statementVersionId: vinVersionOne.id, statementLineIds: [vinLines[0].id] }, { pilotEventId: vinEventTwo.id, statementVersionId: vinVersionTwo.id, statementLineIds: [vinLines[1].id] }] }, context));
  assert.equal(await db.historicalTruckMapping.count({ where: { providerTruckId: vinProviderId } }), 0);

  const wrongLineProviderId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const wrongLineTruck = await db.truck.create({ data: { companyId, unitNumber: 'UNIT-LINE', unitNumberNormalized: 'UNIT-LINE' } });
  const wrongEventOne = await addEvent({ key: 'wrong-line-one', date: '2026-08-24', truckId: wrongLineTruck.id, unit: 'UNIT-LINE', amount: minor(7_400) });
  const wrongEventTwo = await addEvent({ key: 'wrong-line-two', date: '2026-08-25', truckId: wrongLineTruck.id, unit: 'UNIT-LINE', amount: minor(7_500) });
  const wrongVersionOne = await archiveVersion({ key: 'wrong-line-one', pid: '36', recipientId: 'wrong-line', recipientType: 'CONTRACTOR', workStart: '2026-08-24', workEnd: '2026-08-26', truckId: null, providerTruckId: wrongLineProviderId, unit: 'UNIT-LINE', lineUnit: 'ANOTHER-TRUCK', mappingStatus: 'NEEDS_REVIEW', amount: minor(7_400), sourceDate: '2026-08-24' });
  const wrongVersionTwo = await archiveVersion({ key: 'wrong-line-two', pid: '36', recipientId: 'wrong-line', recipientType: 'CONTRACTOR', workStart: '2026-08-24', workEnd: '2026-08-26', truckId: null, providerTruckId: wrongLineProviderId, unit: 'UNIT-LINE', lineUnit: 'ANOTHER-TRUCK', mappingStatus: 'NEEDS_REVIEW', amount: minor(7_500), sourceDate: '2026-08-25' });
  const wrongLines = await db.archiveLine.findMany({ where: { versionId: { in: [wrongVersionOne.id, wrongVersionTwo.id] } }, orderBy: { sourceDate: 'asc' } });
  await assert.rejects(service.createHistoricalTruckMapping({ providerTruckId: wrongLineProviderId, truckId: wrongLineTruck.id, sourceReference: 'Statement versions contain multiple Trucks.', reason: 'Lines from another source unit must not prove identity.', evidenceReferences: [{ pilotEventId: wrongEventOne.id, statementVersionId: wrongVersionOne.id, statementLineIds: [wrongLines[0].id] }, { pilotEventId: wrongEventTwo.id, statementVersionId: wrongVersionTwo.id, statementLineIds: [wrongLines[1].id] }] }, context));

  await db.companyMembership.create({ data: { userId, companyId: conflictCompanyId, role: 'OWNER' } });
  const collisionProviderId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const collisionTruck = await db.truck.create({ data: { companyId, unitNumber: 'UNIT-COLLISION', unitNumberNormalized: 'UNIT-COLLISION' } });
  await db.truck.create({ data: { companyId: conflictCompanyId, unitNumber: 'UNIT-COLLISION', unitNumberNormalized: 'UNIT-COLLISION' } });
  await archiveVersion({ key: 'unit-collision-one', pid: '36', recipientId: 'unit-collision', recipientType: 'CONTRACTOR', workStart: '2026-08-24', workEnd: '2026-08-26', truckId: null, providerTruckId: collisionProviderId, unit: 'UNIT-COLLISION', mappingStatus: 'NEEDS_REVIEW' });
  await assert.rejects(service.createHistoricalTruckMapping({ providerTruckId: collisionProviderId, truckId: collisionTruck.id, sourceReference: 'Unit label without unique physical identity.', reason: 'A same-unit canonical collision must fail closed.', evidenceReferences: [{ pilotEventId: wrongEventOne.id, statementVersionId: wrongVersionOne.id, statementLineIds: [wrongLines[0].id] }, { pilotEventId: wrongEventTwo.id, statementVersionId: wrongVersionTwo.id, statementLineIds: [wrongLines[1].id] }] }, { ...context, companyIds: [companyId, conflictCompanyId] }));

  const historicalProviderId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const historicalTruck = await db.truck.create({ data: { companyId, unitNumber: 'UNIT-HISTORY', unitNumberNormalized: 'UNIT-HISTORY' } });
  const historicalEventOne = await addEvent({ key: 'historical-company-one', date: '2026-08-26', truckId: historicalTruck.id, unit: 'UNIT-HISTORY', amount: minor(7_600) });
  const historicalEventTwo = await addEvent({ key: 'historical-company-two', date: '2026-08-27', truckId: historicalTruck.id, unit: 'UNIT-HISTORY', amount: minor(7_700) });
  const historicalVersionOne = await archiveVersion({ key: 'historical-company-one', pid: '37', recipientId: 'historical-company', recipientType: 'CONTRACTOR', workStart: '2026-08-26', workEnd: '2026-08-28', truckId: null, providerTruckId: historicalProviderId, unit: 'UNIT-HISTORY', archiveCompanyId: conflictArchiveCompanyId, mappingStatus: 'NEEDS_REVIEW', amount: minor(7_600), sourceDate: '2026-08-26' });
  const historicalVersionTwo = await archiveVersion({ key: 'historical-company-two', pid: '37', recipientId: 'historical-company', recipientType: 'CONTRACTOR', workStart: '2026-08-26', workEnd: '2026-08-28', truckId: null, providerTruckId: historicalProviderId, unit: 'UNIT-HISTORY', archiveCompanyId: conflictArchiveCompanyId, mappingStatus: 'NEEDS_REVIEW', amount: minor(7_700), sourceDate: '2026-08-27' });
  const historicalLines = await db.archiveLine.findMany({ where: { versionId: { in: [historicalVersionOne.id, historicalVersionTwo.id] } }, orderBy: { sourceDate: 'asc' } });
  const historicalMapping = await service.createHistoricalTruckMapping({ providerTruckId: historicalProviderId, truckId: historicalTruck.id, sourceReference: 'Historical source Company differs from current Company.', reason: 'Repeated exact physical identity evidence supports this link.', evidenceReferences: [{ pilotEventId: historicalEventOne.id, statementVersionId: historicalVersionOne.id, statementLineIds: [historicalLines[0].id] }, { pilotEventId: historicalEventTwo.id, statementVersionId: historicalVersionTwo.id, statementLineIds: [historicalLines[1].id] }] }, { ...context, companyIds: [companyId, conflictCompanyId] });
  assert.equal(historicalMapping.truckId, historicalTruck.id);
  assert.equal((await db.truck.findUniqueOrThrow({ where: { id: historicalTruck.id } })).companyId, companyId);
});

test('audited policy revision preserves identity/history, enforces authority and concurrency, and posts no economics', async () => {
  const context = { userId, activeCompanyId: companyId, operatingGroupId: groupId, role: 'OWNER' as const, companyIds: [companyId] };
  const revisionService = new FuelDeductionReconciliationService(db);
  const recipientId = 'revision-recipient';
  const provenanceEvent = await db.pilotFuelingEvent.findFirstOrThrow();
  const provenanceVersion = await db.archiveVersion.findFirstOrThrow({ where: { sealed: true, lines: { some: {} } }, include: { lines: { take: 1 } } });
  const row = (date: string): FuelReconciliationRow => ({
    key: `revision-${date}`, status: 'NEEDS_POLICY', companyId, companyName: 'Synthetic reconciliation Company', pid: 'revision', purchaseDate: date,
    statementPeriod: date, truckId: truckIds.driver, truckUnit: 'UNIT-DRIVER', recipientId, recipientName: 'Revision recipient', responsibility: 'RECIPIENT',
    pilotEventId: provenanceEvent.id, pilotInvoiceId: 'invoice', pilotInvoiceNumber: 'revision', pilotActualMinor: BigInt(1000), pilotRetailMinor: BigInt(1100), pilotSavingsMinor: BigInt(100),
    expectedMinor: null, statementMinor: BigInt(1010), differenceMinor: null, observedAmountDeltaMinor: null, retainedDiscountMinor: null, policyId: null, policyLabel: null,
    historicalCompanyId: companyId, postedCompanyId: companyId, postedCompanyName: 'Synthetic reconciliation Company', currentCompanyId: companyId, currentCompanyName: 'Synthetic reconciliation Company', historyDiffersFromPosted: false,
    products: ['TRUCK_DIESEL'], gallons: '2.00', matchMethod: 'STRUCTURED_IDENTITY', statementTruckUnit: 'UNIT-DRIVER', statementRecipientId: recipientId, statementRecipientName: 'Revision recipient', statementProducts: ['TRUCK_DIESEL'], productClassification: 'SAME',
    pilotEvidence: { eventId: provenanceEvent.id, invoiceId: 'invoice', invoiceNumber: 'revision', transactionId: null }, statementEvidence: { lineIds: [provenanceVersion.lines[0].id], versionId: provenanceVersion.id, pid: 'revision', statementNumber: 'revision', description: 'Fuel', reference: `reference-${date}` },
  });
  let evidenceRows = [row('2026-07-10'), row('2026-07-12')];
  revisionService.preview = async () => ({ rows: evidenceRows } as Awaited<ReturnType<FuelDeductionReconciliationService['preview']>>);
  const policy = await db.fuelDeductionPolicy.create({ data: { operatingGroupId: groupId, companyId, truckId: truckIds.driver, providerRecipientId: recipientId, responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000, effectiveFrom: historyDate('2026-07-10'), effectiveTo: historyDate('2026-07-12'), sourceReference: 'Revision fixture', reason: 'Initial reviewed range', approvedByUserId: userId } });
  const economicsBefore = [await db.financialTransaction.count(), await db.financialExpectation.count(), await db.financialAllocation.count(), await db.financialExpectationBankMatch.count()];
  const preview = await revisionService.previewPolicyRevision(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-13' }, context);
  assert.deepEqual(preview.newlyCovered, { rows: 1, pilotMinor: BigInt(1000), dates: ['2026-07-12'] });
  const reason = 'Extended from exact Pilot and QuickManage evidence.';
  const revised = await revisionService.revisePolicy(policy.id, { policyId: policy.id, effectiveFrom: '2026-07-10', effectiveTo: '2026-07-13', expectedRevision: 1, reason, evidenceReferences: preview.evidenceReferences }, context);
  assert.equal(revised.id, policy.id); assert.equal(revised.revision, 2); assert.equal(revised.revisions.length, 1);
  const history = revised.revisions[0];
  assert.equal((history.before as { effectiveTo: string }).effectiveTo, '2026-07-12'); assert.equal((history.after as { effectiveTo: string }).effectiveTo, '2026-07-13');
  assert.equal(history.reason, reason); assert.deepEqual(history.evidenceReferences, preview.evidenceReferences);
  assert.equal(await db.financialAuditEvent.count({ where: { action: 'FUEL_DEDUCTION_POLICY_REVISED', actorUserId: userId } }), 1);
  assert.deepEqual([await db.financialTransaction.count(), await db.financialExpectation.count(), await db.financialAllocation.count(), await db.financialExpectationBankMatch.count()], economicsBefore);
  const stored = await db.fuelDeductionPolicy.findUniqueOrThrow({ where: { id: policy.id } });
  assert.equal(resolveApplicableFuelPolicy([stored], companyId, truckIds.driver, recipientId, '2026-07-12').policy?.id, policy.id);

  const adminUser = await db.user.create({ data: { email: `${dbName}-admin@example.test`, displayName: 'Accounting admin', memberships: { create: { companyId, role: 'ADMIN' } } } });
  evidenceRows = [...evidenceRows, row('2026-07-13')];
  const adminPreview = await revisionService.previewPolicyRevision(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-14' }, { ...context, userId: adminUser.id, role: 'ADMIN' });
  const adminRevision = await revisionService.revisePolicy(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-14', expectedRevision: 2, reason, evidenceReferences: adminPreview.evidenceReferences }, { ...context, userId: adminUser.id, role: 'ADMIN' });
  assert.equal(adminRevision.revision, 3);

  const member = await db.user.create({ data: { email: `${dbName}-member@example.test`, displayName: 'Member', memberships: { create: { companyId, role: 'MEMBER' } } } });
  evidenceRows = [...evidenceRows, row('2026-07-14')];
  const memberPreview = await revisionService.previewPolicyRevision(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-15' }, context);
  await assert.rejects(revisionService.revisePolicy(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-15', expectedRevision: 3, reason, evidenceReferences: memberPreview.evidenceReferences }, { ...context, userId: member.id, role: 'MEMBER' }));
  const revoked = await db.user.create({ data: { email: `${dbName}-revoked@example.test`, displayName: 'Revoked admin', memberships: { create: { companyId, role: 'ADMIN' } } } });
  await db.companyMembership.delete({ where: { userId_companyId: { userId: revoked.id, companyId } } });
  await assert.rejects(revisionService.revisePolicy(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-15', expectedRevision: 3, reason, evidenceReferences: memberPreview.evidenceReferences }, { ...context, userId: revoked.id }));
  await assert.rejects(revisionService.previewPolicyRevision(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-15' }, { ...context, operatingGroupId: 'foreign-group' }));
  await db.user.update({ where: { id: adminUser.id }, data: { isActive: false } });
  await assert.rejects(revisionService.revisePolicy(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-15', expectedRevision: 3, reason, evidenceReferences: memberPreview.evidenceReferences }, { ...context, userId: adminUser.id }));
  await assert.rejects(revisionService.revisePolicy(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-15', expectedRevision: 2, reason, evidenceReferences: memberPreview.evidenceReferences }, context));
  await assert.rejects(revisionService.revisePolicy(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-15', expectedRevision: 3, reason: '', evidenceReferences: memberPreview.evidenceReferences }, context));
  await db.fuelDeductionPolicy.create({ data: { operatingGroupId: groupId, companyId, truckId: truckIds.driver, providerRecipientId: recipientId, responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000, effectiveFrom: historyDate('2026-07-16'), effectiveTo: historyDate('2026-07-20'), sourceReference: 'Adjacent fixture', reason: 'Separate reviewed period', approvedByUserId: userId } });
  evidenceRows = [...evidenceRows, row('2026-07-15'), row('2026-07-16')];
  const overlapPreview = await revisionService.previewPolicyRevision(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-17' }, context);
  await assert.rejects(revisionService.revisePolicy(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-17', expectedRevision: 3, reason, evidenceReferences: overlapPreview.evidenceReferences }, context));
  await assert.rejects(revisionService.revisePolicy(policy.id, { effectiveFrom: '2026-07-10', effectiveTo: '2026-07-15', expectedRevision: 3, reason, evidenceReferences: memberPreview.evidenceReferences.slice(1) }, context));
  assert.equal(await db.fuelDeductionPolicyRevision.count({ where: { policyId: policy.id } }), 2);
  await assert.rejects(db.fuelDeductionPolicyRevision.update({ where: { id: history.id }, data: { reason: 'Tampered history' } }));
  await assert.rejects(db.fuelDeductionPolicyRevision.delete({ where: { id: history.id } }));
  assert.equal(await db.fuelDeductionPolicyRevision.count({ where: { policyId: policy.id } }), 2);
});
