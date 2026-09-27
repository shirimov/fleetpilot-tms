import { createHash } from 'node:crypto';
import path from 'node:path';
import * as XLSX from '@e965/xlsx';
import { FinancialValidationError } from './financial-control-errors';
import { pilotXlsParser, type PilotParsedInvoice, type PilotParsedRow } from './pilot-xls-parser';

export const PILOT_SOURCE_PARSER_VERSION = 'pilot-multiformat-v1';
export const MAX_PILOT_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_PILOT_SOURCE_ROWS = 12_000;
export type PilotSourceFormat = 'LEGACY_XLS' | 'PORTAL_XLSX' | 'PIPE_INVOICE';
export type PilotSourceProduct = 'TRUCK_DIESEL' | 'REEFER_FUEL' | 'DEF' | 'DEF_BOTTLED' | 'MISC' | 'ADJUSTMENT' | 'UNKNOWN';

export type PilotNormalizedLine = {
  sourceRowIndex: number; rawSourceType: string; rawMetadata: Record<string, string>;
  account: string; cardIdentity: string; transactionReference: string; transactionIdentity: string;
  transactionDate: Date; transactionTimestamp: Date | null; unit: string; location: string; city: string; state: string;
  product: PilotSourceProduct; quantity: string | null; retailMinor: bigint; savingsMinor: bigint; netMinor: bigint;
  lineIdentity: string;
};

export type PilotNormalizedSource = {
  format: PilotSourceFormat; parserVersion: string; filename: string; checksumSha256: string; account: string;
  invoiceNumber: string | null; billingDate: Date | null; periodStart: Date | null; periodEnd: Date | null;
  observedStart: Date; observedEnd: Date; lines: PilotNormalizedLine[];
};

const digest = (parts: string[]) => createHash('sha256').update(parts.join('\u001f')).digest('hex');
const checksum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const normalizedId = (value: unknown) => String(value ?? '').trim().replace(/^0+(?=\d)/, '');
const text = (value: unknown) => String(value ?? '').trim();
const money = (value: unknown, label: string) => {
  const raw = text(value).replaceAll(',', '').replace(/^(-?)\$/, '$1');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) throw new FinancialValidationError(`Pilot ${label} is invalid.`);
  const negative = raw.startsWith('-'); const [whole, fraction = ''] = raw.replace('-', '').split('.');
  const result = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  return negative ? -result : result;
};
const moneyOrZero = (value: unknown, label: string) => text(value) ? money(value, label) : BigInt(0);
const decimal = (value: unknown) => {
  const raw = text(value);
  if (!raw) return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new FinancialValidationError('Pilot quantity is invalid.');
  const [whole, fraction = ''] = raw.split('.'); const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
};
const utcDate = (raw: string, format: 'portal' | 'pipe') => {
  const match = format === 'pipe' ? raw.match(/^(\d{4})(\d{2})(\d{2})$/) : raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s+([AP]M))?$/i);
  if (!match) throw new FinancialValidationError('Pilot transaction date is invalid.');
  let year: number, month: number, day: number, hour = 0, minute = 0;
  if (format === 'pipe') { year = Number(match[1]); month = Number(match[2]); day = Number(match[3]); }
  else { month = Number(match[1]); day = Number(match[2]); year = Number(match[3]); hour = Number(match[4] ?? 0); minute = Number(match[5] ?? 0); if ((match[6] ?? '').toUpperCase() === 'PM' && hour !== 12) hour += 12; if ((match[6] ?? '').toUpperCase() === 'AM' && hour === 12) hour = 0; }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new FinancialValidationError('Pilot transaction date is invalid.');
  return date;
};
const day = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
const sourceBounds = (lines: PilotNormalizedLine[]) => {
  if (!lines.length) throw new FinancialValidationError('Pilot source contains no transaction lines.');
  const dates = lines.map(({ transactionDate }) => transactionDate.getTime());
  return { observedStart: new Date(Math.min(...dates)), observedEnd: new Date(Math.max(...dates)) };
};
const identity = (account: string, card: string, reference: string) => {
  if (!account || !reference) throw new FinancialValidationError('Pilot stable transaction identity is incomplete.');
  return digest([account, card, reference]);
};

