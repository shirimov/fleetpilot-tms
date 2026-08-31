import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeTransactions } from '@/lib/finance/plaid-transaction-summary';

test('summarizes canonical and legacy signed amounts by direction', () => {
  assert.deepEqual(
    summarizeTransactions([
      { amount: 250, direction: 'INFLOW' },
      { amount: -125, direction: 'INFLOW' },
      { amount: 80, direction: 'OUTFLOW' },
      { amount: -20, direction: 'OUTFLOW' },
      { amount: 0, direction: null },
    ]),
    { income: 375, expenses: 100, net: 275 },
  );
});
