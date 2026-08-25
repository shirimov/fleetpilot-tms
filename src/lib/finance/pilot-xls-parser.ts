import { createHash } from 'node:crypto';
import * as XLSX from '@e965/xlsx';
import { FinancialValidationError } from './financial-control-errors';

export const PILOT_XLS_PARSER_VERSION = 'pilot-biff-v2';
export const MAX_PILOT_XLS_BYTES = 5 * 1024 * 1024;
export const MAX_PILOT_ROWS = 5_000;
export const MAX_PILOT_CELLS = 100_000;
const SHEET_NAME = 'StatementEFS_US';
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

type ExactNumericCell = { scaled(scale: number): bigint };

export type PilotParsedProductLine = {
  kind: 'PRODUCT';
  sourceRowIndex: number;
  rawMetadata: Record<string, string>;
  sourceUnitNumber: string;
  cardReference: string;
  locationNumber: string;
  city: string;
  state: string;
  ticketReference: string;
  authorizationReference: string;
  purchaseOrderContext: string;
  sourceDriverName: string | null;
  rawTransactionDate: string;
  transactionDate: Date | null;
  outsidePeriod: boolean;
  odometer: string | null;
  productCode: string;
  productType: 'TRUCK_DIESEL' | 'REEFER_FUEL' | 'DEF' | 'UNKNOWN_PRODUCT';
  quantity: string | null;
  unitPrice: string | null;
  amountMinor: bigint | null;
  retailAmountMinor: bigint | null;
  savingsMinor: bigint | null;
  taxMinor: bigint | null;
  discountMinor: bigint | null;
  eventKeyHash: string | null;
  lineFingerprint: string;
  sourceLineIdentity: string;
};

export type PilotParsedAdjustment = {
  kind: 'ADJUSTMENT';
  sourceRowIndex: number;
  rawMetadata: Record<string, string>;
  description: string;
  adjustmentType: 'FREIGHT_RATE' | 'OTHER';
  rawTransactionDate: string;
  transactionDate: Date | null;
  signedAmountMinor: bigint | null;
  fingerprint: string;
  sourceLineIdentity: string;
};

export type PilotParsedNonEconomicRow = {
  kind: 'NON_ECONOMIC';
  rowClass: 'PRODUCT_SUBTOTAL' | 'CARD_SUBTOTAL' | 'SAVINGS_SUBTOTAL' | 'AVERAGE_COST' | 'REPEATED_HEADER' | 'METADATA' | 'BLANK' | 'UNKNOWN_NON_ECONOMIC' | 'UNKNOWN_AMOUNT_BEARING';
  sourceRowIndex: number;
  rawMetadata: Record<string, string>;
  rawTransactionDate: string;
  transactionDate: Date | null;
  signedAmountMinor: bigint | null;
  fingerprint: string;
};

export type PilotParsedRow = PilotParsedProductLine | PilotParsedAdjustment | PilotParsedNonEconomicRow;

export type PilotParsedInvoice = {
  provider: 'PILOT';
  providerAccountHash: string;
  invoiceNumber: string;
  billingDate: Date;
  dueDate: Date | null;
  periodStart: Date;
  periodEnd: Date;
  invoiceTotalMinor: bigint;
  parsedTotalMinor: bigint;
  differenceMinor: bigint;
  rows: PilotParsedRow[];
};

const productTypes = new Map([
  ['020', 'TRUCK_DIESEL'],
  ['033', 'REEFER_FUEL'],
  ['140', 'DEF'],
] as const);

const expectedHeaders = [
  ['Card', 'Number'], ['Unit', 'Number'], ['', 'Loc.'], ['Location', 'City                  ST'],
  ['Ticket', 'Number'], ['Auth.', 'Number'], ['P.O.', 'Number'], ['Trans', 'Date'],
  ['Odometer', 'Reading'], ['Fuel', 'Type'], ['Fuel', 'Units'], ['Fuel', 'Cost'],
  ['Fuel', 'Amount'], ['Oil', 'Qts'], ['Oil', 'Amount'], ['Cash', 'Advance'],
  ['Misc./', 'Disc.'], ['Sales', 'Tax'], ['Invoice', 'Total'], ['Retail', 'Total'],
] as const;

