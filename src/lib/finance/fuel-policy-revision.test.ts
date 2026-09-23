import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FinancialConflictError } from './financial-control-errors';
import { validateFuelPolicyRevisionEvidence } from './fuel-deduction-reconciliation';
import { fuelPolicyRevisionCases, heldFuelPolicyScopes, toleranceReviewedHeldScopes } from '../../../tests/fixtures/fuel-policy-revision-cases';

test('23 audited real-shape scopes are evidence-bounded extensions totaling 41 rows and $23,613.62', () => {
  const extensions = fuelPolicyRevisionCases.filter(item => item.classification === 'SAME_RULE_EXTENSION');
  assert.equal(extensions.length, 23);
  assert.equal(extensions.reduce((sum, item) => sum + item.pendingRows, 0), 41);
  assert.equal(extensions.reduce((sum, item) => sum + BigInt(item.pendingPilotMinor), BigInt(0)), BigInt(2_361_362));
  for (const item of extensions) {
    assert.equal(item.contradictions, 0);
    assert.doesNotThrow(() => validateFuelPolicyRevisionEvidence({ currentFrom: item.currentFrom, currentTo: item.currentTo, effectiveFrom: item.proposedFrom, effectiveTo: item.proposedTo }, [...item.support], 0), `${item.company} Truck ${item.truck}`);
  }
});

test('7773 and 8479 are accepted only for their one-cent variance while reviewed held scopes remain outside the extension plan', () => {
  const toleranceCases = fuelPolicyRevisionCases.filter(item => item.truck === '7773' || item.truck === '8479');
  assert.deepEqual(toleranceCases.map(item => [item.truck, item.classification, item.acceptedVarianceMinor]), [['7773', 'SAME_RULE_EXTENSION', '-1'], ['8479', 'SAME_RULE_EXTENSION', '-1']]);
  for (const item of toleranceCases) assert.doesNotThrow(() => validateFuelPolicyRevisionEvidence({ currentFrom: item.currentFrom, currentTo: item.currentTo, effectiveFrom: item.proposedFrom, effectiveTo: item.proposedTo }, [...item.support], item.contradictions));
  assert.equal(toleranceReviewedHeldScopes.truck9115.classification, 'POTENTIALLY_POLICY_SUPPORTABLE');
  assert.equal(toleranceReviewedHeldScopes.truck9115.extensionEligible, false);
  assert.equal(toleranceReviewedHeldScopes.truck8158.classification, 'HELD');
  assert.match(toleranceReviewedHeldScopes.truck8158.reason, /\+\$67\.01/);
  assert.deepEqual(heldFuelPolicyScopes, { scopes: 9, rows: 67, pilotMinor: '3045669' });
});

test('disjoint evidence cannot bridge an unsupported gap and adjacent boundary evidence can extend', () => {
  assert.throws(() => validateFuelPolicyRevisionEvidence({ currentFrom: '2026-07-01', currentTo: '2026-07-08', effectiveFrom: '2026-07-01', effectiveTo: '2026-07-28' }, [{ supportFrom: '2026-07-20', supportTo: '2026-07-28' }], 0), FinancialConflictError);
  assert.doesNotThrow(() => validateFuelPolicyRevisionEvidence({ currentFrom: '2026-07-01', currentTo: '2026-07-08', effectiveFrom: '2026-07-01', effectiveTo: '2026-07-09' }, [{ supportFrom: '2026-07-01', supportTo: '2026-07-09' }], 0));
});
