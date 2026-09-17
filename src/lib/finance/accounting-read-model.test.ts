import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryAttribution, entryQueues, summarizeAccounting, type AccountingEntry } from './accounting-read-model';
const expense = { type: 'DIRECT_EXPENSE', isActive: true, operatingGroupId: 'g' };
const income = { ...expense, type: 'INCOME' };
const entry = (overrides: Partial<AccountingEntry> = {}): AccountingEntry => ({ amountMinor: BigInt(100000), direction: 'OUTFLOW', operatingGroupId: 'g', role: 'ECONOMIC', status: 'POSTED', reconciliationStatus: 'RECONCILED', category: null, allocations: [{ amountMinor: BigInt(100000), category: expense }], recoverableFromOwner: false, recoveryStatus: 'NOT_APPLICABLE', ...overrides });
test('full allocation coverage needs no header category; partial coverage reports exact residual', () => {
  assert.equal(categoryAttribution(entry()).uncategorizedMinor, BigInt(0));
  assert.deepEqual(entryQueues(entry()), []);
  const partial = entry({ allocations: [{ amountMinor: BigInt(60000), category: expense }] });
  assert.equal(categoryAttribution(partial).uncategorizedMinor, BigInt(40000));
  assert.ok(entryQueues(partial).includes('uncategorizedExpenses'));
  assert.equal(categoryAttribution({ ...partial, category: expense }).uncategorizedMinor, BigInt(0));
});
test('inactive, foreign, missing and overallocated attribution remain reviewable', () => {
  for (const category of [null, { ...expense, isActive: false }, { ...expense, operatingGroupId: 'foreign' }]) assert.ok(entryQueues(entry({ allocations: [{ amountMinor: BigInt(100000), category }] })).includes('uncategorizedExpenses'));
  assert.equal(categoryAttribution(entry({ allocations: [{ amountMinor: BigInt(100001), category: expense }] })).invalidCoverage, true);
});
test('mixed categories consume allocation amounts once; header applies only to residual', () => {
  const mixed = entry({ direction: 'INFLOW', category: income, allocations: [{ amountMinor: BigInt(60000), category: expense }, { amountMinor: BigInt(20000), category: income }] });
  const result = summarizeAccounting([mixed]);
  assert.equal(result.incomeMinor, '40000'); assert.equal(result.expenseCreditsMinor, '-60000'); assert.equal(result.recordedNetMinor, '100000');
  assert.equal(BigInt(result.incomeMinor) - BigInt(result.netExpensesMinor) + BigInt(result.otherNetMinor), BigInt(result.recordedNetMinor));
});
test('protected five-invoice aggregate: 698 expenses plus provider credit, no false category queue', () => {
  const amounts = [5151020,5953073,7844061,10277770,11732260]; const counts = [95,112,137,170,184];
  const entries = amounts.flatMap((amount,index) => Array.from({ length: counts[index] }, (_,n) => {
    const value = BigInt(Math.floor(amount/counts[index]) + (n < amount % counts[index] ? 1 : 0));
    return entry({ amountMinor: value, allocations: [{ amountMinor: value, category: expense }] });
  }));
  entries.push(entry({ direction: 'INFLOW', amountMinor: BigInt(2859), allocations: [{ amountMinor: BigInt(2859), category: expense }] }));
  assert.equal(entries.length,699); assert.equal(entries.flatMap(entryQueues).length,0);
  assert.deepEqual(summarizeAccounting(entries), { incomeMinor:'0',grossExpensesMinor:'40958184',expenseCreditsMinor:'-2859',netExpensesMinor:'40955325',otherNetMinor:'0',recordedNetMinor:'-40955325' });
});
test('waived recovery, voided and non-economic entries never enter review queues', () => {
  assert.ok(!entryQueues(entry({ recoverableFromOwner: true, recoveryStatus: 'WAIVED' })).includes('ownerRecovery'));
  assert.deepEqual(entryQueues(entry({ status: 'VOIDED', allocations: [] })), []);
  assert.deepEqual(entryQueues(entry({ role: 'SETTLEMENT', allocations: [] })), []);
});
test('ordinary income, expense, credit and draft/posted policy conserve exact minor units', () => {
  for (const status of ['DRAFT', 'POSTED']) {
    const rows = [
      entry({status, direction:'INFLOW',amountMinor:BigInt(200001),category:income,allocations:[]}),
      entry({status, amountMinor:BigInt(100001),category:expense,allocations:[]}),
      entry({status, direction:'INFLOW',amountMinor:BigInt(1),category:expense,allocations:[]}),
      entry({status:'VOIDED',category:expense}),
      entry({role:'SETTLEMENT',category:expense}),
      entry({direction:'TRANSFER',category:expense}),
    ];
    assert.deepEqual(summarizeAccounting(rows), {incomeMinor:'200001',grossExpensesMinor:'100001',expenseCreditsMinor:'-1',netExpensesMinor:'100000',otherNetMinor:'0',recordedNetMinor:'100001'});
  }
});
test('multiple allocations and header residuals classify each minor unit once', () => {
  for (const category of [null,expense,income]) {
    const complete = entry({category,allocations:[{amountMinor:BigInt(60001),category:expense},{amountMinor:BigInt(39999),category:expense}]});
    assert.equal(categoryAttribution(complete).uncategorizedMinor,BigInt(0));
    assert.equal(summarizeAccounting([complete]).grossExpensesMinor,'100000');
  }
  const partial = entry({category:income,allocations:[{amountMinor:BigInt(60001),category:expense}]});
  const result = summarizeAccounting([partial]);
  assert.equal(result.incomeMinor,'-39999'); assert.equal(result.grossExpensesMinor,'60001');
  assert.equal(result.recordedNetMinor,'-100000');
  const invalid = entry({category:expense,allocations:[{amountMinor:BigInt(100001),category:expense}]});
  assert.ok(entryQueues(invalid).includes('uncategorizedExpenses'));
  assert.equal(summarizeAccounting([invalid]).recordedNetMinor,'-100000');
  assert.equal(summarizeAccounting([invalid]).otherNetMinor,'-100000');
});
