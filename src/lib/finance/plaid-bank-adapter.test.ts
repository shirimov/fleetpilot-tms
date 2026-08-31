import assert from 'node:assert/strict';
import test from 'node:test';
import { derivePlaidTransactionDirection } from './plaid-bank-adapter';

test('Plaid positive transaction amounts are money out', () => {
  assert.equal(derivePlaidTransactionDirection(450), 'OUTFLOW');
});

test('Plaid negative transaction amounts are money in', () => {
  assert.equal(derivePlaidTransactionDirection(-5000), 'INFLOW');
});

test('Plaid zero transaction amounts remain neutral', () => {
  assert.equal(derivePlaidTransactionDirection(0), null);
  assert.equal(derivePlaidTransactionDirection(-0), null);
});
