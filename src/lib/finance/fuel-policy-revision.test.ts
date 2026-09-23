import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FinancialConflictError } from './financial-control-errors';
import { validateFuelPolicyRevisionEvidence } from './fuel-deduction-reconciliation';
import { fuelPolicyRevisionCases, heldFuelPolicyScopes } from '../../../tests/fixtures/fuel-policy-revision-cases';

test('21 audited real-shape scopes are evidence-bounded extensions totaling 36 rows and $21,569.26', () => {
  const extensions = fuelPolicyRevisionCases.filter(item => item.classification === 'SAME_RULE_EXTENSION');
  assert.equal(extensions.length, 21);
  assert.equal(extensions.reduce((sum, item) => sum + item.pendingRows, 0), 36);
  assert.equal(extensions.reduce((sum, item) => sum + BigInt(item.pendingPilotMinor), BigInt(0)), BigInt(2_156_926));
  for (const item of extensions) {
    assert.equal(item.contradictions, 0);
    assert.doesNotThrow(() => validateFuelPolicyRevisionEvidence({ currentFrom: item.currentFrom, currentTo: item.currentTo, effectiveFrom: item.proposedFrom, effectiveTo: item.proposedTo }, [...item.support], 0), `${item.company} Truck ${item.truck}`);
  }
});

test('the two exact-cent conflicts stay blocked and nine held scopes stay outside the plan', () => {
  const conflicts = fuelPolicyRevisionCases.filter(item => item.classification === 'CONFLICTING_RULE');
  assert.deepEqual(conflicts.map(item => item.truck), ['7773', '8479']);
  assert.equal(conflicts.reduce((sum, item) => sum + item.pendingRows, 0), 5);
  assert.equal(conflicts.reduce((sum, item) => sum + BigInt(item.pendingPilotMinor), BigInt(0)), BigInt(204_436));
  for (const item of conflicts) assert.throws(() => validateFuelPolicyRevisionEvidence({ currentFrom: item.currentFrom, currentTo: item.currentTo, effectiveFrom: item.proposedFrom, effectiveTo: item.proposedTo }, [...item.support], item.contradictions), FinancialConflictError);
  assert.deepEqual(heldFuelPolicyScopes, { scopes: 9, rows: 67, pilotMinor: '3045669' });
});

test('disjoint evidence cannot bridge an unsupported gap and adjacent boundary evidence can extend', () => {
  assert.throws(() => validateFuelPolicyRevisionEvidence({ currentFrom: '2026-07-01', currentTo: '2026-07-08', effectiveFrom: '2026-07-01', effectiveTo: '2026-07-28' }, [{ supportFrom: '2026-07-20', supportTo: '2026-07-28' }], 0), FinancialConflictError);
  assert.doesNotThrow(() => validateFuelPolicyRevisionEvidence({ currentFrom: '2026-07-01', currentTo: '2026-07-08', effectiveFrom: '2026-07-01', effectiveTo: '2026-07-09' }, [{ supportFrom: '2026-07-01', supportTo: '2026-07-09' }], 0));
});