function hash(parts: Array<string | null | undefined>) {
  return createHash('sha256').update(parts.map((part) => part ?? '').join('\u001f')).digest('hex');
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function dateOnly(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day ? value : null;
}

function parseMetadataDate(value: string, label: string) {
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{2})/);
  if (!match) throw new FinancialValidationError(`Pilot ${label} is invalid.`);
  const parsed = dateOnly(2000 + Number(match[3]), Number(match[1]), Number(match[2]));
  if (!parsed) throw new FinancialValidationError(`Pilot ${label} is invalid.`);
  return parsed;
}

function addUtcDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function resolveTransactionDate(raw: string, periodStart: Date, periodEnd: Date) {
  const match = raw.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const candidates = [-1, 0, 1]
    .map((offset) => dateOnly(periodStart.getUTCFullYear() + offset, Number(match[1]), Number(match[2])))
    .filter((value): value is Date => value !== null);
  const distance = (value: Date) => value < periodStart ? periodStart.getTime() - value.getTime() : value > periodEnd ? value.getTime() - periodEnd.getTime() : 0;
  candidates.sort((left, right) => distance(left) - distance(right));
  if (!candidates[0] || distance(candidates[0]) > 183 * 86_400_000) return null;
  return candidates[0];
}

function decimalString(value: bigint, scale: number) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const divisor = BigInt(10) ** BigInt(scale);
  return `${negative ? '-' : ''}${absolute / divisor}.${String(absolute % divisor).padStart(scale, '0')}`;
}

function divideRounded(numerator: bigint, denominator: bigint) {
  const negative = numerator < BigInt(0);
  const absolute = negative ? -numerator : numerator;
  let quotient = absolute / denominator;
  const remainder = absolute % denominator;
  if (remainder * BigInt(2) >= denominator) quotient += BigInt(1);
  return negative ? -quotient : quotient;
}

function exactDoubleCell(bits: bigint, divisor = BigInt(1)): ExactNumericCell {
  return {
    scaled(scale: number) {
      const sign = (bits >> BigInt(63)) === BigInt(0) ? BigInt(1) : -BigInt(1);
      const exponentBits = Number((bits >> BigInt(52)) & BigInt(0x7ff));
      const fraction = bits & ((BigInt(1) << BigInt(52)) - BigInt(1));
      if (exponentBits === 0x7ff) throw new FinancialValidationError('Pilot XLS contains a non-finite number.');
      if (exponentBits === 0 && fraction === BigInt(0)) return BigInt(0);
      const significand = exponentBits === 0 ? fraction : (BigInt(1) << BigInt(52)) | fraction;
      const exponent = (exponentBits === 0 ? 1 - 1023 : exponentBits - 1023) - 52;
      const numerator = significand * (BigInt(10) ** BigInt(scale));
      if (exponent >= 0) return divideRounded(sign * (numerator << BigInt(exponent)), divisor);
      const denominator = (BigInt(1) << BigInt(-exponent)) * divisor;
      return sign * divideRounded(numerator, denominator);
    },
  };
}

function exactRkCell(raw: number): ExactNumericCell {
  const dividedBy100 = (raw & 1) !== 0;
  if ((raw & 2) !== 0) {
    const signed = raw >> 2;
    return { scaled: (scale) => divideRounded(BigInt(signed) * (BigInt(10) ** BigInt(scale)), dividedBy100 ? BigInt(100) : BigInt(1)) };
  }
  const bits = BigInt(raw & 0xfffffffc) << BigInt(32);
  return exactDoubleCell(bits, dividedBy100 ? BigInt(100) : BigInt(1));
}