function legacyLines(rows: PilotParsedRow[], account: string): PilotNormalizedLine[] {
  return rows.flatMap((row) => {
    if (row.kind !== 'PRODUCT' || !row.transactionDate || row.amountMinor === null) return [];
    const transactionIdentity = identity(account, normalizedId(row.cardReference), normalizedId(row.ticketReference));
    const retailMinor = row.retailAmountMinor ?? row.amountMinor;
    return [{ sourceRowIndex: row.sourceRowIndex, rawSourceType: row.productCode, rawMetadata: row.rawMetadata, account,
      cardIdentity: normalizedId(row.cardReference), transactionReference: normalizedId(row.ticketReference), transactionIdentity,
      transactionDate: day(row.transactionDate), transactionTimestamp: null, unit: normalizedId(row.sourceUnitNumber), location: normalizedId(row.locationNumber), city: row.city, state: row.state,
      product: row.productType === 'UNKNOWN_PRODUCT' ? 'UNKNOWN' : row.productType, quantity: decimal(row.quantity),
      retailMinor, savingsMinor: row.savingsMinor ?? retailMinor - row.amountMinor, netMinor: row.amountMinor,
      lineIdentity: digest([transactionIdentity, row.productCode, row.quantity ?? '', row.amountMinor.toString(), String(row.sourceRowIndex)]) } satisfies PilotNormalizedLine];
  });
}

function parseLegacy(bytes: Uint8Array, filename: string): PilotNormalizedSource {
  const parsed = pilotXlsParser.parse(bytes);
  const account = parsed.providerAccountReference;
  const lines = legacyLines(parsed.rows, account);
  return { format: 'LEGACY_XLS', parserVersion: PILOT_SOURCE_PARSER_VERSION, filename, checksumSha256: checksum(bytes), account,
    invoiceNumber: parsed.invoiceNumber, billingDate: parsed.billingDate, periodStart: parsed.periodStart, periodEnd: parsed.periodEnd, ...sourceBounds(lines), lines };
}

function safeWorkbook(bytes: Uint8Array) {
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(bytes, { type: 'array', raw: true, cellFormula: true, bookVBA: true, bookFiles: true, bookDeps: true, sheetRows: MAX_PILOT_SOURCE_ROWS + 1 }); }
  catch { throw new FinancialValidationError('Pilot XLSX could not be parsed safely.'); }
  const files = Object.keys((workbook as XLSX.WorkBook & { files?: Record<string, unknown> }).files ?? {});
  if (workbook.vbaraw || files.some((name) => /(?:vbaProject\.bin|xl\/externalLinks\/)/i.test(name))) throw new FinancialValidationError('Pilot XLSX macros and external links are not allowed.');
  for (const sheet of Object.values(workbook.Sheets)) for (const [key, cell] of Object.entries(sheet)) if (!key.startsWith('!') && cell?.f) throw new FinancialValidationError('Pilot XLSX formulas are not allowed.');
  return workbook;
}

function parsePortal(bytes: Uint8Array, filename: string, account: string): PilotNormalizedSource {
  if (!/^\d+$/.test(account)) throw new FinancialValidationError('Pilot portal export requires its verified provider account number.');
  const workbook = safeWorkbook(bytes);
  if (!workbook.SheetNames.includes('US')) throw new FinancialValidationError('Pilot portal XLSX must contain the US sheet.');
  const sheet = workbook.Sheets.US; const range = XLSX.utils.decode_range(sheet['!fullref'] ?? sheet['!ref'] ?? 'A1');
  if (range.e.r + 1 > MAX_PILOT_SOURCE_ROWS || range.e.c + 1 !== 19) throw new FinancialValidationError('Pilot portal XLSX dimensions are outside supported limits.');
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
  const expected = ['Card #','Card Description','Trx Date','Brand','Transaction #','Store Number','Store City','State','Country','Product','Driver ID','Odometer','Trailer','Trip','Vehicle','Quantity','Fuel','Merchandise','Invoice Amount'];
  if (!expected.every((label, index) => text(matrix[1]?.[index]) === label)) throw new FinancialValidationError('Pilot portal XLSX header structure is invalid.');
  const types: Record<string, PilotSourceProduct> = { 'Truck Diesel':'TRUCK_DIESEL', 'Truck Diesel #1':'TRUCK_DIESEL', Reefer:'REEFER_FUEL', 'Diesel Exhaust Fluid':'DEF', Adjustment:'ADJUSTMENT' };
  const lines: PilotNormalizedLine[] = [];
  for (let index = 2; index < matrix.length; index += 1) {
    const row = matrix[index]; if (!text(row?.[4])) continue;
    const card = normalizedId(row[0]); const reference = normalizedId(row[4]); const transactionIdentity = identity(account, card, reference);
    const timestamp = utcDate(text(row[2]), 'portal'); const product = types[text(row[9])] ?? 'UNKNOWN';
    const retailMinor = moneyOrZero(row[16], 'retail amount'); const netMinor = money(row[18], 'invoice amount');
    lines.push({ sourceRowIndex:index + 1, rawSourceType:text(row[9]), rawMetadata:Object.fromEntries(expected.map((key, column) => [key, text(row[column])])), account, cardIdentity:card,
      transactionReference:reference, transactionIdentity, transactionDate:day(timestamp), transactionTimestamp:timestamp, unit:normalizedId(row[14]), location:normalizedId(row[5]), city:text(row[6]), state:text(row[7]),
      product, quantity:decimal(row[15]), retailMinor, savingsMinor:retailMinor - netMinor, netMinor,
      lineIdentity:digest([transactionIdentity, text(row[9]), text(row[15]), netMinor.toString(), String(index + 1)]) });
  }
  return { format:'PORTAL_XLSX', parserVersion:PILOT_SOURCE_PARSER_VERSION, filename, checksumSha256:checksum(bytes), account, invoiceNumber:null, billingDate:null, periodStart:null, periodEnd:null, ...sourceBounds(lines), lines };
}

