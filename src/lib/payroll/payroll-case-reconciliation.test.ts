import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePayrollCase, type CaseComponent } from './payroll-case-reconciliation';

const sources = Object.fromEntries(['miles', 'rate', 'grossRevenue', 'earning', 'reimbursement', 'advances', 'fuel', 'toll', 'recurring', 'deductions', 'escrow', 'payout'].map((name) => [name, 'EXTERNAL_REFERENCE']));
const calculation = {
  blockers: [], eligibleMilesThousandths: '4663000', appliedRateMinorPerMile: '65', percentageBaseMinor: null,
  baseEarningMinor: '303095', calculatedPayoutMinor: '328095',
  components: {
    reimbursements: { amountMinor: '25000', availability: 'AVAILABLE' }, advances: { amountMinor: '0', availability: 'ZERO' },
    fuel: { amountMinor: '0', availability: 'ZERO' }, tolls: { amountMinor: '0', availability: 'ZERO' },
    recurringDeductions: { amountMinor: '0', availability: 'ZERO' }, deductions: { amountMinor: '0', availability: 'ZERO' },
    escrow: { amountMinor: '0', availability: 'ZERO' },
  },
};
const external = {
  milesThousandths: '4663000', rateMinorPerMile: '65', grossRevenueMinor: null, earningMinor: '303095',
  reimbursementMinor: '25000', advancesMinor: '0', fuelMinor: '0', tollMinor: '0', recurringMinor: '0',
  deductionsMinor: '0', escrowMinor: '0', payoutMinor: '328095',
};

test('synthetic 4,663-mile case reconciles every material component exactly', () => {
  const result = evaluatePayrollCase(calculation, external, sources);
  assert.equal(result.exactMatch, true);
  assert.equal(result.components.earning.difference, '0');
  assert.equal(result.components.payout.difference, '0');
});

for (const component of ['miles', 'rate', 'earning', 'reimbursement', 'advances', 'fuel', 'toll', 'recurring', 'deductions', 'escrow'] as CaseComponent[]) {
  test(`synthetic ${component} mismatch prevents exact match`, () => {
    const changed = { ...external } as Record<string, string | null>;
    const key = component === 'miles' ? 'milesThousandths' : component === 'rate' ? 'rateMinorPerMile' : component === 'earning' ? 'earningMinor' : component === 'reimbursement' ? 'reimbursementMinor' : component === 'advances' ? 'advancesMinor' : component === 'fuel' ? 'fuelMinor' : component === 'toll' ? 'tollMinor' : component === 'recurring' ? 'recurringMinor' : component === 'deductions' ? 'deductionsMinor' : 'escrowMinor';
    changed[key] = (BigInt(changed[key] ?? '0') + BigInt(1)).toString();
    const result = evaluatePayrollCase(calculation, changed as typeof external, sources);
    assert.equal(result.exactMatch, false);
    assert.ok(result.mismatches.includes(component));
  });
}

test('matching final payout cannot hide a component mismatch', () => {
  const result = evaluatePayrollCase(calculation, { ...external, fuelMinor: '1' }, sources);
  assert.equal(result.components.payout.exact, true);
  assert.equal(result.accidentalNetMatch, true);
  assert.equal(result.exactMatch, false);
});

test('unknown material input and calculation blocker fail closed deterministically', () => {
  const first = evaluatePayrollCase({ ...calculation, blockers: ['Missing pay contract.'] }, external, { ...sources, toll: 'UNAVAILABLE' });
  const second = evaluatePayrollCase({ ...calculation, blockers: ['Missing pay contract.'] }, external, { ...sources, toll: 'UNAVAILABLE' });
  assert.deepEqual(first, second);
  assert.equal(first.exactMatch, false);
  assert.equal(first.components.toll.materialUnknown, true);
});

test('contractor gross base is material when supplied', () => {
  const result = evaluatePayrollCase({ ...calculation, percentageBaseMinor: '1000000' }, { ...external, grossRevenueMinor: '999999' }, sources);
  assert.equal(result.exactMatch, false);
  assert.equal(result.components.grossRevenue.difference, '1');
});