function biffNumericCells(workbookStream: Uint8Array, sheetOffset: number) {
  const bytes = Buffer.from(workbookStream.buffer, workbookStream.byteOffset, workbookStream.byteLength);
  const cells = new Map<string, ExactNumericCell>();
  let offset = sheetOffset;
  let recordCount = 0;
  while (offset + 4 <= bytes.length) {
    const id = bytes.readUInt16LE(offset);
    const length = bytes.readUInt16LE(offset + 2);
    const start = offset + 4;
    const end = start + length;
    if (end > bytes.length) throw new FinancialValidationError('Pilot XLS record structure is invalid.');
    recordCount += 1;
    if (recordCount > 250_000) throw new FinancialValidationError('Pilot XLS contains too many records.');
    if (id === 0x0006) throw new FinancialValidationError('Pilot XLS formulas are not allowed.');
    if ([0x0017, 0x0023, 0x0059, 0x005a].includes(id)) throw new FinancialValidationError('Pilot XLS external links are not allowed.');
    if (id === 0x0203 && length >= 14) {
      const row = bytes.readUInt16LE(start); const column = bytes.readUInt16LE(start + 2);
      cells.set(`${row}:${column}`, exactDoubleCell(bytes.readBigUInt64LE(start + 6)));
    } else if (id === 0x027e && length >= 10) {
      const row = bytes.readUInt16LE(start); const column = bytes.readUInt16LE(start + 2);
      cells.set(`${row}:${column}`, exactRkCell(bytes.readUInt32LE(start + 6)));
    } else if (id === 0x00bd && length >= 12) {
      const row = bytes.readUInt16LE(start); const firstColumn = bytes.readUInt16LE(start + 2); const lastColumn = bytes.readUInt16LE(end - 2);
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const rkOffset = start + 4 + (column - firstColumn) * 6 + 2;
        cells.set(`${row}:${column}`, exactRkCell(bytes.readUInt32LE(rkOffset)));
      }
    }
    offset = end;
    if (id === 0x000a) break;
  }
  return cells;
}

function workbookSheetOffsets(workbookStream: Uint8Array) {
  const bytes = Buffer.from(workbookStream.buffer, workbookStream.byteOffset, workbookStream.byteLength);
  const sheets: Array<{ name: string; offset: number }> = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const id = bytes.readUInt16LE(offset); const length = bytes.readUInt16LE(offset + 2); const start = offset + 4; const end = start + length;
    if (end > bytes.length) throw new FinancialValidationError('Pilot XLS record structure is invalid.');
    if (id === 0x0006) throw new FinancialValidationError('Pilot XLS formulas are not allowed.');
    if ([0x0017, 0x0023, 0x0059, 0x005a].includes(id)) throw new FinancialValidationError('Pilot XLS external links are not allowed.');
    if (id === 0x0085 && length >= 8) {
      const nameLength = bytes[start + 6]; const unicode = (bytes[start + 7] & 1) !== 0;
      const nameStart = start + 8; const nameBytes = nameLength * (unicode ? 2 : 1);
      if (nameStart + nameBytes > end) throw new FinancialValidationError('Pilot XLS sheet metadata is invalid.');
      sheets.push({ name: bytes.toString(unicode ? 'utf16le' : 'latin1', nameStart, nameStart + nameBytes), offset: bytes.readUInt32LE(start) });
    }
    offset = end;
  }
  return sheets;
}

function cellText(sheet: XLSX.WorkSheet, row: number, column: number) {
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
  return normalizeText(cell?.v);
}

function numeric(cells: Map<string, ExactNumericCell>, row: number, column: number, scale: number) {
  return cells.get(`${row}:${column}`)?.scaled(scale) ?? null;
}

function safeRawMetadata(sheet: XLSX.WorkSheet, numerics: Map<string, ExactNumericCell>, row: number) {
  const labels = ['cardNumber', 'unitNumber', 'locationNumber', 'location', 'ticketNumber', 'authorizationNumber', 'purchaseOrder', 'transactionDate', 'odometer', 'productCode'];
  const result: Record<string, string> = {};
  for (let column = 0; column < 10; column += 1) result[labels[column]] = cellText(sheet, row, column);
  for (const [column, label, scale] of [[10, 'quantity', 2], [11, 'unitPrice', 7], [12, 'fuelAmount', 2], [13, 'oilQuantity', 2], [14, 'oilAmount', 2], [15, 'cashAdvance', 2], [16, 'miscDiscount', 2], [17, 'salesTax', 2], [18, 'invoiceAmount', 2], [19, 'retailAmount', 2]] as const) {
    const value = numeric(numerics, row, column, scale);
    result[label] = value === null ? '' : decimalString(value, scale);
  }
  return result;
}