function parsePipe(bytes: Uint8Array, filename: string): PilotNormalizedSource {
  let body: string; try { body = new TextDecoder('utf-8', { fatal:true }).decode(bytes); } catch { throw new FinancialValidationError('Pilot pipe invoice must be valid UTF-8 text.'); }
  if (body.includes('\0') || body.includes('"')) throw new FinancialValidationError('Pilot pipe invoice contains unsupported binary or quoted content.');
  const records = body.split(/\r?\n/).filter(Boolean).map((line) => line.split('|'));
  const header = records.find((row) => row[0] === 'H'); const trailer = records.find((row) => row[0] === 'T'); const details = records.filter((row) => row[0] === 'D');
  if (!header || header.length !== 29 || !trailer || records.some((row) => !['H','D','T'].includes(row[0]))) throw new FinancialValidationError('Pilot pipe invoice control structure is invalid.');
  const account = text(header[1]); const invoiceNumber = text(header[19]);
  const productTypes: Record<string, PilotSourceProduct> = { '020':'TRUCK_DIESEL', '033':'REEFER_FUEL', '140':'DEF', '138':'DEF_BOTTLED', '400':'MISC' };
  const lines = details.map((row, offset) => {
    if (row.length !== 51) throw new FinancialValidationError(`Pilot pipe detail row ${offset + 2} must contain 51 fields.`);
    const card = normalizedId(row[7]); const reference = normalizedId(row[23]); const transactionIdentity = identity(account, card, reference); const timestamp = utcDate(row[11], 'pipe');
    const retailMinor = money(row[20], 'retail amount'); const netMinor = money(row[19], 'invoice amount'); const product = productTypes[text(row[21])] ?? 'UNKNOWN';
    const quantity = decimal(row[17]); if (['TRUCK_DIESEL','REEFER_FUEL','DEF'].includes(product) && quantity === null) throw new FinancialValidationError(`Pilot pipe detail row ${offset + 2} lacks fuel quantity.`);
    return { sourceRowIndex:offset + 2, rawSourceType:text(row[21]), rawMetadata:Object.fromEntries(row.map((value, column) => [String(column), text(value)])), account, cardIdentity:card,
      transactionReference:reference, transactionIdentity, transactionDate:day(timestamp), transactionTimestamp:null, unit:normalizedId(row[1]), location:normalizedId(row[3]), city:text(row[4]), state:text(row[5]),
      product, quantity, retailMinor, savingsMinor:retailMinor - netMinor, netMinor, lineIdentity:digest([transactionIdentity, text(row[21]), text(row[17]), netMinor.toString(), String(offset + 2)]) } satisfies PilotNormalizedLine;
  });
  const parseHeaderDate = (value: string) => day(utcDate(value, 'pipe'));
  return { format:'PIPE_INVOICE', parserVersion:PILOT_SOURCE_PARSER_VERSION, filename, checksumSha256:checksum(bytes), account, invoiceNumber, billingDate:parseHeaderDate(header[16]), periodStart:parseHeaderDate(header[17]), periodEnd:parseHeaderDate(header[18]), ...sourceBounds(lines), lines };
}

export function parsePilotSource(bytes: Uint8Array, filename: string, options: { portalAccount?: string } = {}): PilotNormalizedSource {
  if (!filename || bytes.byteLength === 0 || bytes.byteLength > MAX_PILOT_SOURCE_BYTES) throw new FinancialValidationError('Pilot source must be a named file between 1 byte and 12 MB.');
  const extension = path.extname(filename.normalize('NFKC')).toLowerCase();
  if (extension === '.xls') return parseLegacy(bytes, filename);
  if (extension === '.xlsx') return parsePortal(bytes, filename, options.portalAccount ?? '');
  if (extension === '.csv') return parsePipe(bytes, filename);
  throw new FinancialValidationError('Pilot source must be an official XLS, XLSX, or pipe-delimited CSV file.');
}

