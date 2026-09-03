import assert from 'node:assert/strict';
import test from 'node:test';
import { conservativeSemantic, matchRule, normalizeDescriptionToken, normalizeMerchant } from './bank-categorization';

const transaction = { merchantName: 'Pilot Travel Center #123', originalDescription: 'Card purchase Pilot 00123', direction: 'OUTFLOW' as const, amountMinor: BigInt(4200), bankAccountId: 'account-1', providerCategory: null };

test('merchant normalization is conservative and preserves meaningful identity', () => {
  assert.equal(normalizeMerchant(' Pilot Travel Center #123 '), 'PILOT FLYING J');
  assert.equal(normalizeMerchant('Acme Store 001'), 'ACME STORE 001');
  assert.notEqual(normalizeMerchant('Acme Store 001'), normalizeMerchant('Acme Store 002'));
  assert.equal(normalizeDescriptionToken('  ACH--Payroll  '), 'ACH PAYROLL');
});

test('rules require every configured condition to match', () => {
  const base = { id: 'rule', name: 'Pilot fuel', merchantNormalized: 'PILOT FLYING J', descriptionContainsNormalized: null, direction: 'OUTFLOW' as const, bankAccountId: 'account-1', minimumAmountMinor: BigInt(4000), maximumAmountMinor: BigInt(5000), categoryId: 'fuel', scope: 'COMPANY_LEVEL' as const, truckId: null, trailerId: null, driverId: null, partyId: null };
  assert.equal(matchRule(transaction, [base])?.id, 'rule');
  assert.equal(matchRule(transaction, [{ ...base, direction: 'INFLOW' }]), undefined);
  assert.equal(matchRule(transaction, [{ ...base, minimumAmountMinor: BigInt(5001) }]), undefined);
});

test('semantic suggestions only use explicit merchant families and exact categories', () => {
  assert.deepEqual(conservativeSemantic(transaction, [{ id: 'fuel', name: 'Fuel' }]), { categoryId: 'fuel', source: 'MERCHANT_SEMANTICS', confidence: 'HIGH', reason: 'Known merchant semantics: PILOT FLYING J.' });
  assert.equal(conservativeSemantic({ ...transaction, merchantName: 'Unrelated merchant' }, [{ id: 'fuel', name: 'Fuel' }]), null);
});
