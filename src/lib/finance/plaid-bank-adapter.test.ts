import assert from 'node:assert/strict';
import test from 'node:test';
import { derivePlaidTransactionDirection, plaidBalanceMinor } from './plaid-bank-adapter';

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

test('Plaid balances convert to exact signed minor units', () => {
  assert.equal(plaidBalanceMinor(0.01), BigInt(1));
  assert.equal(plaidBalanceMinor(0.1), BigInt(10));
  assert.equal(plaidBalanceMinor(43_322.78), BigInt(4_332_278));
  assert.equal(plaidBalanceMinor(99_999_999.99), BigInt(9_999_999_999));
  assert.equal(plaidBalanceMinor(-125.42), BigInt(-12_542));
  assert.equal(plaidBalanceMinor(0), BigInt(0));
  assert.equal(plaidBalanceMinor(null), null);
});

test('Plaid balance conversion rejects malformed, unsafe, or sub-cent values', () => {
  assert.throws(() => plaidBalanceMinor(Number.NaN), /invalid balance/);
  assert.throws(() => plaidBalanceMinor(Number.POSITIVE_INFINITY), /invalid balance/);
  assert.throws(() => plaidBalanceMinor(Number.MAX_SAFE_INTEGER), /supported cent precision/);
  assert.throws(() => plaidBalanceMinor(1.001), /supported cent precision/);
});