export function mergePilotSources(sources: PilotNormalizedSource[]) {
  const transactions = new Map<string, PilotNormalizedLine[]>(); const sourceByTransaction = new Map<string, Set<string>>(); const conflicts: string[] = [];
  for (const source of sources) for (const line of source.lines) {
    const prior = transactions.get(line.transactionIdentity) ?? [];
    const sameProduct = prior.find((candidate) => candidate.product === line.product);
    if (sameProduct) {
      const comparable = ['transactionDate','unit','location','product','quantity','retailMinor','savingsMinor','netMinor'] as const;
      if (comparable.some((field) => String(sameProduct[field]) !== String(line[field]))) conflicts.push(`${line.transactionIdentity}:${line.product}`);
    } else prior.push(line);
    transactions.set(line.transactionIdentity, prior); sourceByTransaction.set(line.transactionIdentity, new Set([...(sourceByTransaction.get(line.transactionIdentity) ?? []), source.checksumSha256]));
  }
  return { transactions, sourceByTransaction, conflicts:[...new Set(conflicts)] };
}

export function normalizedSourceAsInvoice(source: PilotNormalizedSource): PilotParsedInvoice {
  const accountHash = digest([source.account.trim().toUpperCase()]);
  const adjustmentsByEvent = new Map<string, bigint>();
  for (const line of source.lines.filter(({ product }) => product === 'ADJUSTMENT')) adjustmentsByEvent.set(line.transactionIdentity, (adjustmentsByEvent.get(line.transactionIdentity) ?? BigInt(0)) + line.netMinor);
  const adjustedEvents = new Set<string>();
  const rows: PilotParsedRow[] = source.lines.map((line) => {
    if (line.product === 'ADJUSTMENT') return {
      kind:'ADJUSTMENT', sourceRowIndex:line.sourceRowIndex, rawMetadata:line.rawMetadata, description:'Pilot portal transaction adjustment', adjustmentType:'OTHER',
      rawTransactionDate:line.transactionDate.toISOString().slice(0,10), transactionDate:line.transactionDate, signedAmountMinor:line.netMinor,
      fingerprint:line.lineIdentity, sourceLineIdentity:line.lineIdentity, eventKeyHash:line.transactionIdentity, appliedToEvent:true,
    };
    const productCode = line.rawSourceType;
    const eventAdjustment = adjustedEvents.has(line.transactionIdentity) ? BigInt(0) : adjustmentsByEvent.get(line.transactionIdentity) ?? BigInt(0);
    adjustedEvents.add(line.transactionIdentity);
    return {
      kind:'PRODUCT', sourceRowIndex:line.sourceRowIndex, rawMetadata:line.rawMetadata, sourceUnitNumber:line.unit, cardReference:line.cardIdentity,
      locationNumber:line.location, city:line.city, state:line.state, ticketReference:line.transactionReference, authorizationReference:line.transactionReference,
      purchaseOrderContext:'', sourceDriverName:null, rawTransactionDate:line.transactionDate.toISOString().slice(0,10), transactionDate:line.transactionDate,
      outsidePeriod:false, odometer:null, productCode,
      productType:line.product === 'TRUCK_DIESEL' || line.product === 'REEFER_FUEL' || line.product === 'DEF' ? line.product : 'UNKNOWN_PRODUCT',
      quantity:line.quantity, unitPrice:null, amountMinor:line.netMinor + eventAdjustment, retailAmountMinor:line.retailMinor, savingsMinor:line.savingsMinor - eventAdjustment,
      taxMinor:null, discountMinor:null, eventKeyHash:line.transactionIdentity, lineFingerprint:line.lineIdentity, sourceLineIdentity:line.lineIdentity,
    };
  });
  const total = source.lines.reduce((sum, line) => sum + line.netMinor, BigInt(0));
  const portalIdentity = `PORTAL-${source.checksumSha256.slice(0, 24).toUpperCase()}`;
  return { provider:'PILOT', sourceFormat:source.format, billingPeriodExplicit:source.periodStart !== null, observedStart:source.observedStart, observedEnd:source.observedEnd,
    providerAccountReference:source.account, providerAccountHash:accountHash, invoiceNumber:source.invoiceNumber ?? portalIdentity,
    billingDate:source.billingDate ?? source.observedEnd, dueDate:null, periodStart:source.periodStart ?? source.observedStart, periodEnd:source.periodEnd ?? source.observedEnd,
    invoiceTotalMinor:total, parsedTotalMinor:total, differenceMinor:BigInt(0), rows };
}
