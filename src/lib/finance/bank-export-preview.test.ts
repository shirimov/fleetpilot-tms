import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBankExport } from './bank-export-preview';

const bytes = (value: string) => new TextEncoder().encode(value);

test('QFX preserves FITID and exact signed amount for strongest deduplication', () => {
  const [row] = parseBankExport({ filename: 'keybank.qfx', bytes: bytes('<OFX><STMTTRN><DTPOSTED>20260115<TRNAMT>-12.34<FITID>stable-1<NAME>Vendor<MEMO>Invoice 7<CHECKNUM>007</STMTTRN></BANKTRANLIST>') });
  assert.equal(row.externalId, 'stable-1');
  assert.equal(row.amountMinor, BigInt(-1234));
  assert.equal(row.postedDate, '2026-01-15');
  assert.equal(row.description, 'Invoice 7');
  assert.ok(row.sourceHashSha256);
  assert.equal(row.error, null);
});

test('CSV supports quoted fields and marks malformed rows invalid', () => {
  const rows = parseBankExport({ filename: 'keybank.csv', bytes: bytes('Date,Amount,Description,Transaction ID\n2026-02-01,"1,000.00","Deposit, customer",abc\nbad,,') });
  assert.equal(rows[0].amountMinor, BigInt(100000));
  assert.equal(rows[0].externalId, 'abc');
  assert.equal(rows[0].error, null);
  assert.match(rows[1].error ?? '', /posted date/);
});

test('unsupported files and empty exports fail closed', () => {
  assert.throws(() => parseBankExport({ filename: 'statement.pdf', bytes: bytes('pdf') }), /QFX, OFX, or CSV/);
  assert.throws(() => parseBankExport({ filename: 'empty.qfx', bytes: bytes('<OFX></OFX>') }), /No transaction rows/);
});
