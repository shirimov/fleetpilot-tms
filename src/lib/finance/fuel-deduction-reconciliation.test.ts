import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { AuthenticationRequiredError, AuthorizationDeniedError } from '../auth/auth-errors';
import { financialControlAuthorization } from './financial-control-authorization';
import { GET as ownerHistoryGET, POST as ownerHistoryPOST } from '../../app/api/trucks/[id]/owner-history/route';
import { GET as ownerOptionsGET } from '../../app/api/trucks/[id]/owner-history/options/route';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { TruckCompanyHistoryService, historyDate } from '../fleet/truck-company-history';
import { truckOwnerHistoryService, TruckOwnerHistoryService } from '../fleet/truck-owner-history';
import { acceptsHistoricalCrossRecipientRouting, classifyFuelDeductionLine, corroboratesFuelIdentity, corroboratesFuelIdentityStrict, corroboratesFuelIdentityWithUnavailableStatementCard, corroboratesFuelProducts, discrepancyStatus, expectedFuelDeduction, expectedFuelDeductionForComponents, fuelAmountsWithinOwnerTolerance, fuelMonetaryToleranceMinor, FuelDeductionReconciliationService, isDieselReeferClassificationDifference, quickManageDateRelation, resolveApplicableFuelPolicy, subtractCoverageRanges, type FuelReconciliationRow } from './fuel-deduction-reconciliation';

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