function rowText(sheet: XLSX.WorkSheet, row: number) {
  return Array.from({ length: expectedHeaders.length }, (_, column) => cellText(sheet, row, column)).filter(Boolean).join(' ');
}

function isRepeatedHeader(sheet: XLSX.WorkSheet, row: number) {
  return expectedHeaders.every(([top, bottom], column) => {
    const value = cellText(sheet, row, column);
    return value === normalizeText(top) || value === normalizeText(bottom) || (!value && !top);
  });
}

function nonEconomicClass(sheet: XLSX.WorkSheet, row: number, amount: bigint | null): PilotParsedNonEconomicRow['rowClass'] | null {
  const text = rowText(sheet, row).toLowerCase();
  if (!text && amount === null) return 'BLANK';
  if (isRepeatedHeader(sheet, row)) return 'REPEATED_HEADER';
  if (/\b(?:invoice\s*no|billing\s+date|due\s+date)\b/i.test(text)) return 'METADATA';
  if (/\b(?:020|033|140)\s+subtotal\b/i.test(text)) return 'PRODUCT_SUBTOTAL';
  if (/\bcard\s+subtotal\b/i.test(text)) return 'CARD_SUBTOTAL';
  if (/\bsavings\s+sub\s*total\b/i.test(text)) return 'SAVINGS_SUBTOTAL';
  if (/\baverage\s+cost\s+per\s+gallon\b/i.test(text)) return 'AVERAGE_COST';
  return null;
}

