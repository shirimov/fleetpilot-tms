import { createHash } from 'node:crypto';
import { BankLedgerValidationError } from './bank-ledger-errors';

export type BankExportSource = 'BANK_EXPORT_QFX' | 'BANK_EXPORT_OFX' | 'BANK_EXPORT_CSV';
export type BankExportPreviewStatus = 'NEW' | 'ALREADY_EXISTS' | 'POSSIBLE_DUPLICATE' | 'INVALID';

export type ParsedBankExportRow = {
  rowNumber: number;
  source: BankExportSource;
  externalId: string | null;
  postedDate: string | null;
  amountMinor: bigint | null;
  description: string | null;
  checkNumber: string | null;
  sourceHashSha256: string | null;
  error: string | null;
};

const MAX_EXPORT_BYTES = 5 * 1024 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field || row.length) { row.push(field); if (row.some((value) => value.trim())) rows.push(row); }
  return rows;
}

function minorUnits(value: string) {
  const normalized = value.trim().replace(/[$,]/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace('-', '').split('.');
  const amount = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  return negative ? -amount : amount;
}

function isoDate(value: string) {
  const compact = value.trim().slice(0, 8);
  if (!/^\d{8}$/.test(compact)) return null;
  const date = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ? null : date;
}

function fingerprint(row: Pick<ParsedBankExportRow, 'postedDate' | 'amountMinor' | 'description' | 'checkNumber'>) {
  if (!row.postedDate || row.amountMinor === null || !row.description) return null;
  return createHash('sha256').update([
    row.postedDate,
    row.amountMinor.toString(),
    row.description.trim().replace(/\s+/g, ' ').toUpperCase(),
    row.checkNumber?.trim().toUpperCase() ?? '',
  ].join('|')).digest('hex');
}

function finalize(row: Omit<ParsedBankExportRow, 'sourceHashSha256' | 'error'>): ParsedBankExportRow {
  const errors = [!row.postedDate && 'Invalid or missing posted date', row.amountMinor === null && 'Invalid or missing amount', !row.description && 'Missing description'].filter(Boolean);
  return { ...row, sourceHashSha256: fingerprint(row), error: errors.length ? errors.join('; ') : null };
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
  return match?.[1]?.trim() || null;
}

function parseOfx(text: string, source: 'BANK_EXPORT_QFX' | 'BANK_EXPORT_OFX') {
  return [...text.matchAll(/<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi)].map((match, index) => {
    const block = match[1];
    const dateValue = tag(block, 'DTPOSTED');
    const amountValue = tag(block, 'TRNAMT');
    return finalize({
      rowNumber: index + 1,
      source,
      externalId: tag(block, 'FITID'),
      postedDate: dateValue ? isoDate(dateValue) : null,
      amountMinor: amountValue ? minorUnits(amountValue) : null,
      description: tag(block, 'MEMO') ?? tag(block, 'NAME'),
      checkNumber: tag(block, 'CHECKNUM') ?? tag(block, 'REFNUM'),
    });
  });
}

function parseCsv(text: string): ParsedBankExportRow[] {
  const rows = csvRows(text);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[ _-]+/g, ''));
  const column = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const dateColumn = column('date', 'posteddate', 'transactiondate');
  const amountColumn = column('amount', 'transactionamount');
  const descriptionColumn = column('description', 'memo', 'name', 'details');
  const idColumn = column('transactionid', 'fitid', 'referenceid');
  const checkColumn = column('checknumber', 'referencenumber');
  return rows.slice(1).map((values, index) => {
    const dateValue = dateColumn >= 0 ? values[dateColumn] : '';
    const compactDate = DATE.test(dateValue?.trim()) ? dateValue.trim().replaceAll('-', '') : dateValue;
    return finalize({
      rowNumber: index + 2,
      source: 'BANK_EXPORT_CSV',
      externalId: idColumn >= 0 ? values[idColumn]?.trim() || null : null,
      postedDate: compactDate ? isoDate(compactDate) : null,
      amountMinor: amountColumn >= 0 ? minorUnits(values[amountColumn] ?? '') : null,
      description: descriptionColumn >= 0 ? values[descriptionColumn]?.trim() || null : null,
      checkNumber: checkColumn >= 0 ? values[checkColumn]?.trim() || null : null,
    });
  });
}

export function parseBankExport(input: { filename: string; bytes: Uint8Array }) {
  if (!input.bytes.length || input.bytes.length > MAX_EXPORT_BYTES) throw new BankLedgerValidationError('Bank export must be between 1 byte and 5 MB.');
  const extension = input.filename.toLowerCase().split('.').pop();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  const rows = extension === 'qfx' ? parseOfx(text, 'BANK_EXPORT_QFX') : extension === 'ofx' ? parseOfx(text, 'BANK_EXPORT_OFX') : extension === 'csv' ? parseCsv(text) : null;
  if (!rows) throw new BankLedgerValidationError('Use a bank-generated QFX, OFX, or CSV file.');
  if (!rows.length) throw new BankLedgerValidationError('No transaction rows were found in the bank export.');
  if (rows.length > 10_000) throw new BankLedgerValidationError('Bank export exceeds the 10,000-row preview limit.');
  return rows;
}
