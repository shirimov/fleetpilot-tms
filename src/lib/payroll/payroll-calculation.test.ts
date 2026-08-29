import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePayrollPreview, type PayrollPreviewInput } from './payroll-calculation';

const perMile = { type: 'PER_MILE' as const, rateMinorPerMile: BigInt(65), percentageBasisPoints: null, percentageBase: null, appliesToTeam: false, teamAllocationStrategy: null };
const trips = [563, 921, 471, 921, 1310, 477].map((miles, index) => ({ id: `trip-${index}`, reference: `load-${index}`, miles: String(miles), mileageSource: 'LOAD_MILES' as const }));
const base = (overrides: Partial<PayrollPreviewInput> = {}): PayrollPreviewInput => ({ participantType: 'COMPANY_DRIVER', contract: perMile, trips, adjustments: [], ...overrides });

test('verified 4,663-mile regression uses exact minor-unit arithmetic', () => {
  const result = calculatePayrollPreview(base({ adjustments: [{ id: 'a1', category: 'REIMBURSEMENT', direction: 'CREDIT', amountMinor: BigInt(25000), description: 'Manual audit reference' }] }));
  assert.equal(result.eligibleMilesThousandths, BigInt(4663000));
  assert.equal(result.baseEarningMinor, BigInt(303095));
  assert.equal(result.calculatedPayoutMinor, BigInt(328095));
});

test('preview separates every debit component', () => {
  const result = calculatePayrollPreview(base({ adjustments: [
    { id: 'advance', category: 'ADVANCE', direction: 'DEBIT', amountMinor: BigInt(10000), description: 'Advance' },
    { id: 'fuel', category: 'FUEL', direction: 'DEBIT', amountMinor: BigInt(20000), description: 'Fuel' },
    { id: 'toll', category: 'TOLL', direction: 'DEBIT', amountMinor: BigInt(3000), description: 'Toll' },
    { id: 'deduction', category: 'DEDUCTION', direction: 'DEBIT', amountMinor: BigInt(5000), description: 'Other' },
    { id: 'recurring', category: 'RECURRING_DEDUCTION', direction: 'DEBIT', amountMinor: BigInt(2000), description: 'Recurring' },
  ] }));
  assert.equal(result.debitMinor, BigInt(40000));
  assert.equal(result.calculatedPayoutMinor, BigInt(263095));
  assert.equal(result.components.fuel.amountMinor, BigInt(20000));
  assert.equal(result.components.tolls.amountMinor, BigInt(3000));
});

test('missing components remain unavailable instead of becoming fake zeroes', () => {
  const result = calculatePayrollPreview(base());
  assert.equal(result.components.fuel.amountMinor, null);
  assert.equal(result.components.fuel.availability, 'NOT_AVAILABLE');
  assert.equal(result.readiness, 'CALCULATED_WITH_WARNINGS');
});

test('missing contract and mileage block or warn safely', () => {
  const missingContract = calculatePayrollPreview(base({ contract: null }));
  assert.equal(missingContract.readiness, 'BLOCKED');
  const missingMiles = calculatePayrollPreview(base({ trips: [{ id: 'trip', reference: 'load', miles: null, mileageSource: 'LOAD_MILES' }] }));
  assert.equal(missingMiles.baseEarningMinor, null);
  assert.match(missingMiles.warnings.join(' '), /no mileage/i);
});

test('team mileage and unverified contractor percentage calculations fail closed', () => {
  const team = calculatePayrollPreview(base({ contract: { ...perMile, appliesToTeam: true, teamAllocationStrategy: 'UNKNOWN' } }));
  assert.equal(team.readiness, 'BLOCKED');
  assert.match(team.blockers.join(' '), /team-driver/i);
  const contractor = calculatePayrollPreview(base({ participantType: 'CONTRACTOR', contract: { type: 'PERCENTAGE', rateMinorPerMile: null, percentageBasisPoints: 8800, percentageBase: 'UNKNOWN', appliesToTeam: false, teamAllocationStrategy: null } }));
  assert.equal(contractor.readiness, 'BLOCKED');
  assert.match(contractor.blockers.join(' '), /percentage base/i);
});

test('external comparison reconciles exactly and otherwise stays separate', () => {
  const reconciled = calculatePayrollPreview(base({ adjustments: [{ id: 'a', category: 'REIMBURSEMENT', direction: 'CREDIT', amountMinor: BigInt(25000), description: 'Credit' }], externalReference: { earningMinor: BigInt(303095), reimbursementMinor: BigInt(25000), fuelMinor: BigInt(0), tollMinor: BigInt(0), deductionsMinor: BigInt(0), payoutMinor: BigInt(328095) } }));
  assert.equal(reconciled.readiness, 'RECONCILED');
  assert.equal(reconciled.payoutDifferenceMinor, BigInt(0));
  const mismatch = calculatePayrollPreview(base({ externalReference: { earningMinor: null, reimbursementMinor: null, fuelMinor: null, tollMinor: null, deductionsMinor: null, payoutMinor: BigInt(1) } }));
  assert.equal(mismatch.readiness, 'UNRECONCILED');
  assert.equal(mismatch.payoutDifferenceMinor, BigInt(303094));
});

test('recalculation is deterministic and idempotent', () => {
  assert.deepEqual(calculatePayrollPreview(base()), calculatePayrollPreview(base()));
});
