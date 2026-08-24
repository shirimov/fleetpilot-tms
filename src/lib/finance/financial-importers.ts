import type { FinancialDirection } from '@prisma/client';
import { createHash } from 'node:crypto';
import { FinancialValidationError } from './financial-control-errors';
import { parsePositiveMinorUnits } from './money';

export type CanonicalImportCandidate = {
  sourceRowIndex: number;
  rawDescription: string | null;
  rawDate: string | null;
  rawAmount: string | null;
  rawReference: string | null;
  rawMetadata: Record<string, string>;
  candidateDate: Date | null;
  candidateAmountMinor: bigint | null;
  candidateDirection: FinancialDirection | null;
  candidateDescription: string | null;
  fingerprintSha256: string;
};

export interface FinancialStatementImporter {
  readonly id: string;
  supports(mimeType: string): boolean;
  parse(bytes: Uint8Array): CanonicalImportCandidate[];
}

function parseLine(line: string) {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { values.push(current.trim()); current = ''; }
    else current += character;
  }
  if (quoted) throw new FinancialValidationError('CSV contains an unterminated quoted value.');
  values.push(current.trim());
  return values;
}

const aliases = {
  date: ['date', 'transaction date', 'posted date'],
  description: ['description', 'name', 'memo'],
  amount: ['amount', 'total'],
  direction: ['direction', 'type'],
  reference: ['reference', 'reference number', 'id'],
};

export class GenericCsvImporter implements FinancialStatementImporter {
  readonly id = 'generic-csv-v1';
  supports(mimeType: string) { return ['text/csv', 'application/csv', 'text/plain'].includes(mimeType); }

  parse(bytes: Uint8Array) {
    const contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    const lines = contents.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) throw new FinancialValidationError('CSV requires a header and at least one row.');
    const headers = parseLine(lines[0]).map((header) => header.toLowerCase());
    const column = (key: keyof typeof aliases) => headers.findIndex((header) => aliases[key].includes(header));
    const columns = { date: column('date'), description: column('description'), amount: column('amount'), direction: column('direction'), reference: column('reference') };
    if (columns.date < 0 || columns.description < 0 || columns.amount < 0) throw new FinancialValidationError('CSV must contain date, description, and amount columns.');
    return lines.slice(1).map((line, offset) => {
      const values = parseLine(line);
      if (values.length !== headers.length) throw new FinancialValidationError(`CSV row ${offset + 2} has the wrong number of columns.`);
      const metadata = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
      const rawAmount = values[columns.amount];
      const negative = /^-/.test(rawAmount) || /^\(.*\)$/.test(rawAmount);
      const unsigned = rawAmount.replace(/^[-(]|\)$/g, '').replace(/^\$/, '');
      let candidateAmountMinor: bigint | null = null;
      try { candidateAmountMinor = parsePositiveMinorUnits(unsigned); } catch { /* preserve malformed source for review */ }
      const explicitDirection = columns.direction >= 0 ? values[columns.direction].toUpperCase() : '';
      const candidateDirection: FinancialDirection | null = explicitDirection.includes('IN') || explicitDirection.includes('CREDIT') ? 'INFLOW' : explicitDirection.includes('OUT') || explicitDirection.includes('DEBIT') ? 'OUTFLOW' : candidateAmountMinor ? (negative ? 'OUTFLOW' : 'INFLOW') : null;
      const rawDate = values[columns.date];
      const parsedDate = new Date(rawDate);
      const candidateDate = Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
      const rawDescription = values[columns.description] || null;
      const rawReference = columns.reference >= 0 ? values[columns.reference] || null : null;
      const fingerprintSha256 = createHash('sha256').update([rawDate, rawAmount, rawDescription, rawReference].join('\u001f')).digest('hex');
      return { sourceRowIndex: offset + 1, rawDescription, rawDate, rawAmount, rawReference, rawMetadata: metadata, candidateDate, candidateAmountMinor, candidateDirection, candidateDescription: rawDescription, fingerprintSha256 };
    });
  }
}

export const genericCsvImporter = new GenericCsvImporter();
