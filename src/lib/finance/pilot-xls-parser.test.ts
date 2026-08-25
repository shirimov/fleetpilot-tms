import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from '@e965/xlsx';
import { pilotXlsFixture } from '../../../tests/fixtures/pilot-xls';
import { FinancialValidationError } from './financial-control-errors';
import { MAX_PILOT_XLS_BYTES, PilotXlsParser } from './pilot-xls-parser';

const parser = new PilotXlsParser();

test('Pilot parser reads the exact legacy sheet with exact minor-unit reconciliation', () => {
  const parsed = parser.parse(pilotXlsFixture());
  assert.equal(parsed.invoiceNumber, '900001');
  assert.equal(parsed.invoiceTotalMinor, BigInt(10100));
  assert.equal(parsed.parsedTotalMinor, BigInt(10100));
  assert.equal(parsed.differenceMinor, BigInt(0));
  assert.equal(parsed.periodStart.toISOString(), '2026-08-18T00:00:00.000Z');
  assert.equal(parsed.periodEnd.toISOString(), '2026-08-24T00:00:00.000Z');
  const line = parsed.rows[0];
  assert.equal(line.kind, 'PRODUCT');
  if (line.kind === 'PRODUCT') {
    assert.equal(line.productType, 'TRUCK_DIESEL');
    assert.equal(line.quantity, '10.00');
    assert.equal(line.unitPrice, '10.0000000');
    assert.equal(line.sourceUnitNumber, '125');
    assert.equal(line.outsidePeriod, false);
  }
});

test('Pilot parser preserves mismatches for blocking review', () => {
  const parsed = parser.parse(pilotXlsFixture({ total: 102 }));
  assert.equal(parsed.parsedTotalMinor, BigInt(10100));
  assert.equal(parsed.invoiceTotalMinor, BigInt(10200));
  assert.equal(parsed.differenceMinor, BigInt(-100));
});

test('Pilot parser identifies unknown products and dates outside the invoice period', () => {
  const parsed = parser.parse(pilotXlsFixture({ productCode: '999', transactionDate: '08/17' }));
  const line = parsed.rows[0];
  assert.equal(line.kind, 'PRODUCT');
  if (line.kind === 'PRODUCT') {
    assert.equal(line.productType, 'UNKNOWN_PRODUCT');
    assert.equal(line.outsidePeriod, true);
  }
});

test('Pilot parser rejects formulas, non-OLE content, unsupported sheets, and oversized input', () => {
  const formulaBytes = pilotXlsFixture();
  const numberRecord = formulaBytes.findIndex((value, index) => value === 0x03 && formulaBytes[index + 1] === 0x02 && formulaBytes[index + 2] === 0x0e && formulaBytes[index + 3] === 0x00);
  assert.notEqual(numberRecord, -1);
  formulaBytes[numberRecord] = 0x06;
  formulaBytes[numberRecord + 1] = 0x00;
  assert.throws(() => parser.parse(formulaBytes), FinancialValidationError);
  assert.throws(() => parser.parse(new TextEncoder().encode('not an xls')), FinancialValidationError);
  assert.throws(() => parser.parse(new Uint8Array(MAX_PILOT_XLS_BYTES + 1)), FinancialValidationError);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['wrong']]), 'WrongSheet');
  assert.throws(() => parser.parse(new Uint8Array(XLSX.write(workbook, { type: 'buffer', bookType: 'xls' }))), FinancialValidationError);
});
