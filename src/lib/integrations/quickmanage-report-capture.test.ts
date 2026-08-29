import assert from 'node:assert/strict';
import test from 'node:test';
import { auditQuickManageReportContent } from './quickmanage-financial-audit';
import {
  captureQuickManageReport,
  compareQuickManageStructures,
  reviewQuickManageCapture,
  type QuickManageMoneyContract,
} from './quickmanage-report-capture';

const column = (cid: number, name: string, metadata: Record<string, unknown> = {}, dataType = 'any') => ({ cid, key: { name, data_type: dataType }, description: null, metadata });
const payload = (columns: unknown[], rows: unknown[]) => ({ header: [{ key: 'Company', value: 'Sensitive company value' }], content: { columns, rows } });
function capture(columns: unknown[], rows: unknown[], parserVersion = 1) {
  const data = payload(columns, rows);
  return captureQuickManageReport('statement', null, data, auditQuickManageReportContent('statement', data), parserVersion);
}

test('structure fingerprint is deterministic and excludes business values', () => {
  const columns = [column(0, 'Statement ID'), column(1, 'Unknown Amount')];
  const first = capture(columns, [{ 0: 'statement-a', 1: '12.34' }]);
  const secondData = { header: [{ key: 'Company', value: 'Different value' }], content: { columns, rows: [{ 0: 'statement-b', 1: '999999.99' }] } };
  const second = captureQuickManageReport('statement', null, secondData, auditQuickManageReportContent('statement', secondData));
  assert.equal(first.structureFingerprint, second.structureFingerprint);
  assert.doesNotMatch(first.structureFingerprint, /statement-a|12\.34/);
});

test('schema comparison detects added, removed, reordered, declared, and observed type changes', () => {
  const before = capture([column(0, 'A', {}, 'string'), column(1, 'B', {}, 'string'), column(2, 'Removed')], [{ 0: 'x', 1: 'y', 2: 'z' }]);
  const after = capture([column(0, 'B', {}, 'boolean'), column(1, 'A', {}, 'string'), column(2, 'Added')], [{ 0: true, 1: 'x', 2: 'new' }]);
  const comparison = compareQuickManageStructures(before, after);
  assert.equal(comparison.sameFingerprint, false);
  assert.deepEqual(comparison.addedColumns, ['Added']);
  assert.deepEqual(comparison.removedColumns, ['Removed']);
  assert.equal(comparison.orderChanged, true);
  assert.deepEqual(comparison.declaredTypeChanges, [{ column: 'B', before: 'string', after: 'boolean' }]);
  assert.deepEqual(comparison.observedTypeChanges, [{ column: 'B', before: ['string'], after: ['boolean'] }]);
});

test('numeric-looking and money-named values remain unverified without a provider contract', () => {
  const result = capture([column(0, 'Total Amount')], [{ 0: '100.00' }, { 0: null }]);
  assert.equal(result.fields[0].classification, 'UNKNOWN');
  assert.equal(result.fields[0].proposedClassification, 'MONEY');
  assert.equal(result.fields[0].verification, 'UNVERIFIED');
  assert.equal(result.importReadiness, 'BLOCKED');
  assert.match(result.blockingReasons.join(' '), /monetary contracts are unverified/i);
});

test('declared money remains blocked until currency, units, precision, signs, null and zero are verified', () => {
  const result = capture([column(0, 'Trip ID'), column(1, 'Net', { currency: 'USD', decimal_scale: 2, aggregation: 'sum' }, 'money')], [{ 0: 'trip-1', 1: '-12.50' }]);
  assert.equal(result.fields[1].classification, 'MONEY');
  assert.equal(result.fields[1].moneyContract.status, 'MONEY_CONTRACT_UNVERIFIED');
  assert.equal(result.importReadiness, 'BLOCKED');
});

test('admin verification transitions to design-ready only with IDs, relationships and a complete money contract', () => {
  const base = capture([column(0, 'Trip ID'), column(1, 'Net')], [{ 0: 'trip-1', 1: '-12.50' }]);
  const contract: QuickManageMoneyContract = {
    status: 'VERIFIED', currency: 'USD', representation: 'MAJOR', precision: 2,
    positiveMeaning: 'credit', negativeMeaning: 'debit', nullMeaning: 'not reported', zeroMeaning: 'reported zero',
  };
  const reviewed = reviewQuickManageCapture(base, [
    { fieldName: 'Trip ID', classification: 'RELATIONSHIP_ID', proposedBusinessMeaning: 'QuickManage Trip UUID', proposedDestination: null },
    { fieldName: 'Net', classification: 'MONEY', proposedBusinessMeaning: 'Reviewed statement net', proposedDestination: 'OTHER', moneyContract: contract },
  ]);
  assert.equal(reviewed.captureStatus, 'IMPORT_MAPPING_READY');
  assert.equal(reviewed.importReadiness, 'READY_FOR_IMPORT_DESIGN');
  assert.deepEqual(reviewed.blockingReasons, []);
});

test('sign contract, missing destination and incomplete review block readiness', () => {
  const base = capture([column(0, 'Trip ID'), column(1, 'Net'), column(2, 'Mystery')], [{ 0: 'trip-1', 1: '-12.50', 2: 'x' }]);
  const reviewed = reviewQuickManageCapture(base, [
    { fieldName: 'Trip ID', classification: 'RELATIONSHIP_ID', proposedBusinessMeaning: null, proposedDestination: null },
    { fieldName: 'Net', classification: 'MONEY', proposedBusinessMeaning: null, proposedDestination: null },
  ]);
  assert.equal(reviewed.importReadiness, 'BLOCKED');
  assert.match(reviewed.blockingReasons.join(' '), /monetary contracts|no reviewed FleetPilot concept|classifications require review/i);
});

test('parser version is part of the fingerprint and invalid/mismatched captures fail closed', () => {
  const columns = [column(0, 'ID')];
  assert.notEqual(capture(columns, [{ 0: 'a' }], 1).structureFingerprint, capture(columns, [{ 0: 'a' }], 2).structureFingerprint);
  const data = payload(columns, [{ 0: 'a' }]);
  const audit = auditQuickManageReportContent('trip', data);
  assert.throws(() => captureQuickManageReport('statement', null, data, audit), /captured safely/);
  assert.throws(() => reviewQuickManageCapture(capture(columns, []), [{ fieldName: 'Missing', classification: 'TEXT', proposedBusinessMeaning: null, proposedDestination: null }]), /does not match/);
});
