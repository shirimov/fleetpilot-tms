import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePayrollPreview } from './payroll-calculation';

const trip = { id: 'trip-1', reference: 'SYNTHETIC-1', miles: '100', mileageSource: 'LOAD_MILES' as const, grossRevenueMinor: BigInt(200000), linehaulMinor: BigInt(180000), fuelSurchargeMinor: BigInt(20000) };
const contract = { type: 'PER_MILE' as const, rateMinorPerMile: BigInt(65), percentageBasisPoints: null, percentageBase: null, appliesToTeam: false, teamAllocationStrategy: null, verificationStatus: 'ADMIN_VERIFIED', mileagePolicy: 'LOAD_MILES', deadheadPolicy: 'UNKNOWN', deadheadRateMinorPerMile: null };

test('solo verified per-mile remains deterministic', () => {
  const result = calculatePayrollPreview({ participantType: 'COMPANY_DRIVER', contract, trips: [trip], adjustments: [] });
  assert.equal(result.eligibleMilesThousandths, BigInt(100000)); assert.equal(result.baseEarningMinor, BigInt(6500));
});
test('team allocation blocks when unknown and splits exactly when configured', () => {
  const blocked = calculatePayrollPreview({ participantType: 'COMPANY_DRIVER', contract: { ...contract, appliesToTeam: true, teamAllocationStrategy: 'UNKNOWN' }, trips: [trip], adjustments: [] });
  assert.equal(blocked.readiness, 'BLOCKED');
  const split = calculatePayrollPreview({ participantType: 'COMPANY_DRIVER', contract: { ...contract, appliesToTeam: true, teamAllocationStrategy: 'SPLIT_50_50' }, trips: [trip], adjustments: [] });
  assert.equal(split.eligibleMilesThousandths, BigInt(50000)); assert.equal(split.excludedMilesThousandths, BigInt(50000)); assert.equal(split.baseEarningMinor, BigInt(3250));
});
test('custom team percentages and miles prevent implicit double payment', () => {
  const percent = calculatePayrollPreview({ participantType: 'COMPANY_DRIVER', contract: { ...contract, appliesToTeam: true, teamAllocationStrategy: 'CUSTOM_PERCENTAGE', teamAllocationPercent: 6000 }, trips: [trip], adjustments: [] });
  assert.equal(percent.eligibleMilesThousandths, BigInt(60000));
  const custom = calculatePayrollPreview({ participantType: 'COMPANY_DRIVER', contract: { ...contract, appliesToTeam: true, teamAllocationStrategy: 'CUSTOM_MILES' }, trips: [{ ...trip, allocatedMiles: '40' }], adjustments: [] });
  assert.equal(custom.eligibleMilesThousandths, BigInt(40000));
});
test('deadhead requires an explicit policy and rate', () => {
  const blocked = calculatePayrollPreview({ participantType: 'COMPANY_DRIVER', contract, trips: [{ ...trip, deadheadMiles: '20' }], adjustments: [] }); assert.equal(blocked.readiness, 'BLOCKED');
  const paid = calculatePayrollPreview({ participantType: 'COMPANY_DRIVER', contract: { ...contract, deadheadPolicy: 'PAID', deadheadRateMinorPerMile: BigInt(50) }, trips: [{ ...trip, deadheadMiles: '20' }], adjustments: [] }); assert.equal(paid.baseEarningMinor, BigInt(7500));
});
test('contractor percentage stays blocked for unknown base and calculates verified gross base', () => {
  const unknown = calculatePayrollPreview({ participantType: 'CONTRACTOR', contract: { ...contract, type: 'PERCENTAGE', rateMinorPerMile: null, percentageBasisPoints: 8800, percentageBase: 'UNKNOWN' }, trips: [trip], adjustments: [] }); assert.equal(unknown.readiness, 'BLOCKED');
  const verified = calculatePayrollPreview({ participantType: 'CONTRACTOR', contract: { ...contract, type: 'PERCENTAGE', rateMinorPerMile: null, percentageBasisPoints: 8800, percentageBase: 'GROSS_REVENUE' }, trips: [trip], adjustments: [] }); assert.equal(verified.baseEarningMinor, BigInt(176000));
});
test('fuel, toll, recurring, escrow, and advance remain separate preview components', () => {
  const categories = ['FUEL', 'TOLL', 'RECURRING_DEDUCTION', 'ESCROW', 'ADVANCE'] as const;
  const result = calculatePayrollPreview({ participantType: 'COMPANY_DRIVER', contract, trips: [trip], adjustments: categories.map((category, index) => ({ id: category, category, direction: 'DEBIT', amountMinor: BigInt((index + 1) * 100), description: category })) });
  assert.equal(result.components.fuel.amountMinor, BigInt(100)); assert.equal(result.components.tolls.amountMinor, BigInt(200)); assert.equal(result.components.recurringDeductions.amountMinor, BigInt(300)); assert.equal(result.components.escrow.amountMinor, BigInt(400)); assert.equal(result.components.advances.amountMinor, BigInt(500));
});
test('component comparison classifies a sanitized mismatch without auto-correction', () => {
  const result = calculatePayrollPreview({ participantType: 'COMPANY_DRIVER', contract, trips: [trip], adjustments: [], externalReference: { milesThousandths: BigInt(99000), earningMinor: BigInt(6400), reimbursementMinor: BigInt(0), fuelMinor: BigInt(100), tollMinor: BigInt(0), deductionsMinor: BigInt(0), payoutMinor: BigInt(6400) } });
  assert.deepEqual(new Set(result.differenceTypes), new Set(['MILEAGE_DIFFERENCE', 'RATE_DIFFERENCE', 'MISSING_FUEL'])); assert.equal(result.readiness, 'UNRECONCILED');
});