test('Pilot source gaps include QuickManage-covered periods before, between, and after Pilot imports', () => {
  assert.deepEqual(subtractCoverageRanges([
    { start: '2025-10-20', end: '2025-11-09' },
    { start: '2026-01-05', end: '2026-09-13' },
  ], [{ start: '2026-06-29', end: '2026-08-02' }]), [
    { start: '2025-10-20', end: '2025-11-09' },
    { start: '2026-01-05', end: '2026-06-28' },
    { start: '2026-08-03', end: '2026-09-13' },
  ]);
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

test('a missing QuickManage card is unavailable corroboration only when location and geography are complete', () => {
  const pilot = { cardLastFour: '8926', locationNumber: '1194', city: 'Phoenix', state: 'AZ' };
  assert.equal(corroboratesFuelIdentityWithUnavailableStatementCard(pilot, { cardLastFour: null, locationNumber: '1194', city: 'Phoenix', state: 'AZ' }), true);
  assert.equal(corroboratesFuelIdentityWithUnavailableStatementCard(pilot, { cardLastFour: '8926', locationNumber: '1194', city: 'Phoenix', state: 'AZ' }), false);
  assert.equal(corroboratesFuelIdentityWithUnavailableStatementCard(pilot, { cardLastFour: null, locationNumber: '1195', city: 'Phoenix', state: 'AZ' }), false);
  assert.equal(corroboratesFuelIdentityWithUnavailableStatementCard(pilot, { cardLastFour: null, locationNumber: '1194', city: null, state: 'AZ' }), false);
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

// Explicit synthetic ownership evidence, never inferred from archive order.
async function confirmedFixtureOwner(truckId: string, recipientId: string) {
  const party = await db.financialParty.create({ data: { operatingGroupId: groupId, type: 'OWNER_OPERATOR', name: `Synthetic owner ${truckId}` } });
  await db.$transaction(async tx => {
    const revision = await tx.truckOwnerHistoryRevision.create({ data: { truckId, operatingGroupId: groupId, actorUserId: userId, sourceReference: 'Synthetic confirmed ownership fixture', reason: 'Independent fixture ownership evidence' } });
    await tx.truckOwnerPeriod.create({ data: { truckId, ownerPartyId: party.id, companyId, providerRecipientId: recipientId, effectiveFrom: historyDate('2026-01-01'), effectiveTo: null, revisionId: revision.id } });
  });
}

async function importRecord(rawAmount = '0') {
  importRow += 1;
  return db.financialImportRecord.create({ data: { statementId: pilotStatementId, sourceRowIndex: importRow, rawAmount, fingerprintSha256: hash(`${dbName}:${importRow}`) } });
}

async function addEvent(input: { key: string; date: string; sourceFormat?: string; truckId?: string | null; unit: string; product?: 'TRUCK_DIESEL' | 'DEF' | 'REEFER_FUEL'; quantity?: string; amount: bigint; retail?: bigint; savings?: bigint; reference?: string; cardLastFour?: string; locationNumber?: string; city?: string; state?: string }) {
  const invoice = await db.pilotProviderInvoice.create({ data: { operatingGroupId: groupId, sourceId, sourceFormat: input.sourceFormat ?? 'LEGACY_XLS', providerAccountHash: hash('account'), invoiceNumber: `INV-${input.key}`, billingDate: historyDate(input.date), periodStart: historyDate(input.date), periodEnd: historyDate(input.date), invoiceTotalMinor: input.amount, parsedTotalMinor: input.amount, differenceMinor: BigInt(0), status: 'POSTED', parseVersion: 'test', uploadedByUserId: userId, postedByUserId: userId, postedAt: new Date() } });
  const event = await db.pilotFuelingEvent.create({ data: { invoiceId: invoice.id, eventKeyHash: hash(input.key), ticketHash: hash(input.reference ?? `ticket-${input.key}`), authorizationHash: hash(`auth-${input.key}`), cardLastFour: input.cardLastFour ?? '1234', sourceUnitNumber: input.unit, locationNumber: input.locationNumber ?? '100', city: input.city ?? 'Test City', state: input.state ?? 'CA', transactionDate: historyDate(input.date), truckId: input.truckId, truckMatchStatus: input.truckId ? 'MATCHED' : 'UNMATCHED' } });
  const record = await importRecord(input.amount.toString());
  await db.pilotFuelProductLine.create({ data: { invoiceId: invoice.id, eventId: event.id, importRecordId: record.id, lineFingerprint: hash(`line-${input.key}`), sourceLineIdentity: input.key, sourceProductCode: input.product ?? 'DIESEL', productType: input.product ?? 'TRUCK_DIESEL', quantity: input.quantity ?? '20.00', unitPrice: '5.0000000', amountMinor: input.amount, retailAmountMinor: input.retail ?? input.amount, savingsMinor: input.savings ?? BigInt(0) } });
  return event;
}

async function archiveVersion(input: { key: string; pid: string; recipientId: string; recipientName?: string; recipientType: string; role?: string; workStart: string; workEnd: string; truckId: string | null; unit: string; lineUnit?: string; vin?: string; providerTruckId?: string; duplicateProviderTruck?: boolean; archiveCompanyId?: string; mappingStatus?: string; amount?: bigint; sourceDate?: string; sourceTimestamp?: string; reference?: string; providerLineId?: string | null; dieselAmount?: string; dieselQuantity?: string; reeferAmount?: string; reeferQuantity?: string; defAmount?: string; cardNumber?: string | null; merchant?: string; city?: string; state?: string }) {
  const document = await db.financialStatement.create({ data: { operatingGroupId: groupId, sourceId, type: 'OWNER_SETTLEMENT', periodStart: historyDate(input.workStart), periodEnd: historyDate(input.workEnd), originalFilename: `${input.key}.pdf`, displayFilename: `${input.key}.pdf`, mimeType: 'application/pdf', byteSize: 1, storageKey: `test/${dbName}/${input.key}.pdf`, checksumSha256: hash(`pdf-${input.key}`), importedByUserId: userId } });
  const statement = await db.archiveStatement.create({ data: { archiveCompanyId: input.archiveCompanyId ?? archiveCompanyId, providerStatementId: input.key, latestProviderVersion: 1, acceptedProviderVersion: 1 } });
  return db.$transaction(async tx => {
    const version = await tx.archiveVersion.create({ data: { statementId: statement.id, providerVersion: 1, documentId: document.id, detailStorageKey: `test/${dbName}/${input.key}.json`, detailChecksum: hash(`detail-${input.key}`), pdfChecksum: document.checksumSha256, bundleChecksum: hash(`bundle-${input.key}`), pid: input.pid, recipientId: input.recipientId, recipientName: input.recipientName ?? input.recipientId, recipientType: input.recipientType, role: input.role, workStart: historyDate(input.workStart), workEnd: historyDate(input.workEnd), header: {}, issues: [], parserVersion: 'test', capturedByUserId: userId } });
    await tx.archiveTruck.create({ data: { versionId: version.id, sourceKey: input.unit, providerTruckId: input.providerTruckId, unit: input.unit, vin: input.vin, truckId: input.truckId, mappingStatus: input.mappingStatus ?? 'MATCHED' } });
    if (input.duplicateProviderTruck) await tx.archiveTruck.create({ data: { versionId: version.id, sourceKey: `${input.unit}-duplicate`, providerTruckId: input.providerTruckId, unit: input.unit, vin: input.vin, truckId: input.truckId, mappingStatus: input.mappingStatus ?? 'MATCHED' } });
    if (input.amount !== undefined) await tx.archiveLine.create({ data: { versionId: version.id, kind: 'DEDUCTION', sourceArray: 'fuel_transactions', sourceOrder: 0, providerLineId: input.providerLineId === undefined ? input.reference ?? input.key : input.providerLineId, description: 'Structured Pilot fuel recovery', sourceType: 'fuel', amountMinor: -input.amount, rawAmount: input.amount.toString(), sourceDate: input.sourceDate, reference: input.reference, sourceUnit: input.lineUnit ?? input.unit, included: true, metadata: { type: 'fuel', date: input.sourceTimestamp ?? (input.sourceDate ? `${input.sourceDate}T12:00:00Z` : null), diesel_amount: input.dieselAmount ?? input.amount.toString(), diesel_qty: input.dieselQuantity ?? '20.00', def_amount: input.defAmount ?? '0', reefer_amount: input.reeferAmount ?? '0', reefer_qty: input.reeferQuantity ?? '0', pay_amount: input.amount.toString(), card_number: input.cardNumber === undefined ? '991234' : input.cardNumber, merchant: input.merchant ?? '100', city: input.city ?? 'Test City', state: input.state ?? 'CA' } } });
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
  for (const [name, withHistory] of [['exact', true], ['driver', true], ['timing', true], ['unknown', false], ['weekend', true], ['weekendGap', false], ['crossExpected', true], ['crossActual', true], ['product', true], ['ambiguous', true], ['identityConflict', true], ['truck042', true]] as const) {
    const unit = name === 'truck042' ? '042' : `UNIT-${name.toUpperCase()}`;
    const truck = await db.truck.create({ data: { companyId, unitNumber: unit, unitNumberNormalized: unit } }); truckIds[name] = truck.id;
    if (withHistory) await history.change(truck.id, { action: 'CONFIRM', expectedRevisionId: null, source: 'MANUAL_CONFIRMATION', sourceReference: 'Synthetic fixture', reason: 'Synthetic fixture', periods: [{ companyId, effectiveFrom: '2026-01-01', effectiveTo: '2026-10-01' }] }, userId);
  }
  await history.change(truckIds.weekendGap, { action: 'CONFIRM', expectedRevisionId: null, source: 'MANUAL_CONFIRMATION', sourceReference: 'Synthetic Sunday-only fixture', reason: 'Preceding Saturday deliberately remains uncovered', periods: [{ companyId, effectiveFrom: '2026-07-26', effectiveTo: '2026-10-01' }] }, userId);
  for (const [key, recipient] of Object.entries({ exact: 'contractor-exact', timing: 'contractor-timing', weekend: 'contractor-weekend', weekendGap: 'contractor-weekend-gap', crossExpected: 'contractor-expected', crossActual: 'contractor-actual', product: 'contractor-product', ambiguous: 'contractor-ambiguous', identityConflict: 'contractor-identity', truck042: 'truck-042-recipient' })) {
    await confirmedFixtureOwner(truckIds[key], recipient);
  }
  await db.fuelDeductionPolicy.createMany({ data: [
    { operatingGroupId: groupId, companyId, truckId: truckIds.exact, providerRecipientId: 'contractor-exact', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic full pass through', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.timing, providerRecipientId: 'contractor-timing', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic timing policy', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.weekend, providerRecipientId: 'contractor-weekend', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic weekend policy', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.weekendGap, providerRecipientId: 'contractor-weekend-gap', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic weekend history-gap policy', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.crossExpected, providerRecipientId: 'contractor-expected', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic recipient policy', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.product, providerRecipientId: 'contractor-product', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic product policy', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.ambiguous, providerRecipientId: 'contractor-ambiguous', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic ambiguity policy', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.identityConflict, providerRecipientId: 'contractor-identity', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic identity-conflict policy', reason: 'Fixture', approvedByUserId: userId },
    { operatingGroupId: groupId, companyId, truckId: truckIds.truck042, providerRecipientId: 'truck-042-recipient', responsibility: 'RECIPIENT', discountTreatment: 'COMPANY_RETENTION', companyRetentionBasisPoints: 1000, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Truck 042 audited 10% retention policy', reason: 'OWNER-provided statement regression', approvedByUserId: userId },
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
  caseEventIds.weekendGap = (await addEvent({ key: 'weekend-gap', date: '2026-07-26', truckId: truckIds.weekendGap, unit: 'UNIT-WEEKENDGAP', amount: minor(8_100) })).id;
  await archiveVersion({ key: 'weekend-gap-assignment', pid: '31', recipientId: 'contractor-weekend-gap', recipientType: 'CONTRACTOR', workStart: '2026-07-26', workEnd: '2026-08-01', truckId: truckIds.weekendGap, unit: 'UNIT-WEEKENDGAP' });
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
  caseEventIds.truck042 = (await addEvent({ key: 'truck-042', date: '2026-07-26', truckId: truckIds.truck042, unit: '042', quantity: '80.17', amount: minor(40_392), retail: minor(50_500), savings: minor(10_108), cardLastFour: '8926', locationNumber: '1194', city: 'Phoenix', state: 'AZ' })).id;
  await archiveVersion({ key: 'truck-042-assignment', pid: '31', recipientId: 'truck-042-recipient', recipientName: '042 Babamurat Kurbanov', recipientType: 'CONTRACTOR', workStart: '2026-07-26', workEnd: '2026-08-01', truckId: truckIds.truck042, unit: '042' });
  await archiveVersion({ key: 'truck-042-owner-pdf', pid: '2026-30', recipientId: 'truck-042-other-company-recipient', recipientName: '042 Babamurat Kurbanov', recipientType: 'CONTRACTOR', workStart: '2026-07-19', workEnd: '2026-07-25', truckId: null, unit: '042', archiveCompanyId: conflictArchiveCompanyId, mappingStatus: 'NEEDS_REVIEW', amount: minor(41_402), sourceDate: '2026-07-25', sourceTimestamp: '2026-07-25T16:34:00Z', dieselAmount: '505.00', dieselQuantity: '80.17', cardNumber: null, merchant: '1194', city: 'Phoenix', state: 'AZ' });
  const invoice = await db.pilotProviderInvoice.findFirstOrThrow(); const record = await importRecord('-28.59');
  await db.pilotInvoiceAdjustment.create({ data: { invoiceId: invoice.id, importRecordId: record.id, fingerprint: hash('credit'), sourceLineIdentity: 'credit', description: 'Provider credit', signedAmountMinor: BigInt(-2859) } });
});

after(async () => { await db.$disconnect(); await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`); await admin.end(); });

test('full preview covers matching, timing, coverage, responsibility, history, mapping and exclusions without economic writes', async () => {
  const context = { userId, activeCompanyId: companyId, operatingGroupId: groupId, role: 'OWNER' as const, companyIds: [companyId] };
  const protectedBefore = [await db.financialTransaction.count(), await db.financialExpectation.count(), await db.financialAllocation.count(), await db.financialExpectationBankMatch.count()];
  const result = await service.preview(context);
  assert.equal(result.coverage.start, '2026-04-22'); assert.equal(result.coverage.end, '2026-09-23'); assert.ok(result.coverage.pilotRanges.length > 0);
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
  assert.equal(result.rows.find(row => row.pid === '20')?.status, 'SOURCE_COVERAGE_GAP');
  assert.equal(result.rows.find(row => row.pid === '1')?.status, 'SOURCE_COVERAGE_GAP');
  assert.equal(result.completeness.conservation.pilot.countDifference, 0);
  assert.equal(result.completeness.conservation.pilot.gallonsDifferenceHundredths, BigInt(0));
  assert.equal(result.completeness.conservation.pilot.retailDifferenceMinor, BigInt(0));
  assert.equal(result.completeness.conservation.pilot.dollarDifferenceMinor, BigInt(0));
  assert.equal(result.completeness.conservation.quickManage.countDifference, 0);
  assert.equal(result.completeness.conservation.quickManage.sourceRecordCountDifference, 0);
  assert.equal(result.completeness.conservation.quickManage.gallonsDifferenceHundredths, BigInt(0));
  assert.equal(result.completeness.conservation.quickManage.retailDifferenceMinor, BigInt(0));
  assert.equal(result.completeness.conservation.quickManage.dollarDifferenceMinor, BigInt(0));
  assert.equal(result.completeness.orphanRecords, 0); assert.equal(result.completeness.duplicateConsumedEvidence, 0);
  assert.equal(result.completeness.duplicatePilotConsumption, 0); assert.equal(result.completeness.duplicateQuickManageConsumption, 0);
  assert.ok(result.completeness.coverageMatrix.some(row => row.source === 'PILOT' && row.status === 'PRESENT'));
  assert.ok(result.completeness.coverageMatrix.some(row => row.source === 'PILOT' && row.status === 'MISSING'));
  assert.ok(result.completeness.coverageMatrix.some(row => row.source === 'QUICKMANAGE' && row.status === 'PRESENT'));
  assert.deepEqual([await db.financialTransaction.count(), await db.financialExpectation.count(), await db.financialAllocation.count(), await db.financialExpectationBankMatch.count()], protectedBefore);
});

test('OWNER manual match and audited unmatch conserve both sources without changing source evidence or economics', async () => {
  const context = { userId, activeCompanyId: companyId, operatingGroupId: groupId, role: 'OWNER' as const, companyIds: [companyId] };
  const before = await service.preview(context, { pageSize: 10000 });
  const pilot = before.rows.find(row => row.truckUnit === 'UNIT-211' && row.pilotEventId && !row.statementEvidence)!;
  const qm = before.rows.find(row => row.pid === '20' && !row.pilotEventId && row.statementEvidence)!;
  const archiveLineId = qm.statementEvidence!.groupLineId;
  const sourceBefore = [await db.pilotFuelingEvent.findUniqueOrThrow({ where: { id: pilot.pilotEventId! } }), await db.archiveLine.findUniqueOrThrow({ where: { id: archiveLineId } })];
  const economicsBefore = [await db.financialTransaction.count(), await db.financialExpectation.count(), await db.financialAllocation.count(), await db.financialExpectationBankMatch.count()];
  const reason = 'OWNER confirmed the two source records describe the same purchase.';
  const match = await service.createManualMatch({ pilotEventId: pilot.pilotEventId, archiveLineId, reason }, context);
  const paired = await service.preview(context, { pageSize: 10000 });
  const pairedRow = paired.rows.find(row => row.pilotEventId === pilot.pilotEventId)!;
  assert.equal(pairedRow.manualMatch?.id, match.id); assert.equal(pairedRow.matchMethod, 'MANUAL_OWNER_MATCH'); assert.ok(pairedRow.statementEvidence?.lineIds.includes(archiveLineId));
  assert.equal(paired.completeness.matching.manualMatched, before.completeness.matching.manualMatched + 1);
  assert.equal(paired.completeness.orphanRecords, 0); assert.equal(paired.completeness.duplicateConsumedEvidence, 0);
  await assert.rejects(service.createManualMatch({ pilotEventId: pilot.pilotEventId, archiveLineId, reason }, context));
  const member = await db.user.create({ data: { email: `${dbName}-manual-member@example.test`, displayName: 'Manual match member', memberships: { create: { companyId, role: 'MEMBER' } }, operatingGroupMemberships: { create: { operatingGroupId: groupId, role: 'MEMBER' } } } });
  await assert.rejects(service.unmatchManualMatch({ matchId: match.id, reason: 'Member must not be allowed to undo matches.' }, { ...context, userId: member.id, role: 'MEMBER' }));
  const unmatchReason = 'OWNER determined that the source pairing should return to review.';
  await service.unmatchManualMatch({ matchId: match.id, reason: unmatchReason }, context);
  const restored = await service.preview(context, { pageSize: 10000 });
  assert.equal(restored.rows.find(row => row.pilotEventId === pilot.pilotEventId)?.statementEvidence, null);
  assert.ok(restored.rows.some(row => row.statementEvidence?.lineIds.includes(archiveLineId) && !row.pilotEventId));
  assert.equal(await db.financialAuditEvent.count({ where: { action: { in: ['FUEL_RECONCILIATION_MANUAL_MATCHED', 'FUEL_RECONCILIATION_MANUAL_UNMATCHED'] }, actorUserId: userId } }), 2);
  assert.deepEqual([await db.pilotFuelingEvent.findUniqueOrThrow({ where: { id: pilot.pilotEventId! } }), await db.archiveLine.findUniqueOrThrow({ where: { id: archiveLineId } })], sourceBefore);
  assert.deepEqual([await db.financialTransaction.count(), await db.financialExpectation.count(), await db.financialAllocation.count(), await db.financialExpectationBankMatch.count()], economicsBefore);
  await assert.rejects(db.fuelReconciliationManualMatch.delete({ where: { id: match.id } }));
  const concurrent = await Promise.allSettled([
    service.createManualMatch({ pilotEventId: pilot.pilotEventId, archiveLineId, reason }, context),
    service.createManualMatch({ pilotEventId: pilot.pilotEventId, archiveLineId, reason }, context),
  ]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), ['fulfilled', 'rejected']);
  const concurrentMatch = concurrent.find(result => result.status === 'fulfilled');
  assert.ok(concurrentMatch?.status === 'fulfilled');
  const concurrentMatchId = concurrentMatch.value.id;
  await service.unmatchManualMatch({ matchId: concurrentMatchId, reason: 'OWNER completed the concurrency safety verification.' }, context);
  assert.deepEqual([await db.pilotFuelingEvent.findUniqueOrThrow({ where: { id: pilot.pilotEventId! } }), await db.archiveLine.findUniqueOrThrow({ where: { id: archiveLineId } })], sourceBefore);
  assert.deepEqual([await db.financialTransaction.count(), await db.financialExpectation.count(), await db.financialAllocation.count(), await db.financialExpectationBankMatch.count()], economicsBefore);
});

test('preview resolves the weekend provider boundary and fails closed for recipient, product, Company identity and ambiguous evidence', async () => {
  const context = { userId, activeCompanyId: companyId, operatingGroupId: groupId, role: 'OWNER' as const, companyIds: [companyId, conflictCompanyId] };
  const result = await service.preview(context, { pageSize: 10000 });
  const weekend = result.rows.find(row => row.pilotEventId === caseEventIds.weekend)!;
  assert.equal(weekend.status, 'MATCHED'); assert.equal(weekend.matchMethod, 'PILOT_SUNDAY_QUICKMANAGE_SATURDAY'); assert.equal(weekend.statementMinor, minor(8_000));
  const weekendGap = result.rows.find(row => row.pilotEventId === caseEventIds.weekendGap)!;
  assert.equal(weekendGap.status, 'SOURCE_COVERAGE_GAP'); assert.equal(weekendGap.matchMethod, 'WEEKEND_COMPANY_HISTORY_GAP');
  assert.equal(weekendGap.expectedMinor, null); assert.equal(weekendGap.statementMinor, BigInt(0)); assert.equal(weekendGap.differenceMinor, null);
  const cross = result.rows.find(row => row.pilotEventId === caseEventIds.cross)!;
  assert.equal(cross.status, 'NEEDS_RECIPIENT_REVIEW'); assert.equal(cross.matchMethod, 'CROSS_RECIPIENT_STRUCTURED_IDENTITY'); assert.equal(cross.statementMinor, minor(9_000));
  assert.equal(cross.statementTruckUnit, 'UNIT-CROSSACTUAL'); assert.equal(cross.statementRecipientId, 'contractor-actual');
  const crossSep21 = result.rows.find(row => row.pilotEventId === caseEventIds.crossSep21)!;
  assert.equal(crossSep21.status, 'NEEDS_RECIPIENT_REVIEW'); assert.equal(crossSep21.matchMethod, 'CROSS_RECIPIENT_STRUCTURED_IDENTITY'); assert.equal(crossSep21.differenceMinor, null);
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
  const truck042 = result.rows.find(row => row.pilotEventId === caseEventIds.truck042)!;
  // Synthetic cross-namespace evidence is not the real audited manual pairing.
  assert.equal(truck042.status, 'NEEDS_REVIEW'); assert.equal(truck042.matchMethod, 'CROSS_COMPANY_IDENTITY_REVIEW');
  assert.equal(truck042.expectedMinor, minor(41_402)); assert.equal(truck042.statementMinor, minor(41_402)); assert.equal(truck042.differenceMinor, null);
  assert.equal(truck042.statementTruckUnit, '042'); assert.equal(truck042.statementRecipientName, '042 Babamurat Kurbanov');
  assert.equal(result.rows.some(row => row.status === 'MISSING_DEDUCTION' && row.pilotEventId === caseEventIds.truck042), false);
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
  const foreignGroup = await db.operatingGroup.create({ data: { name: 'Foreign mapping uniqueness group' } });
  await assert.rejects(db.historicalTruckMapping.create({ data: { operatingGroupId: foreignGroup.id, provider: 'QUICKMANAGE', providerTruckId, truckId: truckIds.exact, evidenceReferences, sourceReference: 'Contradictory cross-group identity.', reason: 'Database uniqueness must reject this mapping.', createdByUserId: userId } }));
  await db.operatingGroup.delete({ where: { id: foreignGroup.id } });
  const mappedRows = (await service.preview(context, { truck: 'UNIT-MAP', pageSize: 10000 })).rows.filter(row => row.truckId === truck.id);
  assert.equal(mappedRows.some(row => row.status === 'NEEDS_TRUCK_MAPPING'), false);
  assert.equal(mappedRows.some(row => row.status === 'NEEDS_COMPANY_HISTORY'), true);
  const linkedRow = mappedRows.find(row => row.canonicalIdentityLink?.linkId === mapping.id)!;
  assert.equal(linkedRow.canonicalIdentityLink?.providerTruckId, providerTruckId);
  assert.equal(linkedRow.canonicalIdentityLink?.sourceUnit, 'UNIT-MAP');
  assert.equal(linkedRow.canonicalIdentityLink?.sourceVin, vin);
  assert.equal(linkedRow.canonicalIdentityLink?.canonicalTruckId, truck.id);
  assert.equal(linkedRow.canonicalIdentityLink?.canonicalUnit, 'UNIT-MAP');
  assert.equal(linkedRow.canonicalIdentityLink?.canonicalVin, vin);
  assert.equal(linkedRow.canonicalIdentityLink?.actor, 'Fuel policy owner');
  assert.equal(linkedRow.canonicalIdentityLink?.reason, request.reason);
  assert.equal(linkedRow.canonicalIdentityLink?.sourceReference, request.sourceReference);
  assert.equal(linkedRow.canonicalIdentityLink?.evidenceReferenceCount, 2);
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
    pilotCardLastFour: '1234', pilotLocationNumber: '100', pilotCity: 'Test City', pilotState: 'CA',
    statementDate: date, statementCardLastFour: '1234', statementLocationNumber: '100', statementCity: 'Test City', statementState: 'CA', statementGallons: '2.00', statementRetailMinor: BigInt(1100), manualMatch: null,
    canonicalIdentityLink: null,
    pilotEvidence: { eventId: provenanceEvent.id, invoiceId: 'invoice', invoiceNumber: 'revision', transactionId: null }, statementEvidence: { groupLineId: provenanceVersion.lines[0].id, lineIds: [provenanceVersion.lines[0].id], versionId: provenanceVersion.id, pid: 'revision', statementNumber: 'revision', description: 'Fuel', reference: `reference-${date}` },
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

// These regressions exercise the real preview, including accepted-version selection,
// deduplication, candidate selection, policy resolution and source disposition.
// They deliberately retain the suite's normal disposable-database setup.
async function ambiguityFixture(key: string, reference?: string, confirmOwner = true) {
  const unit = `REVIEW-${key.toUpperCase()}`;
  const truck = await db.truck.create({ data: { companyId, unitNumber: unit, unitNumberNormalized: unit } });
  await new TruckCompanyHistoryService(db).change(truck.id, {
    action: 'CONFIRM', expectedRevisionId: null, source: 'MANUAL_CONFIRMATION',
    sourceReference: 'Synthetic ambiguity regression', reason: 'Synthetic ambiguity regression',
    periods: [{ companyId, effectiveFrom: '2026-01-01', effectiveTo: '2026-10-01' }],
  }, userId);
  const recipientId = `${key}-contractor`;
  if (confirmOwner && !key.startsWith('overlap-') && !['manual-overlap', 'owner-boundary', 'missing-owner'].includes(key)) await confirmedFixtureOwner(truck.id, recipientId);
  const context = { userId, activeCompanyId: companyId, operatingGroupId: groupId, role: 'OWNER' as const, companyIds: [companyId] };
  const event = await addEvent({ key, date: '2026-06-10', truckId: truck.id, unit, amount: minor(10_000), reference, locationNumber: key });
  const policy = await db.fuelDeductionPolicy.create({ data: {
    operatingGroupId: groupId, companyId, truckId: truck.id, providerRecipientId: recipientId,
    responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0,
    effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic ambiguity regression', reason: 'Fixture', approvedByUserId: userId,
  } });
  const archive = (suffix: string, overrides: Partial<Parameters<typeof archiveVersion>[0]> = {}) => archiveVersion({
    key: `${key}-${suffix}`, pid: 'review-10', recipientId, recipientType: 'CONTRACTOR',
    workStart: '2026-06-07', workEnd: '2026-06-13', truckId: truck.id, unit,
    amount: minor(10_000), sourceDate: '2026-06-10', sourceTimestamp: '2026-06-10T10:00:00Z',
    dieselAmount: '100.00', dieselQuantity: '20.00', merchant: key, ...overrides,
  });
  return { truck, event, recipientId, context, archive, policy };
}

async function assertAmbiguousSourcesRemainUnconsumed(
  result: Awaited<ReturnType<FuelDeductionReconciliationService['preview']>>,
  eventId: string,
  versionIds: string[],
  expectedStatementMinor: bigint,
) {
  const pilotRows = result.rows.filter(row => row.pilotEventId === eventId);
  assert.equal(pilotRows.length, 1, 'the fixture event must have exactly one Pilot disposition');
  const pilot = pilotRows[0];
  assert.ok(pilot);
  assert.equal(pilot.pilotActualMinor, minor(10_000));
  assert.equal(pilot.status, 'NEEDS_REVIEW');
  assert.equal(pilot.statementEvidence, null, 'an ambiguous candidate must not be consumed');
  assert.equal(pilot.differenceMinor, null);
  const sourceLines = await db.archiveLine.findMany({ where: { versionId: { in: versionIds } } });
  assert.equal(sourceLines.length, versionIds.length);
  const sourceAmountMinor = sourceLines.reduce((sum, line) => {
    assert.notEqual(line.amountMinor, null, 'fixture source deductions must have amounts');
    const amount = line.amountMinor!;
    return sum + (amount < BigInt(0) ? -amount : amount);
  }, BigInt(0));
  assert.equal(sourceAmountMinor, expectedStatementMinor);
  const sourceIds = new Set(sourceLines.map(line => line.id));
  const dispositions = result.rows.filter(row => row.statementEvidence?.lineIds.some(id => sourceIds.has(id)));
  assert.ok(dispositions.every(row => row.pilotEventId === null));
  assert.deepEqual(dispositions.flatMap(row => row.statementEvidence!.lineIds).sort(), [...sourceIds].sort());
  assert.equal(dispositions.reduce((sum, row) => sum + row.statementMinor, BigInt(0)), expectedStatementMinor);
}

for (const identity of ['absent', 'shared-reference'] as const) {
  test(`preview preserves distinct same-recipient charges with ${identity} identity for review`, async () => {
    const fixture = await ambiguityFixture(`dedup-${identity}`);
    const first = await fixture.archive('one', {
      providerLineId: identity === 'absent' ? null : 'provider-one',
      reference: identity === 'absent' ? undefined : 'reused-reference',
    });
    const second = await fixture.archive('two', {
      providerLineId: identity === 'absent' ? null : 'provider-two',
      reference: identity === 'absent' ? undefined : 'reused-reference',
      sourceTimestamp: '2026-06-10T11:00:00Z',
    });
    const result = await service.preview(fixture.context, { pageSize: 10000 });
    await assertAmbiguousSourcesRemainUnconsumed(result, fixture.event.id, [first.id, second.id], minor(20_000));
  });
}

test('preview retains distinct provider IDs as separate ambiguous same-day evidence', async () => {
  const fixture = await ambiguityFixture('distinct-provider');
  const first = await fixture.archive('one', { providerLineId: 'distinct-one' });
  const second = await fixture.archive('two', { providerLineId: 'distinct-two', sourceTimestamp: '2026-06-10T11:00:00Z' });
  await assertAmbiguousSourcesRemainUnconsumed(
    await service.preview(fixture.context, { pageSize: 10000 }), fixture.event.id, [first.id, second.id], minor(20_000),
  );
});

for (const driverFirst of [true, false]) {
  test(`preview still pairs identical Driver and Contractor recovery once with both source IDs (Driver first: ${driverFirst})`, async () => {
    const fixture = await ambiguityFixture(`driver-contractor-${driverFirst}`);
    // Preview orders accepted versions by PID, then ID. Distinct PIDs make
    // both evidence orders deterministic, independent of generated IDs.
    const driver = await fixture.archive('driver', { pid: driverFirst ? 'review-10' : 'review-20', recipientId: `paired-driver-${driverFirst}`, recipientType: 'DRIVER', reference: 'paired-review' });
    const contractor = await fixture.archive('contractor', { pid: driverFirst ? 'review-20' : 'review-10', reference: 'paired-review' });
    const result = await service.preview(fixture.context, { pageSize: 10000 });
    const pilotRows = result.rows.filter(row => row.pilotEventId === fixture.event.id);
    assert.equal(pilotRows.length, 1, 'the paired recovery must have exactly one Pilot disposition');
    const pilot = pilotRows[0];
    assert.ok(pilot);
    assert.equal(pilot.pilotActualMinor, minor(10_000));
    const sourceLines = await db.archiveLine.findMany({ where: { versionId: { in: [driver.id, contractor.id] } } });
    assert.equal(sourceLines.length, 2);
    const contractorLine = sourceLines.find(line => line.versionId === contractor.id);
    assert.ok(contractorLine);
    assert.equal(pilot.status, 'MATCHED');
    assert.equal(pilot.recipientId, fixture.recipientId);
    assert.equal(pilot.statementRecipientId, fixture.recipientId);
    assert.equal(pilot.statementEvidence?.versionId, contractor.id);
    assert.equal(pilot.statementEvidence?.groupLineId, contractorLine.id);
    assert.equal(pilot.statementMinor, minor(10_000));
    assert.deepEqual(pilot.statementEvidence?.lineIds.slice().sort(), sourceLines.map(line => line.id).sort());
    for (const line of sourceLines) assert.equal(result.rows.filter(row => row.statementEvidence?.lineIds.includes(line.id)).length, 1);
  });
}

for (const companyFirst of [true, false]) {
  test(`preview does not resolve overlapping distinct Contractors by PID order (Company first: ${companyFirst})`, async () => {
    const fixture = await ambiguityFixture(`overlap-${companyFirst}`);
    const otherRecipient = `other-${fixture.recipientId}`;
    await db.fuelDeductionPolicy.create({ data: {
      operatingGroupId: groupId, companyId, truckId: fixture.truck.id, providerRecipientId: otherRecipient,
      responsibility: 'COMPANY', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0,
      effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic conflicting recipient rule', reason: 'Fixture', approvedByUserId: userId,
    } });
    await fixture.archive('recipient-assignment', { amount: undefined, pid: companyFirst ? 'review-20' : 'review-10' });
    await fixture.archive('company-assignment', { amount: undefined, recipientId: otherRecipient, pid: companyFirst ? 'review-10' : 'review-20' });
    const result = await service.preview(fixture.context, { pageSize: 10000 });
    const pilot = result.rows.find(row => row.pilotEventId === fixture.event.id)!;
    assert.ok(['NEEDS_REVIEW', 'NEEDS_RECIPIENT_MAPPING'].includes(pilot.status), 'distinct unresolved recipients require review, not a selected policy');
    assert.equal(pilot.expectedMinor, null);
    assert.equal(pilot.policyId, null);
    assert.equal(pilot.differenceMinor, null);
    assert.equal(pilot.statementEvidence, null);
  });
}

test('preview keeps repeated assignments for the same Contractor usable', async () => {
  const fixture = await ambiguityFixture('same-contractor');
  await fixture.archive('assignment-one', { amount: undefined, pid: 'review-10' });
  await fixture.archive('assignment-two', { amount: undefined, pid: 'review-20' });
  const result = await service.preview(fixture.context, { pageSize: 10000 });
  const pilot = result.rows.find(row => row.pilotEventId === fixture.event.id)!;
  assert.equal(pilot.recipientId, fixture.recipientId);
  assert.equal(pilot.policyId, fixture.policy.id);
  assert.equal(pilot.expectedMinor, minor(10_000));
  assert.equal(pilot.status, 'PILOT_UNMATCHED');
});

test('preview sends multiple reference candidates to review without falling through to unmatched', async () => {
  const fixture = await ambiguityFixture('reference-collision', 'collision-ticket');
  const first = await fixture.archive('one', { reference: 'collision-ticket', amount: minor(10_000) });
  // Different amounts intentionally keep the two candidates out of one dedup group.
  const second = await fixture.archive('two', { reference: 'collision-ticket', amount: minor(10_001), sourceTimestamp: '2026-06-10T11:00:00Z' });
  await assertAmbiguousSourcesRemainUnconsumed(
    await service.preview(fixture.context, { pageSize: 10000 }), fixture.event.id, [first.id, second.id], minor(20_001),
  );
});

test('preview does not collapse a Driver and repeated Contractor recovery into one pair', async () => {
  const fixture = await ambiguityFixture('non-unique-pair');
  const driver = await fixture.archive('driver', { recipientId: 'non-unique-pair-driver', recipientType: 'DRIVER', reference: 'non-unique-pair-reference' });
  const first = await fixture.archive('contractor-one', { reference: 'non-unique-pair-reference' });
  const second = await fixture.archive('contractor-two', { reference: 'non-unique-pair-reference' });
  await assertAmbiguousSourcesRemainUnconsumed(
    await service.preview(fixture.context, { pageSize: 10000 }), fixture.event.id, [driver.id, first.id, second.id], minor(30_000),
  );
});

test('preview preserves an OWNER manual match while overlapping Contractors keep policy unresolved', async () => {
  const fixture = await ambiguityFixture('manual-overlap');
  const first = await fixture.archive('one', { providerLineId: null });
  await fixture.archive('two', { providerLineId: null, sourceTimestamp: '2026-06-10T11:00:00Z' });
  const line = await db.archiveLine.findFirstOrThrow({ where: { versionId: first.id } });
  const match = await service.createManualMatch({ pilotEventId: fixture.event.id, archiveLineId: line.id, reason: 'Synthetic OWNER confirmation of one specific source line.' }, fixture.context);
  try {
    await fixture.archive('other-assignment', { amount: undefined, recipientId: 'manual-overlap-other-contractor' });
    const sourceBefore = await db.archiveLine.findUniqueOrThrow({ where: { id: line.id } });
    const result = await service.preview(fixture.context, { pageSize: 10000 });
    const pilot = result.rows.find(row => row.pilotEventId === fixture.event.id)!;
    assert.equal(pilot.status, 'NEEDS_REVIEW');
    assert.equal(pilot.manualMatch?.id, match.id);
    assert.equal(pilot.matchMethod, 'MANUAL_OWNER_MATCH');
    assert.deepEqual(pilot.statementEvidence?.lineIds, [line.id]);
    assert.equal(pilot.statementMinor, minor(10_000));
    assert.equal(pilot.expectedMinor, null);
    assert.equal(pilot.policyId, null);
    assert.equal(pilot.recipientId, null);
    assert.equal(pilot.differenceMinor, null);
    assert.equal(result.rows.filter(row => row.statementEvidence?.lineIds.includes(line.id)).length, 1);
    assert.equal(result.completeness.orphanActiveManualMatches, 0);
    assert.equal(result.completeness.duplicateConsumedEvidence, 0);
    assert.deepEqual(await db.archiveLine.findUniqueOrThrow({ where: { id: line.id } }), sourceBefore);
    assert.equal((await db.fuelReconciliationManualMatch.findUniqueOrThrow({ where: { id: match.id } })).unmatchedAt, null);
  } finally {
    await service.unmatchManualMatch({ matchId: match.id, reason: 'Synthetic manual-match preservation check completed.' }, fixture.context);
  }
});

test('preview reviews a deduction posted to the wrong owner without changing confirmed attribution', async () => {
  const fixture = await ambiguityFixture('wrong-owner');
  const version = await fixture.archive('other', { recipientId: 'wrong-owner-recipient' });
  const result = await service.preview(fixture.context, { pageSize: 10000 });
  const row = result.rows.find(item => item.pilotEventId === fixture.event.id)!;
  assert.equal(row.status, 'NEEDS_RECIPIENT_REVIEW');
  assert.equal(row.recipientId, fixture.recipientId);
  assert.equal(row.statementRecipientId, 'wrong-owner-recipient');
  assert.ok(row.ownerAttribution?.periodId);
  assert.equal(row.statementEvidence?.versionId, version.id);
  assert.equal(row.expectedMinor, minor(10_000));
  assert.equal(row.differenceMinor, null);
});

test('preview with no confirmed owner preserves a unique source line for review without assigning its Contractor', async () => {
  const fixture = await ambiguityFixture('missing-owner');
  const version = await fixture.archive('one');
  const result = await service.preview(fixture.context, { pageSize: 10000 });
  await assertAmbiguousSourcesRemainUnconsumed(result, fixture.event.id, [version.id], minor(10_000));
  const row = result.rows.find(item => item.pilotEventId === fixture.event.id)!;
  assert.equal(row.matchMethod, 'NO_CONFIRMED_OWNER');
  assert.equal(row.ownerAttribution, null);
  assert.equal(row.recipientId, null);
  assert.equal(row.policyId, null);
});

for (const manual of [false, true]) {
  test(`current Company Driver cannot hide a late Contractor requiring owner history (manual: ${manual})`, async () => {
    const key = `mixed-missing-owner-${manual}`;
    const fixture = await ambiguityFixture(key, `ticket-${key}`, false);
    const posted = await fixture.archive('late-contractor', {
      workStart: '2026-06-14', workEnd: '2026-06-20', reference: `ticket-${key}`,
    });
    const source = await db.archiveLine.findFirstOrThrow({ where: { versionId: posted.id } });
    // Reserve through the normal service while the missing-owner row is unresolved,
    // before introducing the assignment which previously masked the Contractor.
    const match = manual ? await service.createManualMatch({ pilotEventId: fixture.event.id, archiveLineId: source.id, reason: 'Synthetic explicit source reservation without ownership inference.' }, fixture.context) : null;
    const persisted = match ? await db.fuelReconciliationManualMatch.findUniqueOrThrow({ where: { id: match.id } }) : null;
    await fixture.archive('current-company-driver', { amount: undefined, recipientType: 'DRIVER', recipientId: `${key}-driver`, role: 'Company Driver' });
    const competingEvent = match ? await addEvent({ key: `${key}-competing`, date: '2026-06-10', truckId: fixture.truck.id, unit: fixture.truck.unitNumber, amount: minor(10_000), reference: `ticket-${key}`, locationNumber: key }) : null;
    const result = await service.preview(fixture.context, { pageSize: 10000 });
    const row = result.rows.find(item => item.pilotEventId === fixture.event.id)!;
    assert.equal(row.status, 'NEEDS_REVIEW');
    assert.equal(row.ownerAttribution, null);
    assert.equal(row.expectedMinor, null, 'Company-driver zero recovery must not mask matched Contractor evidence');
    assert.equal(row.responsibility, null);
    assert.equal(row.policyId, null);
    assert.equal(row.recipientId, null);
    assert.equal(row.differenceMinor, null);
    if (match) {
      assert.equal(row.matchMethod, 'MANUAL_OWNER_MATCH');
      assert.equal(row.manualMatch?.id, match.id);
      assert.deepEqual(row.statementEvidence?.lineIds, [source.id]);
      assert.equal(row.statementMinor, minor(10_000));
      assert.equal(result.rows.filter(item => item.statementEvidence?.lineIds.includes(source.id)).length, 1);
      const competingRow = result.rows.find(item => item.pilotEventId === competingEvent!.id);
      assert.ok(competingRow);
      assert.equal(competingRow.statementEvidence, null, 'a competing event cannot consume the manually reserved Contractor line');
      assert.deepEqual(await db.fuelReconciliationManualMatch.findUniqueOrThrow({ where: { id: match.id } }), persisted);
    } else {
      assert.equal(row.matchMethod, 'NO_CONFIRMED_OWNER');
      await assertAmbiguousSourcesRemainUnconsumed(result, fixture.event.id, [posted.id], minor(10_000));
    }
    assert.equal(result.completeness.orphanActiveManualMatches, 0);
    assert.equal(result.completeness.duplicateConsumedEvidence, 0);
    assert.deepEqual(await db.archiveLine.findUniqueOrThrow({ where: { id: source.id } }), source);
  });
}

test('owner editor options use live authority and verified scoped identities only', async () => {
  const fixture = await ambiguityFixture('owner-editor-options');
  await fixture.archive('contractor');
  await fixture.archive('driver-only', { recipientType: 'DRIVER', recipientId: 'synthetic-driver-not-contractor' });
  const owners = new TruckOwnerHistoryService(db);
  const foreignParty = await db.financialParty.create({ data: { operatingGroupId: groupId, companyId: conflictCompanyId, type: 'OWNER_OPERATOR', name: 'Synthetic foreign editor owner' } });
  const inactive = await db.financialParty.create({ data: { operatingGroupId: groupId, type: 'OWNER_OPERATOR', name: 'Synthetic inactive editor owner', isActive: false } });
  const result = await owners.options(fixture.truck.id, fixture.context);
  assert.equal(result.canManage, true);
  assert.ok(result.recipients.some(r => r.id === fixture.recipientId && r.companyId === companyId));
  assert.ok(result.recipients.every(r => r.id !== 'synthetic-driver-not-contractor' && r.companyId === companyId));
  assert.ok(result.owners.every(p => p.id !== foreignParty.id && p.id !== inactive.id));
  assert.ok(result.companies.every(c => c.id === companyId));
  assert.equal(result.recipients.filter(r => r.id === fixture.recipientId && r.companyId === companyId).length, 1);
  const current = await owners.history(fixture.truck.id, fixture.context);
  assert.ok(result.owners.some(p => p.id === current.periods[0].ownerPartyId));
  const admin = await db.user.create({ data: { email: `${dbName}-owner-editor-admin@example.test`, displayName: 'Synthetic read-only editor', memberships: { create: { companyId, role: 'ADMIN' } }, operatingGroupMemberships: { create: { operatingGroupId: groupId, role: 'ADMIN' } } } });
  const context = { ...fixture.context, userId: admin.id };
  assert.equal((await owners.options(fixture.truck.id, context)).canManage, false);
  await db.companyMembership.deleteMany({ where: { userId: admin.id } });
  await assert.rejects(owners.options(fixture.truck.id, context), AuthorizationDeniedError);
  await assert.rejects(owners.options(fixture.truck.id, { ...fixture.context, companyIds: [] }), AuthorizationDeniedError);
});

test('owner-history entry rejects spoofed authority and corrections retain immutable audited history', async () => {
  const fixture = await ambiguityFixture('history-correction');
  await fixture.archive('recipient');
  const owners = new TruckOwnerHistoryService(db);
  const before = await owners.history(fixture.truck.id, fixture.context);
  const period = before.periods[0];
  const input = { expectedRevisionId: before.revisionId, sourceReference: 'Synthetic corrected evidence', reason: 'Bound historical evidence only', periods: [{ ownerPartyId: period.ownerPartyId, companyId, providerRecipientId: fixture.recipientId, effectiveFrom: '2026-01-01', effectiveTo: '2026-09-01' }] };
  const member = await db.user.create({ data: { email: `${dbName}-owner-history-member@example.test`, displayName: 'Unprivileged history actor', memberships: { create: { companyId, role: 'MEMBER' } }, operatingGroupMemberships: { create: { operatingGroupId: groupId, role: 'MEMBER' } } } });
  await assert.rejects(owners.replace(fixture.truck.id, input, { ...fixture.context, userId: member.id }), AuthorizationDeniedError);
  await assert.rejects(owners.replace(fixture.truck.id, input, { ...fixture.context, companyIds: [] }), AuthorizationDeniedError);
  await assert.rejects(owners.replace(fixture.truck.id, { ...input, periods: [{ ...input.periods[0], companyId: conflictCompanyId }] }, fixture.context), AuthorizationDeniedError);
  const trucksBefore = await db.truck.findUniqueOrThrow({ where: { id: fixture.truck.id } });
  const economicsBefore = [await db.financialTransaction.count(), await db.financialAllocation.count(), await db.financialExpectation.count()];
  const attempts = await Promise.allSettled([owners.replace(fixture.truck.id, input, fixture.context), owners.replace(fixture.truck.id, input, fixture.context)]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
  const current = await owners.history(fixture.truck.id, fixture.context);
  assert.notEqual(current.revisionId, before.revisionId);
  assert.equal(current.periods[0].effectiveTo, '2026-09-01');
  assert.ok((await db.truckOwnerPeriod.findUniqueOrThrow({ where: { id: period.id } })).supersededAt);
  assert.equal(await db.truckOwnerHistoryRevision.count({ where: { truckId: fixture.truck.id } }), 2);
  assert.equal(await db.financialAuditEvent.count({ where: { action: 'TRUCK_OWNER_HISTORY_CONFIRMED', metadata: { path: ['truckId'], equals: fixture.truck.id } } }), 1);
  await assert.rejects(db.truckOwnerHistoryRevision.update({ where: { id: current.revisionId! }, data: { reason: 'Tamper' } }));
  await assert.rejects(db.truckOwnerPeriod.delete({ where: { id: current.periods[0].id } }));
  // This committed-revision insert exercises assembly sealing, not overlap.
  await assert.rejects(db.truckOwnerPeriod.create({ data: { truckId: fixture.truck.id, ownerPartyId: period.ownerPartyId, companyId, providerRecipientId: fixture.recipientId, effectiveFrom: historyDate('2026-06-01'), revisionId: current.revisionId! } }), /Owner snapshot can only be assembled in its creating transaction/);
  assert.deepEqual(await db.truck.findUniqueOrThrow({ where: { id: fixture.truck.id } }), trucksBefore);
  assert.deepEqual([await db.financialTransaction.count(), await db.financialAllocation.count(), await db.financialExpectation.count()], economicsBefore);
});

test('preview resolves a confirmed owner boundary despite overlapping weeks and late posting', async () => {
  const fixture = await ambiguityFixture('owner-boundary');
  const oldOwner = await db.financialParty.create({ data: { operatingGroupId: groupId, type: 'OWNER_OPERATOR', name: 'Synthetic previous owner' } });
  const newOwner = await db.financialParty.create({ data: { operatingGroupId: groupId, type: 'OWNER_OPERATOR', name: 'Synthetic next owner' } });
  const owners = new TruckOwnerHistoryService(db);
  await fixture.archive('old-assignment', { amount: undefined, recipientId: 'previous-recipient', pid: 'review-01' });
  const posted = await fixture.archive('late', { workStart: '2026-06-14', workEnd: '2026-06-20', reference: 'ticket-owner-boundary', dieselAmount: '100.00' });
  const revision = await owners.replace(fixture.truck.id, {
    expectedRevisionId: null, reason: 'Synthetic confirmed boundary', sourceReference: 'Synthetic purchase evidence',
    periods: [
      { ownerPartyId: oldOwner.id, companyId, providerRecipientId: 'previous-recipient', effectiveFrom: '2026-01-01', effectiveTo: '2026-06-10' },
      { ownerPartyId: newOwner.id, companyId, providerRecipientId: fixture.recipientId, effectiveFrom: '2026-06-10', effectiveTo: null },
    ],
  }, fixture.context);

  const sourceBefore = await db.archiveLine.findMany({ where: { versionId: posted.id } });
  const result = await service.preview(fixture.context, { pageSize: 10000 });
  const row = result.rows.find(item => item.pilotEventId === fixture.event.id)!;
  assert.equal(row.recipientId, fixture.recipientId);
  assert.equal(row.ownerAttribution?.ownerPartyId, newOwner.id);
  assert.equal(row.ownerAttribution?.revisionId, revision.revisionId);
  assert.equal(row.expectedMinor, minor(10_000));
  assert.equal(row.status, 'TIMING_DIFFERENCE');
  assert.equal(row.statementEvidence?.versionId, posted.id);
  const priorEvent = await addEvent({ key: 'owner-before-boundary', date: '2026-06-09', truckId: fixture.truck.id, unit: fixture.truck.unitNumber, amount: minor(10_000), reference: 'owner-before-ticket', locationNumber: 'owner-before' });
  await db.fuelDeductionPolicy.create({ data: { operatingGroupId: groupId, companyId, truckId: fixture.truck.id, providerRecipientId: 'previous-recipient', responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), sourceReference: 'Synthetic previous owner policy', reason: 'Fixture', approvedByUserId: userId } });
  await fixture.archive('prior-late', { recipientId: 'previous-recipient', sourceDate: '2026-06-09', sourceTimestamp: '2026-06-09T12:00:00Z', workStart: '2026-06-14', workEnd: '2026-06-20', reference: 'owner-before-ticket', merchant: 'owner-before', dieselAmount: '100.00' });
  const priorRow = (await service.preview(fixture.context, { pageSize: 10000 })).rows.find(item => item.pilotEventId === priorEvent.id)!;
  assert.equal(priorRow.ownerAttribution?.ownerPartyId, oldOwner.id);
  assert.equal(priorRow.recipientId, 'previous-recipient');
  assert.equal(priorRow.expectedMinor, minor(10_000));
  assert.equal(priorRow.status, 'TIMING_DIFFERENCE');
  assert.equal(result.completeness.duplicateConsumedEvidence, 0);
  assert.deepEqual(await db.archiveLine.findMany({ where: { versionId: posted.id } }), sourceBefore);
  await assert.rejects(owners.replace(fixture.truck.id, { expectedRevisionId: null, reason: 'Stale', sourceReference: 'Synthetic', periods: [{ ownerPartyId: newOwner.id, companyId, providerRecipientId: fixture.recipientId, effectiveFrom: '2026-01-01', effectiveTo: null }] }, fixture.context), /changed/);
});

test('owner history HTTP handlers enforce auth, validate bodies and surface stale versions', async t => {
  const fixture = await ambiguityFixture('http-owner-history');
  await fixture.archive('recipient');
  const owners = new TruckOwnerHistoryService(db);
  // Keep real handlers and real service/DB checks; replace only request identity
  // resolution and the singleton's DB selection with this disposable fixture.
  t.mock.method(truckOwnerHistoryService, 'history', owners.history.bind(owners));
  t.mock.method(truckOwnerHistoryService, 'options', owners.options.bind(owners));
  t.mock.method(truckOwnerHistoryService, 'replace', owners.replace.bind(owners));
  const params = { params: Promise.resolve({ id: fixture.truck.id }) };
  const request = (body: string) => new Request('http://localhost/api/trucks/synthetic/owner-history', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
  const denied = t.mock.method(financialControlAuthorization, 'requireContext', async () => { throw new AuthenticationRequiredError(); });
  assert.equal((await ownerHistoryGET(new Request('http://localhost'), params)).status, 401);
  const deniedOptions = await ownerOptionsGET(new Request('http://localhost'), params);
  assert.equal(deniedOptions.status, 401);
  assert.equal(deniedOptions.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await ownerHistoryPOST(request('null'), params)).status, 401);
  denied.mock.restore();
  const requirements: string[] = [];
  t.mock.method(financialControlAuthorization, 'requireContext', async (role = 'ADMIN') => { requirements.push(role); return fixture.context; });
  const get = await ownerHistoryGET(new Request('http://localhost'), params);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('Cache-Control'), 'private, no-store');
  const optionsResponse = await ownerOptionsGET(new Request('http://localhost'), params);
  assert.equal(optionsResponse.status, 200);
  assert.equal(optionsResponse.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await optionsResponse.json(), await owners.options(fixture.truck.id, fixture.context));
  const initial = await owners.history(fixture.truck.id, fixture.context);
  for (const body of ['{', 'null', '{}', '[]']) assert.equal((await ownerHistoryPOST(request(body), params)).status, 400);
  const input = { expectedRevisionId: initial.revisionId, reason: 'Synthetic HTTP correction', sourceReference: 'Synthetic evidence', periods: initial.periods };
  assert.equal((await ownerHistoryPOST(request(JSON.stringify(input)), params)).status, 200);
  assert.equal((await ownerHistoryPOST(request(JSON.stringify(input)), params)).status, 409);
  assert.deepEqual(requirements.slice(0, 2), ['ADMIN', 'ADMIN']);
  assert.ok(requirements.slice(2).every(role => role === 'OWNER'));
});

test('owner history rechecks ADMIN, inactive and revoked actors and refuses a partial foreign timeline', async () => {
  const fixture = await ambiguityFixture('owner-live-authority');
  await fixture.archive('recipient');
  const owners = new TruckOwnerHistoryService(db);
  const current = await owners.history(fixture.truck.id, fixture.context);
  const input = { expectedRevisionId: current.revisionId, reason: 'Synthetic', sourceReference: 'Synthetic', periods: current.periods };
  for (const kind of ['admin', 'inactive', 'revoked'] as const) {
    const actor = await db.user.create({ data: { email: `${dbName}-owner-live-authority-${kind}@example.test`, displayName: `Synthetic ${kind}`, isActive: kind !== 'inactive', memberships: { create: { companyId, role: kind === 'admin' ? 'ADMIN' : 'OWNER' } }, operatingGroupMemberships: { create: { operatingGroupId: groupId, role: kind === 'admin' ? 'ADMIN' : 'OWNER' } } } });
    const context = { ...fixture.context, userId: actor.id };
    if (kind === 'revoked') await db.companyMembership.deleteMany({ where: { userId: actor.id } });
    if (kind === 'admin') {
      assert.equal((await owners.history(fixture.truck.id, context)).revisionId, current.revisionId);
      assert.equal((await owners.options(fixture.truck.id, context)).canManage, false);
    } else {
      await assert.rejects(owners.history(fixture.truck.id, context), AuthorizationDeniedError);
      await assert.rejects(owners.options(fixture.truck.id, context), AuthorizationDeniedError);
    }
    await assert.rejects(owners.replace(fixture.truck.id, input, context), AuthorizationDeniedError);
  }
  await db.$transaction(async tx => {
    const next = await tx.truckOwnerHistoryRevision.create({ data: { truckId: fixture.truck.id, operatingGroupId: groupId, actorUserId: userId, previousRevisionId: current.revisionId, reason: 'Synthetic foreign period', sourceReference: 'Synthetic' } });
    await tx.truckOwnerPeriod.updateMany({ where: { truckId: fixture.truck.id, supersededAt: null }, data: { supersededAt: new Date() } });
    await tx.truckOwnerPeriod.create({ data: { truckId: fixture.truck.id, revisionId: next.id, ownerPartyId: current.periods[0].ownerPartyId, companyId: conflictCompanyId, providerRecipientId: 'synthetic-foreign', effectiveFrom: historyDate('2026-01-01') } });
  });
  await assert.rejects(owners.history(fixture.truck.id, fixture.context), AuthorizationDeniedError);
  await assert.rejects(owners.options(fixture.truck.id, fixture.context), AuthorizationDeniedError);
  await assert.rejects(owners.replace(fixture.truck.id, input, fixture.context), AuthorizationDeniedError);
});

test('synthetic active manual pairing survives owner correction without changing evidence or audit identity', async () => {
  // This is not a reconstruction or claim about any real Truck 042 source row.
  const fixture = await ambiguityFixture('manual-owner-correction');
  const posted = await fixture.archive('late-posting', { providerLineId: null, workStart: '2026-06-14', workEnd: '2026-06-20' });
  // Ambiguous automatic candidates make an explicit manual pairing necessary.
  const unpaired = await fixture.archive('late-other', { providerLineId: null, sourceTimestamp: '2026-06-10T11:00:00Z', workStart: '2026-06-14', workEnd: '2026-06-20' });
  const otherLine = await db.archiveLine.findFirstOrThrow({ where: { versionId: unpaired.id } });
  const line = await db.archiveLine.findFirstOrThrow({ where: { versionId: posted.id } });
  const match = await service.createManualMatch({ pilotEventId: fixture.event.id, archiveLineId: line.id, reason: 'Synthetic explicit source pairing' }, fixture.context);
  const persisted = await db.fuelReconciliationManualMatch.findUniqueOrThrow({ where: { id: match.id } });
  const before = (await service.preview(fixture.context, { pageSize: 10000 })).rows.find(row => row.pilotEventId === fixture.event.id)!;
  assert.equal(before.status, 'TIMING_DIFFERENCE');
  assert.equal(before.expectedMinor, minor(10_000));
  const owners = new TruckOwnerHistoryService(db);
  const history = await owners.history(fixture.truck.id, fixture.context);
  const original = history.periods[0];
  const correction = { expectedRevisionId: history.revisionId, reason: 'Synthetic corrected coverage', sourceReference: 'Synthetic reviewed evidence', periods: [{ ownerPartyId: original.ownerPartyId, companyId, providerRecipientId: fixture.recipientId, effectiveFrom: '2026-02-01', effectiveTo: null }] };
  const corrected = await owners.replace(fixture.truck.id, correction, fixture.context);
  const compatible = (await service.preview(fixture.context, { pageSize: 10000 })).rows.find(row => row.pilotEventId === fixture.event.id)!;
  assert.equal(compatible.status, before.status);
  assert.equal(compatible.expectedMinor, before.expectedMinor);
  assert.equal(compatible.pilotActualMinor, before.pilotActualMinor);
  assert.equal(compatible.statementMinor, before.statementMinor);
  assert.deepEqual(compatible.manualMatch, before.manualMatch);
  assert.equal(compatible.ownerAttribution?.revisionId, corrected.revisionId);

  const nextParty = await db.financialParty.create({ data: { operatingGroupId: groupId, type: 'OWNER_OPERATOR', name: 'Synthetic corrected owner' } });
  const nextRecipient = 'synthetic-manual-corrected-recipient';
  await fixture.archive('next-assignment', { recipientId: nextRecipient, amount: undefined });
  await db.fuelDeductionPolicy.create({ data: { operatingGroupId: groupId, companyId, truckId: fixture.truck.id, providerRecipientId: nextRecipient, responsibility: 'RECIPIENT', discountTreatment: 'FULL_PASS_THROUGH', companyRetentionBasisPoints: 0, effectiveFrom: historyDate('2026-01-01'), approvedByUserId: userId, reason: 'Synthetic', sourceReference: 'Synthetic' } });
  await owners.replace(fixture.truck.id, { ...correction, expectedRevisionId: corrected.revisionId, periods: [{ ...correction.periods[0], ownerPartyId: nextParty.id, providerRecipientId: nextRecipient }] }, fixture.context);
  const result = await service.preview(fixture.context, { pageSize: 10000 });
  const row = result.rows.find(item => item.pilotEventId === fixture.event.id)!;
  assert.equal(row.status, 'NEEDS_RECIPIENT_REVIEW');
  assert.equal(row.recipientId, nextRecipient);
  assert.equal(row.statementRecipientId, fixture.recipientId);
  assert.equal(row.matchMethod, 'MANUAL_OWNER_MATCH');
  assert.equal(row.expectedMinor, before.expectedMinor);
  assert.equal(row.pilotActualMinor, before.pilotActualMinor);
  assert.equal(row.statementMinor, before.statementMinor);
  assert.deepEqual(row.manualMatch, before.manualMatch);
  assert.deepEqual(row.statementEvidence, before.statementEvidence);
  assert.equal(result.rows.filter(item => item.statementEvidence?.lineIds.includes(line.id)).length, 1);
  assert.equal(result.completeness.orphanActiveManualMatches, 0);
  assert.equal(result.completeness.duplicateConsumedEvidence, 0);
  assert.deepEqual(await db.archiveLine.findUniqueOrThrow({ where: { id: line.id } }), line);
  assert.deepEqual(await db.archiveLine.findUniqueOrThrow({ where: { id: otherLine.id } }), otherLine);
  const unpairedRows = result.rows.filter(item => item.statementEvidence?.lineIds.includes(otherLine.id));
  assert.equal(unpairedRows.length, 1);
  assert.equal(unpairedRows[0].pilotEventId, null);
  assert.equal(unpairedRows[0].statementMinor, minor(10_000));
  assert.deepEqual(await db.fuelReconciliationManualMatch.findUniqueOrThrow({ where: { id: match.id } }), persisted);
});

for (const sourceFormat of ['LEGACY_XLS', 'PIPE_INVOICE', 'PORTAL_XLSX', 'UNKNOWN']) {
  test(`preview fails closed at synthetic Sunday owner transition for ${sourceFormat}`, async () => {
    const fixture = await ambiguityFixture(`date-boundary-${sourceFormat}`);
    const owners = new TruckOwnerHistoryService(db);
    const prior = await owners.history(fixture.truck.id, fixture.context);
    await fixture.archive('prior', { amount: undefined });
    const recipientId = `new-${fixture.recipientId}`;
    const nextParty = await db.financialParty.create({ data: { operatingGroupId: groupId, type: 'OWNER_OPERATOR', name: `Synthetic Sunday owner ${sourceFormat}` } });
    await fixture.archive('next', { recipientId, amount: undefined, workStart: '2026-09-20', workEnd: '2026-09-26' });
    await owners.replace(fixture.truck.id, { expectedRevisionId: prior.revisionId, reason: 'Synthetic Sunday transition', sourceReference: 'Synthetic', periods: [
      { ownerPartyId: prior.periods[0].ownerPartyId, companyId, providerRecipientId: fixture.recipientId, effectiveFrom: '2026-01-01', effectiveTo: '2026-09-20' },
      { ownerPartyId: nextParty.id, companyId, providerRecipientId: recipientId, effectiveFrom: '2026-09-20', effectiveTo: null },
    ] }, fixture.context);
    const event = await addEvent({ key: `sunday-${sourceFormat}`, date: '2026-09-20', sourceFormat, truckId: fixture.truck.id, unit: fixture.truck.unitNumber, amount: minor(10_000), locationNumber: `sunday-${sourceFormat}` });
    const row = (await service.preview(fixture.context, { pageSize: 10000 })).rows.find(item => item.pilotEventId === event.id)!;
    assert.equal(row.status, 'NEEDS_REVIEW');
    assert.equal(row.matchMethod, 'NEEDS_BUSINESS_DATE');
    assert.equal(row.ownerAttribution, null);
    assert.equal(row.expectedMinor, null);
    assert.equal(row.statementEvidence, null);
  });
}

test('owner snapshot overlap is rejected within its creating transaction by the snapshot exclusion', async () => {
  const fixture = await ambiguityFixture('snapshot-same-tx-overlap');
  const previous = await db.truckOwnerHistoryRevision.findFirstOrThrow({ where: { truckId: fixture.truck.id } });
  const original = await db.truckOwnerPeriod.findFirstOrThrow({ where: { revisionId: previous.id } });
  await assert.rejects(db.$transaction(async tx => {
    await tx.truckOwnerPeriod.update({ where: { id: original.id }, data: { supersededAt: new Date() } });
    const next = await tx.truckOwnerHistoryRevision.create({ data: { truckId: fixture.truck.id, operatingGroupId: groupId, actorUserId: userId, previousRevisionId: previous.id, sourceReference: 'Synthetic overlap isolation', reason: 'Synthetic' } });
    await tx.truckOwnerPeriod.create({ data: { truckId: fixture.truck.id, ownerPartyId: original.ownerPartyId, companyId, providerRecipientId: fixture.recipientId, effectiveFrom: historyDate('2026-01-01'), effectiveTo: historyDate('2026-07-01'), revisionId: next.id } });
    // Snapshot is already nonempty; the revision is fresh, and old rows retired.
    // Use raw SQL so the assertion names the actual PostgreSQL exclusion guard.
    await tx.$executeRaw`INSERT INTO "TruckOwnerPeriod" (id, "truckId", "ownerPartyId", "companyId", "providerRecipientId", "effectiveFrom", "effectiveTo", "revisionId")
      VALUES (${randomUUID()}, ${fixture.truck.id}, ${original.ownerPartyId}, ${companyId}, ${fixture.recipientId}, DATE '2026-06-01', DATE '2026-08-01', ${next.id})`;
  }), /owner_snapshot_no_overlap/);
  assert.deepEqual(await db.truckOwnerPeriod.findUniqueOrThrow({ where: { id: original.id } }), original);
  assert.equal(await db.truckOwnerHistoryRevision.count({ where: { truckId: fixture.truck.id } }), 1);
});

test('owner snapshot partial retirement rejects one surviving period of a multi-period predecessor', async () => {
  const fixture = await ambiguityFixture('snapshot-partial-retirement');
  await fixture.archive('recipient', { amount: undefined });
  const owners = new TruckOwnerHistoryService(db);
  const initial = await owners.history(fixture.truck.id, fixture.context);
  const binding = { ownerPartyId: initial.periods[0].ownerPartyId, companyId, providerRecipientId: fixture.recipientId };
  const split = await owners.replace(fixture.truck.id, { expectedRevisionId: initial.revisionId, sourceReference: 'Synthetic two-period snapshot', reason: 'Synthetic', periods: [
    { ...binding, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-01' },
    { ...binding, effectiveFrom: '2026-06-01', effectiveTo: null },
  ] }, fixture.context);
  const before = await db.truckOwnerPeriod.findMany({ where: { revisionId: split.revisionId }, orderBy: { effectiveFrom: 'asc' } });
  assert.equal(before.length, 2);
  await assert.rejects(db.$transaction(async tx => {
    const next = await tx.truckOwnerHistoryRevision.create({ data: { truckId: fixture.truck.id, operatingGroupId: groupId, actorUserId: userId, previousRevisionId: split.revisionId, sourceReference: 'Synthetic partial retirement', reason: 'Synthetic' } });
    await tx.truckOwnerPeriod.update({ where: { id: before[0].id }, data: { supersededAt: new Date() } });
    // The successor is nonempty and does not overlap the remaining active row.
    await tx.truckOwnerPeriod.create({ data: { ...binding, truckId: fixture.truck.id, revisionId: next.id, effectiveFrom: before[0].effectiveFrom, effectiveTo: before[0].effectiveTo } });
    await tx.$executeRaw`SET CONSTRAINTS owner_period_consistent IMMEDIATE`;
  }), /Owner period scope or revision mismatch/);
  assert.deepEqual(await db.truckOwnerPeriod.findMany({ where: { revisionId: split.revisionId }, orderBy: { effectiveFrom: 'asc' } }), before);
  assert.equal((await owners.history(fixture.truck.id, fixture.context)).revisionId, split.revisionId);
});

test('owner revision overrides caller creation stamp and still rejects post-commit append', async () => {
  const fixture = await ambiguityFixture('snapshot-stamp-override');
  const previous = await db.truckOwnerHistoryRevision.findFirstOrThrow({ where: { truckId: fixture.truck.id } });
  const original = await db.truckOwnerPeriod.findFirstOrThrow({ where: { revisionId: previous.id } });
  const next = await db.$transaction(async tx => {
    const [current] = await tx.$queryRaw<{ transactionId: bigint }[]>`SELECT txid_current() AS "transactionId"`;
    const revision = await tx.truckOwnerHistoryRevision.create({ data: { truckId: fixture.truck.id, operatingGroupId: groupId, actorUserId: userId, previousRevisionId: previous.id, sourceReference: 'Synthetic caller stamp override', reason: 'Synthetic', creationTransactionId: BigInt(-1) } });
    const stored = await tx.truckOwnerHistoryRevision.findUniqueOrThrow({ where: { id: revision.id } });
    assert.equal(stored.creationTransactionId, current.transactionId);
    assert.notEqual(stored.creationTransactionId, BigInt(-1));
    await tx.truckOwnerPeriod.update({ where: { id: original.id }, data: { supersededAt: new Date() } });
    await tx.truckOwnerPeriod.create({ data: { truckId: fixture.truck.id, ownerPartyId: original.ownerPartyId, companyId, providerRecipientId: fixture.recipientId, effectiveFrom: original.effectiveFrom, revisionId: revision.id } });
    return stored;
  });
  assert.deepEqual(await db.truckOwnerHistoryRevision.findUniqueOrThrow({ where: { id: next.id } }), next);
  // Nonoverlapping dates isolate the closed assembly window from exclusion checks.
  await assert.rejects(db.truckOwnerPeriod.create({ data: { truckId: fixture.truck.id, ownerPartyId: original.ownerPartyId, companyId, providerRecipientId: fixture.recipientId, effectiveFrom: historyDate('2025-01-01'), effectiveTo: historyDate('2025-02-01'), revisionId: next.id } }), /Owner snapshot can only be assembled in its creating transaction/);
  assert.equal(await db.truckOwnerPeriod.count({ where: { revisionId: next.id } }), 1);
});

test('owner snapshots reject post-commit edits, incomplete replacement and invalid revision chains', async () => {
  const fixture = await ambiguityFixture('snapshot-integrity');
  const revision = await db.truckOwnerHistoryRevision.findFirstOrThrow({ where: { truckId: fixture.truck.id } });
  const period = await db.truckOwnerPeriod.findFirstOrThrow({ where: { revisionId: revision.id } });
  const revisionData = { truckId: fixture.truck.id, operatingGroupId: groupId, actorUserId: userId, sourceReference: 'Synthetic snapshot tamper test', reason: 'Synthetic' };
  const periodData = { truckId: fixture.truck.id, ownerPartyId: period.ownerPartyId, companyId, providerRecipientId: fixture.recipientId, effectiveFrom: historyDate('2025-01-01'), effectiveTo: historyDate('2025-02-01'), revisionId: revision.id };
  // Non-overlapping append: this must fail independently of the overlap constraint.
  await assert.rejects(db.truckOwnerPeriod.create({ data: periodData }), /Owner snapshot can only be assembled in its creating transaction/);
  await assert.rejects(db.truckOwnerPeriod.update({ where: { id: period.id }, data: { supersededAt: new Date() } }), /Owner period scope or revision mismatch/);
  await assert.rejects(db.truckOwnerPeriod.update({ where: { id: period.id }, data: { providerRecipientId: 'tampered' } }), /Only superseding an owner period is allowed/);
  await assert.rejects(db.truckOwnerHistoryRevision.create({ data: { ...revisionData, previousRevisionId: revision.id } }), /Owner revision requires a complete nonempty snapshot/);
  // Isolate completeness from retirement: even fully retired old rows require a
  // nonempty successor, and a successor must retire *all* old active rows.
  await assert.rejects(db.$transaction(async tx => {
    await tx.truckOwnerPeriod.update({ where: { id: period.id }, data: { supersededAt: new Date() } });
    await tx.truckOwnerHistoryRevision.create({ data: { ...revisionData, previousRevisionId: revision.id } });
  }), /Owner revision requires a complete nonempty snapshot/);
  await assert.rejects(db.$transaction(async tx => {
    const next = await tx.truckOwnerHistoryRevision.create({ data: { ...revisionData, previousRevisionId: revision.id } });
    await tx.truckOwnerPeriod.create({ data: { ...periodData, revisionId: next.id } });
  }), /Owner period scope or revision mismatch/);
  await assert.rejects(db.truckOwnerHistoryRevision.update({ where: { id: revision.id }, data: { creationTransactionId: BigInt(0) } }), /Truck owner history is append-only/);
  const emptyTruck = await db.truck.create({ data: { companyId, unitNumber: 'SYNTHETIC-EMPTY-ROOT' } });
  await assert.rejects(db.truckOwnerHistoryRevision.create({ data: { ...revisionData, truckId: emptyTruck.id } }), /Owner revision requires a complete nonempty snapshot/);
  const self = randomUUID();
  await assert.rejects(db.truckOwnerHistoryRevision.create({ data: { ...revisionData, id: self, previousRevisionId: self } }), /Owner revision requires an existing same-Truck\/group predecessor/);
  await assert.rejects(db.truckOwnerHistoryRevision.create({ data: { ...revisionData, previousRevisionId: randomUUID() } }), /Owner revision requires an existing same-Truck\/group predecessor/);
  const other = await ambiguityFixture('snapshot-other-truck');
  await assert.rejects(db.truckOwnerHistoryRevision.create({ data: { ...revisionData, truckId: other.truck.id, previousRevisionId: revision.id } }), /Owner revision requires an existing same-Truck\/group predecessor/);
  const foreignGroup = await db.operatingGroup.create({ data: { name: 'Synthetic foreign revision group' } });
  await assert.rejects(db.truckOwnerHistoryRevision.create({ data: { ...revisionData, operatingGroupId: foreignGroup.id, previousRevisionId: revision.id } }), /Owner revision requires an existing same-Truck\/group predecessor/);
  await assert.rejects(db.truckOwnerPeriod.create({ data: { ...periodData, truckId: other.truck.id } }), /Owner snapshot can only be assembled in its creating transaction/);
  const a = randomUUID(), b = randomUUID();
  await assert.rejects(db.$executeRaw`INSERT INTO "TruckOwnerHistoryRevision" (id, "truckId", "operatingGroupId", "actorUserId", "previousRevisionId", "sourceReference", reason)
    VALUES (${a}, ${fixture.truck.id}, ${groupId}, ${userId}, ${b}, 'Synthetic cycle', 'Synthetic'),
           (${b}, ${fixture.truck.id}, ${groupId}, ${userId}, ${a}, 'Synthetic cycle', 'Synthetic')`, /Owner revision requires an existing same-Truck\/group predecessor/);
  assert.deepEqual(await db.truckOwnerPeriod.findUniqueOrThrow({ where: { id: period.id } }), period);
  assert.equal(await db.truckOwnerHistoryRevision.count({ where: { truckId: fixture.truck.id } }), 1);

  // Retirement may precede successor insertion within the same atomic replacement.
  const next = await db.$transaction(async tx => {
    await tx.truckOwnerPeriod.update({ where: { id: period.id }, data: { supersededAt: new Date() } });
    const result = await tx.truckOwnerHistoryRevision.create({ data: { ...revisionData, previousRevisionId: revision.id } });
    await tx.truckOwnerPeriod.create({ data: { ...periodData, effectiveFrom: period.effectiveFrom, effectiveTo: null, revisionId: result.id } });
    return result;
  });
  const final = await db.$transaction(async tx => {
    const result = await tx.truckOwnerHistoryRevision.create({ data: { ...revisionData, previousRevisionId: next.id } });
    // New periods before old retirement is also a legitimate atomic replacement.
    await tx.truckOwnerPeriod.create({ data: { ...periodData, effectiveFrom: period.effectiveFrom, effectiveTo: null, revisionId: result.id } });
    await tx.truckOwnerPeriod.updateMany({ where: { revisionId: next.id }, data: { supersededAt: new Date() } });
    return result;
  });
  const snapshot = await db.truckOwnerPeriod.findMany({ where: { truckId: fixture.truck.id }, orderBy: { id: 'asc' } });
  // A complete replacement that aborts must restore both snapshot and version identity.
  await assert.rejects(db.$transaction(async tx => {
    const failed = await tx.truckOwnerHistoryRevision.create({ data: { ...revisionData, previousRevisionId: final.id } });
    await tx.truckOwnerPeriod.updateMany({ where: { revisionId: final.id }, data: { supersededAt: new Date() } });
    await tx.truckOwnerPeriod.create({ data: { ...periodData, revisionId: failed.id } });
    throw new Error('Synthetic rollback after complete replacement');
  }), /Synthetic rollback/);
  assert.deepEqual(await db.truckOwnerPeriod.findMany({ where: { truckId: fixture.truck.id }, orderBy: { id: 'asc' } }), snapshot);
  assert.equal(await db.truckOwnerHistoryRevision.count({ where: { truckId: fixture.truck.id } }), 3);
});

for (const path of ['reference', 'structured'] as const) {
  test(`confirmed owner mismatch stays review through historical ${path} matching`, async () => {
    const fixture = await ambiguityFixture(`owner-mismatch-${path}`);
    await fixture.archive('assignment', { amount: undefined });
    const other = await db.truck.create({ data: { companyId, unitNumber: `SYNTHETIC-${path}` } });
    const posted = await fixture.archive('wrong-owner', {
      recipientId: `synthetic-wrong-${path}`,
      ...(path === 'reference' ? { reference: `ticket-owner-mismatch-${path}` } : { truckId: other.id, unit: other.unitNumber }),
    });
    const sourceBefore = await db.archiveLine.findMany({ where: { versionId: posted.id } });
    const preview = await service.preview(fixture.context, { pageSize: 10000 });
    const row = preview.rows.find(item => item.pilotEventId === fixture.event.id)!;
    assert.equal(row.status, 'NEEDS_RECIPIENT_REVIEW');
    assert.equal(row.matchMethod, path === 'reference' ? 'REFERENCE' : 'CROSS_RECIPIENT_STRUCTURED_IDENTITY');
    assert.equal(row.recipientId, fixture.recipientId);
    assert.equal(row.statementRecipientId, `synthetic-wrong-${path}`);
    assert.ok(row.ownerAttribution);
    assert.equal(row.expectedMinor, minor(10_000));
    assert.equal(row.statementMinor, minor(10_000));
    assert.equal(row.differenceMinor, null);
    assert.deepEqual(row.statementEvidence?.lineIds, sourceBefore.map(line => line.id));
    assert.equal(preview.rows.filter(item => item.statementEvidence?.versionId === posted.id).length, 1);
    assert.deepEqual(await db.archiveLine.findMany({ where: { versionId: posted.id } }), sourceBefore);
  });
}

for (const path of ['direct', 'reference', 'historical-structured'] as const) {
  test(`same-ID standalone Driver is not the confirmed Contractor through ${path} matching`, async () => {
    const key = `typed-owner-${path}`;
    const fixture = await ambiguityFixture(key);
    await fixture.archive('contractor-assignment', { amount: undefined });
    const other = path === 'historical-structured' ? await db.truck.create({ data: { companyId, unitNumber: `SYNTHETIC-TYPED-${path}` } }) : null;
    const posted = await fixture.archive('standalone-driver', {
      recipientType: 'DRIVER', recipientId: fixture.recipientId,
      ...(path === 'reference' ? { reference: `ticket-${key}` } : {}),
      ...(other ? { truckId: other.id, unit: other.unitNumber } : {}),
    });
    const source = await db.archiveLine.findFirstOrThrow({ where: { versionId: posted.id } });
    const result = await service.preview(fixture.context, { pageSize: 10000 });
    const row = result.rows.find(item => item.pilotEventId === fixture.event.id)!;
    assert.equal(row.status, 'NEEDS_RECIPIENT_REVIEW');
    assert.equal(row.matchMethod, path === 'direct' ? 'TRUCK_DATE_CORROBORATED' : path === 'reference' ? 'REFERENCE' : 'CROSS_RECIPIENT_STRUCTURED_IDENTITY');
    assert.equal(row.recipientId, fixture.recipientId);
    assert.equal(row.statementRecipientId, fixture.recipientId, 'equal ID text does not make DRIVER and CONTRACTOR the same identity');
    assert.ok(row.ownerAttribution?.periodId);
    assert.equal(row.expectedMinor, minor(10_000));
    assert.equal(row.statementMinor, minor(10_000));
    assert.equal(row.differenceMinor, null);
    assert.deepEqual(row.statementEvidence?.lineIds, [source.id]);
    assert.equal(result.rows.filter(item => item.statementEvidence?.lineIds.includes(source.id)).length, 1);
    assert.equal(result.completeness.duplicateConsumedEvidence, 0);
    assert.deepEqual(await db.archiveLine.findUniqueOrThrow({ where: { id: source.id } }), source);
  });
}

test('synthetic missing-card cross-Company standalone Driver cannot confirm a scoped Contractor recovery by name', async () => {
  const key = 'missing-card-cross-company-driver';
  const fixture = await ambiguityFixture(key);
  const recipientName = 'Synthetic shared recipient name';
  await fixture.archive('assignment', { amount: undefined, recipientName, workStart: '2026-07-19', workEnd: '2026-08-01' });
  const event = await addEvent({ key: `${key}-sunday`, date: '2026-07-26', truckId: fixture.truck.id, unit: fixture.truck.unitNumber, amount: minor(10_000), retail: minor(10_000), quantity: '20.00', locationNumber: key });
  const posted = await fixture.archive('standalone-driver', {
    archiveCompanyId: conflictArchiveCompanyId, recipientType: 'DRIVER', recipientId: fixture.recipientId, recipientName,
    truckId: null, mappingStatus: 'NEEDS_REVIEW', cardNumber: null,
    sourceDate: '2026-07-25', sourceTimestamp: '2026-07-25T16:34:00Z', workStart: '2026-07-19', workEnd: '2026-07-25',
    amount: minor(10_000), dieselAmount: '100.00', dieselQuantity: '20.00',
  });
  const source = await db.archiveLine.findFirstOrThrow({ where: { versionId: posted.id } });
  const owner = await db.truckOwnerPeriod.findFirstOrThrow({ where: { truckId: fixture.truck.id, supersededAt: null } });
  const result = await service.preview({ ...fixture.context, companyIds: [companyId, conflictCompanyId] }, { pageSize: 10000 });
  const rows = result.rows.filter(item => item.pilotEventId === event.id);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.status, 'NEEDS_REVIEW');
  assert.equal(row.matchMethod, 'CROSS_COMPANY_IDENTITY_REVIEW');
  assert.equal(row.differenceMinor, null);
  assert.equal(row.expectedMinor, minor(10_000));
  assert.equal(row.statementMinor, minor(10_000));
  assert.equal(row.recipientId, fixture.recipientId);
  assert.equal(row.statementRecipientId, fixture.recipientId, 'same ID text and name cannot override Company/type scope');
  assert.equal(row.statementRecipientName, recipientName);
  assert.equal(row.ownerAttribution?.ownerPartyId, owner.ownerPartyId);
  assert.equal(row.ownerAttribution?.periodId, owner.id);
  assert.equal(row.ownerAttribution?.revisionId, owner.revisionId);
  assert.equal(row.statementEvidence?.versionId, posted.id);
  assert.deepEqual(row.statementEvidence?.lineIds, [source.id]);
  assert.equal(result.rows.filter(item => item.statementEvidence?.lineIds.includes(source.id)).length, 1);
  assert.equal(result.completeness.duplicateConsumedEvidence, 0);
  assert.deepEqual(await db.archiveLine.findUniqueOrThrow({ where: { id: source.id } }), source);
});

test('historical structured routing remains compatible for the confirmed recipient on another Truck', async () => {
  const fixture = await ambiguityFixture('compatible-routing');
  await fixture.archive('assignment', { amount: undefined });
  const other = await db.truck.create({ data: { companyId, unitNumber: 'SYNTHETIC-COMPATIBLE' } });
  await fixture.archive('posted', { truckId: other.id, unit: other.unitNumber });
  const row = (await service.preview(fixture.context, { pageSize: 10000 })).rows.find(item => item.pilotEventId === fixture.event.id)!;
  assert.equal(row.status, 'MATCHED');
  assert.equal(row.matchMethod, 'HISTORICAL_CROSS_RECIPIENT_RECOVERED');
  assert.equal(row.statementRecipientId, fixture.recipientId);
});

test('preview sends multiple cross-recipient identities to review without falling through to unmatched', async () => {
  const fixture = await ambiguityFixture('cross-recipient-collision');
  await fixture.archive('expected-assignment', { amount: undefined });
  const otherUnit = 'REVIEW-CROSS-OTHER';
  const otherTruck = await db.truck.create({ data: { companyId, unitNumber: otherUnit, unitNumberNormalized: otherUnit } });
  const first = await fixture.archive('one', { truckId: otherTruck.id, unit: otherUnit, recipientId: 'other-one', providerLineId: 'cross-one' });
  const second = await fixture.archive('two', { truckId: otherTruck.id, unit: otherUnit, recipientId: 'other-two', providerLineId: 'cross-two' });
  await assertAmbiguousSourcesRemainUnconsumed(
    await service.preview(fixture.context, { pageSize: 10000 }), fixture.event.id, [first.id, second.id], minor(20_000),
  );
});
