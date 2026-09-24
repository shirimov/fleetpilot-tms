import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFuelReconciliationControls, fuelReconciliationRowMatches, type FuelReconciliationRow, type FuelReconciliationStatus } from './fuel-deduction-reconciliation';

let rowNumber = 0;
const row = (status: FuelReconciliationStatus, values: Partial<FuelReconciliationRow> = {}) => ({
  key: `${status}-${++rowNumber}`, status, pilotActualMinor: BigInt(0), expectedMinor: null,
  statementMinor: BigInt(0), differenceMinor: null, historyDiffersFromPosted: false,
  ...values,
} as FuelReconciliationRow);

test('control aggregation assigns each queue its audited money basis and positive discrepancy magnitude', () => {
  const rows = [
    row('UNDER_DEDUCTED', { differenceMinor: BigInt(-125_000) }),
    row('OVER_DEDUCTED', { differenceMinor: BigInt(50_000) }),
    row('MISSING_DEDUCTION', { differenceMinor: BigInt(-104_651) }),
    row('MATCHED', { expectedMinor: BigInt(90_000) }),
    row('TIMING_DIFFERENCE', { expectedMinor: BigInt(25_000) }),
    row('STATEMENT_ONLY', { statementMinor: BigInt(70_000) }),
    row('NO_PILOT_DATA_IMPORTED', { statementMinor: BigInt(80_000) }),
    row('NEEDS_POLICY', { pilotActualMinor: BigInt(30_000) }),
    row('NEEDS_COMPANY_HISTORY', { pilotActualMinor: BigInt(40_000), historyDiffersFromPosted: true }),
    row('NEEDS_TRUCK_MAPPING', { statementMinor: BigInt(50_000) }),
  ];
  const controls = buildFuelReconciliationControls(rows);
  const byKey = Object.fromEntries(controls.map(control => [control.key, control]));
  assert.equal(controls.length, 18);
  for (const control of controls) {
    assert.equal(rows.filter(item => fuelReconciliationRowMatches(item, control.filter)).length, control.count, `${control.key} card/table parity`);
  }
  assert.deepEqual(byKey.MISSING_DEDUCTION.amounts, [{ amountMinor: BigInt(104_651), amountBasis: 'DISCREPANCY', amountLabel: 'potential missing' }]);
  assert.deepEqual(byKey.UNDER_DEDUCTED.amounts, [{ amountMinor: BigInt(125_000), amountBasis: 'DISCREPANCY', amountLabel: 'short' }]);
  assert.deepEqual(byKey.OVER_DEDUCTED.amounts, [{ amountMinor: BigInt(50_000), amountBasis: 'DISCREPANCY', amountLabel: 'excess' }]);
  assert.deepEqual(byKey.MATCHED.amounts, [{ amountMinor: BigInt(90_000), amountBasis: 'EXPECTED', amountLabel: 'reconciled' }]);
  assert.deepEqual(byKey.TIMING_DIFFERENCE.amounts, [{ amountMinor: BigInt(25_000), amountBasis: 'EXPECTED', amountLabel: 'timing amount' }]);
  assert.deepEqual(byKey.STATEMENT_ONLY.amounts, [{ amountMinor: BigInt(70_000), amountBasis: 'STATEMENT', amountLabel: 'statement amount' }]);
  assert.deepEqual(byKey.NO_PILOT_DATA_IMPORTED.amounts, [{ amountMinor: BigInt(80_000), amountBasis: 'STATEMENT', amountLabel: 'outside Pilot coverage' }]);
  assert.deepEqual(byKey.NEEDS_POLICY.amounts, [{ amountMinor: BigInt(30_000), amountBasis: 'PILOT', amountLabel: 'Pilot affected' }]);
  assert.deepEqual(byKey.NEEDS_TRUCK_MAPPING.amounts, [{ amountMinor: BigInt(50_000), amountBasis: 'STATEMENT', amountLabel: 'statement affected' }]);
  assert.deepEqual(byKey.HISTORICAL_POSTED_MISMATCH.amounts, [{ amountMinor: BigInt(40_000), amountBasis: 'PILOT', amountLabel: 'Pilot affected' }]);
});

test('control aggregation preserves canonical row counts and reports mixed bases separately', () => {
  const rows = [
    row('NEEDS_RECIPIENT_MAPPING', { pilotActualMinor: BigInt(10_000) }),
    row('NEEDS_RECIPIENT_MAPPING', { statementMinor: BigInt(20_000) }),
    row('NEEDS_REVIEW', { pilotActualMinor: BigInt(30_000) }),
  ];
  const controls = buildFuelReconciliationControls(rows);
  for (const control of controls) {
    assert.equal(rows.filter(item => fuelReconciliationRowMatches(item, control.filter)).length, control.count, `${control.key} card/table parity`);
  }
  const recipient = controls.find(control => control.key === 'NEEDS_RECIPIENT_MAPPING')!;
  assert.equal(recipient.count, rows.filter(item => item.status === 'NEEDS_RECIPIENT_MAPPING').length);
  assert.deepEqual(recipient.amounts, [
    { amountMinor: BigInt(10_000), amountBasis: 'PILOT', amountLabel: 'Pilot affected' },
    { amountMinor: BigInt(20_000), amountBasis: 'STATEMENT', amountLabel: 'statement affected' },
  ]);
  assert.deepEqual(controls.find(control => control.key === 'NEEDS_REVIEW')!.amounts, [
    { amountMinor: BigInt(30_000), amountBasis: 'PILOT', amountLabel: 'Pilot under review' },
  ]);
  assert.deepEqual(controls.find(control => control.key === 'PRODUCT_CLASSIFICATION_REVIEW')!.amounts, [
    { amountMinor: BigInt(0), amountBasis: 'PILOT', amountLabel: 'affected' },
  ]);
  assert.deepEqual(rows.filter(item => fuelReconciliationRowMatches(item, { queue: 'review' })).map(item => item.status), [
    'NEEDS_RECIPIENT_MAPPING', 'NEEDS_RECIPIENT_MAPPING', 'NEEDS_REVIEW',
  ]);
});
