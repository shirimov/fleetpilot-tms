import assert from 'node:assert/strict';
import test from 'node:test';
import { BankLedgerValidationError } from './bank-ledger-errors';
import { resolveBankTransactionPeriod } from './bank-transaction-period';

test('existing transaction-period presets retain inclusive day semantics', () => {
  const range = resolveBankTransactionPeriod({ period: '7', now: new Date('2026-09-01T18:00:00.000Z') });
  assert.equal(range.from?.toISOString(), '2026-08-26T00:00:00.000Z');
  assert.equal(range.to?.toISOString(), '2026-09-01T00:00:00.000Z');
});

test('custom transaction period accepts an inclusive date-only range', () => {
  const range = resolveBankTransactionPeriod({ period: 'custom', from: '2026-01-01', to: '2026-08-31' });
  assert.equal(range.from?.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(range.to?.toISOString(), '2026-08-31T00:00:00.000Z');
});

test('custom transaction period rejects reversed, missing, and malformed dates', () => {
  assert.throws(
    () => resolveBankTransactionPeriod({ period: 'custom', from: '2026-09-01', to: '2026-08-31' }),
    (error) => error instanceof BankLedgerValidationError && error.message === 'Start date cannot be after end date.',
  );
  assert.throws(() => resolveBankTransactionPeriod({ period: 'custom', from: '2026-01-01' }), BankLedgerValidationError);
  assert.throws(() => resolveBankTransactionPeriod({ period: 'custom', from: '2026-02-30', to: '2026-03-01' }), BankLedgerValidationError);
});

test('all time remains the default transaction period', () => {
  assert.deepEqual(resolveBankTransactionPeriod({}), { period: 'all', from: undefined, to: undefined });
});

test('legacy one-sided date query remains supported', () => {
  const range = resolveBankTransactionPeriod({ from: '2026-01-01' });
  assert.equal(range.from?.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(range.to, undefined);
});
