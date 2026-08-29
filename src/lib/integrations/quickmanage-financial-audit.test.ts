import assert from 'node:assert/strict';
import test from 'node:test';
import { QuickManageError } from './quickmanage-client';
import { auditQuickManageReportContent, QUICKMANAGE_FINANCIAL_REPORT_DEFINITIONS } from './quickmanage-financial-audit';

const column = (cid: number, name: string, metadata: Record<string, unknown> = {}, dataType = 'any') => ({ cid, key: { name, data_type: dataType }, metadata });
const payload = (columns: unknown[], rows: unknown[], summary?: unknown) => ({ content: { columns, rows, ...(summary === undefined ? {} : { summary }) } });

test('defines all 17 values in the official report-type enum separately without invented semantics', () => {
  assert.equal(QUICKMANAGE_FINANCIAL_REPORT_DEFINITIONS.length, 17);
  assert.deepEqual(QUICKMANAGE_FINANCIAL_REPORT_DEFINITIONS.filter((entry) => entry.family === 'account-resource').map((entry) => entry.type), [
    'account-resource-employee', 'account-resource-site-user', 'account-resource-equipment', 'account-resource-address',
    'account-resource-vendor', 'account-resource-customer', 'account-resource-attachment',
  ]);
  assert.equal(QUICKMANAGE_FINANCIAL_REPORT_DEFINITIONS.find((entry) => entry.type === 'statement')?.semantics, 'UNVERIFIED');
});

test('preserves dynamic and unknown columns while auditing duplicate rows', () => {
  const result = auditQuickManageReportContent('trip', payload(
    [column(0, 'Trip #'), column(1, 'Future Vendor Field')],
    [{ 0: '123', 1: 'kept' }, { 1: 'kept', 0: '123' }],
  ));
  assert.deepEqual(result.columns.map((entry) => entry.name), ['Trip #', 'Future Vendor Field']);
  assert.equal(result.findings.some((finding) => finding.code === 'DUPLICATE_ROW'), true);
  assert.equal(result.findings.some((finding) => finding.code === 'NO_CANONICAL_RELATIONSHIP_IDS'), true);
});

test('uses exact scaled integers and detects supplied-total mismatch without floating point', () => {
  const columns = [column(0, 'Amount', { currency: 'USD', decimal_scale: 2, aggregation: 'sum' }, 'money')];
  const exact = auditQuickManageReportContent('statement', payload(columns, [{ 0: '0.10' }, { 0: '0.20' }], { Amount: '0.30' }));
  assert.deepEqual(exact.exactTotals, [{ column: 'Amount', currency: 'USD', scale: 2, calculated: '0.30', supplied: '0.30', matches: true }]);
  const mismatch = auditQuickManageReportContent('statement', payload(columns, [{ 0: '9007199254740993.10' }, { 0: '-0.20' }], { Amount: '9007199254740993.00' }));
  assert.equal(mismatch.exactTotals[0].calculated, '9007199254740992.90');
  assert.equal(mismatch.findings.some((finding) => finding.code === 'TOTAL_MISMATCH'), true);
});

test('distinguishes null money from invalid precision and supports explicit minor units', () => {
  const minor = auditQuickManageReportContent('fuel', payload([column(0, 'Total', { currency: 'USD', unit: 'minor_units', aggregation: 'sum' }, 'money')], [{ 0: '125' }, { 0: null }, { 0: '-25' }], { Total: '100' }));
  assert.equal(minor.exactTotals[0].calculated, '100');
  assert.equal(minor.findings.some((finding) => finding.code === 'SIGN_SEMANTICS_UNVERIFIED'), true);
  const invalid = auditQuickManageReportContent('fuel', payload([column(0, 'Total', { currency: 'USD', decimal_scale: 2, aggregation: 'sum' }, 'money')], [{ 0: '1.001' }]));
  assert.equal(invalid.findings.some((finding) => finding.code === 'INVALID_MONETARY_VALUE'), true);
});

test('does not calculate totals when row aggregation semantics are not explicit', () => {
  const result = auditQuickManageReportContent('trip', payload([column(0, 'Revenue', { currency: 'USD', decimal_scale: 2 }, 'money')], [{ 0: '12.50' }]));
  assert.deepEqual(result.exactTotals, []);
  assert.equal(result.findings.some((finding) => finding.code === 'MONETARY_SEMANTICS_UNVERIFIED'), true);
});

test('detects duplicate canonical financial row identifiers', () => {
  const result = auditQuickManageReportContent('adjustment', payload([column(0, 'Adjustment ID')], [{ 0: 'adj-1' }, { 0: 'adj-1' }]));
  assert.equal(result.findings.some((finding) => finding.code === 'DUPLICATE_EXTERNAL_ID'), true);
});

test('recognizes only canonical relationship ID columns and reports missing IDs', () => {
  const result = auditQuickManageReportContent('receivable', payload([column(0, 'Customer ID'), column(1, 'Driver Name')], [{ 0: 'uuid-1', 1: 'Name' }, { 0: null, 1: 'Name 2' }]));
  assert.deepEqual(result.relationshipColumns, [{ column: 'Customer ID', resource: 'CUSTOMER' }]);
  assert.deepEqual(result.relationshipReferences, [{ column: 'Customer ID', resource: 'CUSTOMER', externalId: 'uuid-1', rowIndexes: [0] }]);
  assert.equal(result.findings.some((finding) => finding.code === 'MISSING_RELATIONSHIP_ID'), true);
});

test('every official report type uses the bounded provider-side interpretation layer', () => {
  for (const definition of QUICKMANAGE_FINANCIAL_REPORT_DEFINITIONS) {
    const result = auditQuickManageReportContent(definition.type, payload([column(0, 'Unknown')], []));
    assert.equal(result.reportType, definition.type);
    assert.equal(result.interpretation, definition.semantics);
  }
});

test('fails closed for malformed and excessive report content', () => {
  assert.throws(() => auditQuickManageReportContent('trip', {}), QuickManageError);
  assert.throws(() => auditQuickManageReportContent('trip', payload([column(0, 'Value')], Array.from({ length: 501 }, () => ({ 0: 'x' })))), /safe audit limit/);
});