export class PilotXlsParser {
  parse(bytes: Uint8Array): PilotParsedInvoice {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PILOT_XLS_BYTES) throw new FinancialValidationError('Pilot XLS must be between 1 byte and 5 MB.');
    if (!OLE_SIGNATURE.every((value, index) => bytes[index] === value)) throw new FinancialValidationError('Pilot statement must be a legacy OLE/BIFF XLS file.');
    let workbook: XLSX.WorkBook;
    let workbookStream: Uint8Array;
    let offsets: Array<{ name: string; offset: number }>;
    try {
      const cfb = XLSX.CFB.read(Buffer.from(bytes), { type: 'buffer' });
      if (cfb.FullPaths.some((entry: string) => /(?:^|\/)(?:VBA|Macros|_VBA_PROJECT_CUR)(?:\/|$)/i.test(entry))) throw new FinancialValidationError('Pilot XLS macros are not allowed.');
      const workbookEntry = XLSX.CFB.find(cfb, 'Workbook') ?? XLSX.CFB.find(cfb, 'Book');
      if (!workbookEntry?.content) throw new FinancialValidationError('Pilot XLS workbook stream is missing.');
      workbookStream = workbookEntry.content as Uint8Array;
      offsets = workbookSheetOffsets(workbookStream);
      workbook = XLSX.read(bytes, { type: 'array', raw: true, cellFormula: true, bookVBA: true, bookFiles: true, bookDeps: true, sheetRows: MAX_PILOT_ROWS + 1 });
    } catch (error) {
      if (error instanceof FinancialValidationError) throw error;
      throw new FinancialValidationError('Pilot XLS could not be parsed safely.');
    }
    if (workbook.SheetNames.length !== 1 || workbook.SheetNames[0] !== SHEET_NAME) throw new FinancialValidationError(`Pilot XLS must contain only the ${SHEET_NAME} sheet.`);
    if (workbook.vbaraw) throw new FinancialValidationError('Pilot XLS macros are not allowed.');
    const sheet = workbook.Sheets[SHEET_NAME];
    const rangeText = sheet['!fullref'] ?? sheet['!ref'];
    if (!rangeText) throw new FinancialValidationError('Pilot XLS sheet is empty.');
    const range = XLSX.utils.decode_range(rangeText);
    const rowCount = range.e.r - range.s.r + 1; const columnCount = range.e.c - range.s.c + 1;
    if (rowCount < 5 || rowCount > MAX_PILOT_ROWS || columnCount !== 20 || rowCount * columnCount > MAX_PILOT_CELLS) throw new FinancialValidationError('Pilot XLS dimensions are outside supported limits.');
    for (const key of Object.keys(sheet)) if (!key.startsWith('!') && sheet[key]?.f) throw new FinancialValidationError('Pilot XLS formulas are not allowed.');
    if (offsets.length !== 1 || offsets[0].name !== SHEET_NAME) throw new FinancialValidationError('Pilot XLS sheet structure is invalid.');
    const numerics = biffNumericCells(workbookStream, offsets[0].offset);
    for (let column = 0; column < expectedHeaders.length; column += 1) {
      const [top, bottom] = expectedHeaders[column];
      if (cellText(sheet, 1, column) !== normalizeText(top) || cellText(sheet, 2, column) !== normalizeText(bottom)) throw new FinancialValidationError('Pilot XLS header structure is invalid.');
    }
    const account = cellText(sheet, 0, 1);
    const invoiceMatch = cellText(sheet, 0, 6).match(/^InvoiceNo:\s*(\d+)$/i);
    const billingDue = cellText(sheet, 0, 10);
    if (!account || !invoiceMatch || !/^Billing Date:/i.test(billingDue)) throw new FinancialValidationError('Pilot XLS invoice metadata is invalid.');
    const billingDate = parseMetadataDate(billingDue, 'billing date');
    const dueMatch = billingDue.match(/Due Date:\s*(\d{2}\/\d{2}\/\d{2})/i);
    const dueDate = dueMatch ? parseMetadataDate(dueMatch[1], 'due date') : null;
    const periodStart = addUtcDays(billingDate, -7); const periodEnd = addUtcDays(billingDate, -1);
    if (cellText(sheet, rowCount - 1, 0).toLowerCase() !== 'total:') throw new FinancialValidationError('Pilot XLS final control row is missing.');
    const invoiceTotalMinor = numeric(numerics, rowCount - 1, 18, 2);
    if (invoiceTotalMinor === null || invoiceTotalMinor <= BigInt(0)) throw new FinancialValidationError('Pilot XLS invoice total is invalid.');
    const rows: PilotParsedRow[] = [];
    let parsedTotalMinor = BigInt(0);
    for (let row = 3; row < rowCount - 1; row += 1) {
      const rawMetadata = safeRawMetadata(sheet, numerics, row);
      const productCode = rawMetadata.productCode;
      const signedAmountMinor = numeric(numerics, row, 18, 2);
      const rawDate = rawMetadata.transactionDate;
      const transactionDate = resolveTransactionDate(rawDate, periodStart, periodEnd);
      const knownNonEconomic = nonEconomicClass(sheet, row, signedAmountMinor);
      if (knownNonEconomic) {
        rows.push({ kind: 'NON_ECONOMIC', rowClass: knownNonEconomic, sourceRowIndex: row + 1, rawMetadata, rawTransactionDate: rawDate, transactionDate, signedAmountMinor, fingerprint: hash([invoiceMatch[1], knownNonEconomic, row.toString(), rowText(sheet, row), signedAmountMinor?.toString()]) });
        continue;
      }
      const supportedAdjustment = !productCode
        && /^(?:incorrect\s+)?freight\s+ra(?:te)?$/i.test(rawMetadata.ticketNumber)
        && Boolean(rawDate)
        && signedAmountMinor !== null
        && signedAmountMinor !== BigInt(0)
        && !rawMetadata.cardNumber && !rawMetadata.unitNumber && !rawMetadata.authorizationNumber
        && !rawMetadata.purchaseOrder && !rawMetadata.odometer;
      if (supportedAdjustment) {
        const description = rawMetadata.ticketNumber;
        const fingerprint = hash([invoiceMatch[1], 'adjustment', description, rawDate, signedAmountMinor?.toString()]);
        parsedTotalMinor += signedAmountMinor;
        rows.push({ kind: 'ADJUSTMENT', sourceRowIndex: row + 1, rawMetadata, description, adjustmentType: 'FREIGHT_RATE', rawTransactionDate: rawDate, transactionDate, signedAmountMinor, fingerprint, sourceLineIdentity: hash([fingerprint, row.toString()]) });
        continue;
      }
      const quantity = numeric(numerics, row, 10, 2); const unitPrice = numeric(numerics, row, 11, 7); const retail = numeric(numerics, row, 19, 2); const tax = numeric(numerics, row, 17, 2); const discount = numeric(numerics, row, 16, 2);
      const ticketReference = rawMetadata.ticketNumber; const authorizationReference = rawMetadata.authorizationNumber;
      if (!productCode || !rawMetadata.unitNumber || !ticketReference || !authorizationReference || !rawDate || quantity === null || unitPrice === null || signedAmountMinor === null) {
        const rowClass = signedAmountMinor === null ? 'UNKNOWN_NON_ECONOMIC' : 'UNKNOWN_AMOUNT_BEARING';
        rows.push({ kind: 'NON_ECONOMIC', rowClass, sourceRowIndex: row + 1, rawMetadata, rawTransactionDate: rawDate, transactionDate, signedAmountMinor, fingerprint: hash([invoiceMatch[1], rowClass, row.toString(), rowText(sheet, row), signedAmountMinor?.toString()]) });
        continue;
      }
      parsedTotalMinor += signedAmountMinor;
      const eventKeyHash = ticketReference && authorizationReference ? hash([invoiceMatch[1], ticketReference, authorizationReference]) : null;
      const location = rawMetadata.location; const stateMatch = location.match(/\s([A-Z]{2})$/); const state = stateMatch?.[1] ?? ''; const city = state ? location.slice(0, -state.length).trim() : location;
      const sourceUnitNumber = rawMetadata.unitNumber.trim();
      rows.push({
        kind: 'PRODUCT', sourceRowIndex: row + 1, rawMetadata, sourceUnitNumber, cardReference: rawMetadata.cardNumber,
        locationNumber: rawMetadata.locationNumber, city, state, ticketReference, authorizationReference,
        purchaseOrderContext: rawMetadata.purchaseOrder, sourceDriverName: rawMetadata.purchaseOrder || null,
        rawTransactionDate: rawDate, transactionDate, outsidePeriod: transactionDate ? transactionDate < periodStart || transactionDate > periodEnd : false,
        odometer: rawMetadata.odometer || null, productCode, productType: productTypes.get(productCode as '020' | '033' | '140') ?? 'UNKNOWN_PRODUCT',
        quantity: quantity === null ? null : decimalString(quantity, 2), unitPrice: unitPrice === null ? null : decimalString(unitPrice, 7), amountMinor: signedAmountMinor,
        retailAmountMinor: retail, savingsMinor: retail !== null && signedAmountMinor !== null ? retail - signedAmountMinor : null, taxMinor: tax, discountMinor: discount,
        eventKeyHash,
        lineFingerprint: hash([invoiceMatch[1], eventKeyHash, productCode, quantity?.toString(), unitPrice?.toString(), signedAmountMinor?.toString(), location, sourceUnitNumber]),
        sourceLineIdentity: hash([invoiceMatch[1], eventKeyHash, productCode, quantity?.toString(), unitPrice?.toString(), signedAmountMinor?.toString(), row.toString()]),
      });
    }
    return { provider: 'PILOT', providerAccountHash: hash([account.trim().toUpperCase()]), invoiceNumber: invoiceMatch[1], billingDate, dueDate, periodStart, periodEnd, invoiceTotalMinor, parsedTotalMinor, differenceMinor: parsedTotalMinor - invoiceTotalMinor, rows };
  }
}

export const pilotXlsParser = new PilotXlsParser();
