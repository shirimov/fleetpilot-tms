import { createHash } from 'node:crypto';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import type { PrismaClient, TruckStatus } from '@prisma/client';
import * as XLSX from '@e965/xlsx';
import { normalizeTruckUnitNumber } from './truck-normalization';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const STATUSES = new Set<TruckStatus>(['ACTIVE', 'INACTIVE', 'MAINTENANCE']);
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const VIN_VALUES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

export class TruckImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TruckImportValidationError';
  }
}

export function normalizeUnitNumber(value: string) {
  return normalizeTruckUnitNumber(value);
}

export function normalizeVin(value: string) {
  return value.trim().replace(/[\s-]+/g, '').toUpperCase();
}

export function isValidVin(vin: string) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  const sum = [...vin].reduce((total, character, index) => {
    const value = /\d/.test(character) ? Number(character) : VIN_VALUES[character];
    return total + value * VIN_WEIGHTS[index];
  }, 0);
  const expected = sum % 11 === 10 ? 'X' : String(sum % 11);
  return vin[8] === expected;
}

type ParsedRow = {
  rowNumber: number;
  unitNumber: string | null;
  unitNumberNormalized: string | null;
  vin: string | null;
  vinNormalized: string | null;
  status: TruckStatus | null;
  year: number | null;
  make: string | null;
  model: string | null;
  errors: string[];
};

function text(value: unknown, max = 120) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : null;
}

function headerKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseRows(bytes: Uint8Array): ParsedRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: 'array', raw: false });
  } catch {
    throw new TruckImportValidationError('The truck file could not be parsed.');
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new TruckImportValidationError('The truck file has no worksheet.');
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
  if (matrix.length < 2) throw new TruckImportValidationError('The truck file has no data rows.');
  const headers = matrix[0].map(headerKey);
  const find = (...aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const columns = {
    unit: find('unitnumber', 'unit', 'trucknumber', 'truck'), vin: find('vin'),
    status: find('status'), year: find('year', 'modelyear'), make: find('make'), model: find('model'),
  };
  if (columns.unit < 0) throw new TruckImportValidationError('A Unit Number column is required.');
  if (matrix.length - 1 > 2000) throw new TruckImportValidationError('A truck import may contain at most 2,000 rows.');
  return matrix.slice(1).filter((row) => row.some((value) => String(value).trim())).map((row, index) => {
    const unitNumber = text(row[columns.unit], 64);
    const unitNumberNormalized = unitNumber ? normalizeUnitNumber(unitNumber) : null;
    const vin = columns.vin >= 0 ? text(row[columns.vin], 32) : null;
    const vinNormalized = vin ? normalizeVin(vin) : null;
    const statusText = columns.status >= 0 ? (text(row[columns.status])?.toUpperCase() ?? 'ACTIVE') : 'ACTIVE';
    const yearText = columns.year >= 0 ? text(row[columns.year]) : null;
    const year = yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : null;
    const errors: string[] = [];
    if (!unitNumberNormalized) errors.push('Unit number is required.');
    if (unitNumberNormalized && unitNumberNormalized.length > 64) errors.push('Unit number is too long.');
    if (vinNormalized && !isValidVin(vinNormalized)) errors.push('VIN must be a valid 17-character VIN with a valid check digit.');
    if (!STATUSES.has(statusText as TruckStatus)) errors.push('Status must be ACTIVE, INACTIVE, or MAINTENANCE.');
    if (yearText && (year === null || year < 1900 || year > new Date().getUTCFullYear() + 2)) errors.push('Year is invalid.');
    return {
      rowNumber: index + 2, unitNumber, unitNumberNormalized, vin, vinNormalized,
      status: STATUSES.has(statusText as TruckStatus) ? statusText as TruckStatus : null,
      year, make: columns.make >= 0 ? text(row[columns.make]) : null,
      model: columns.model >= 0 ? text(row[columns.model]) : null, errors,
    };
  });
}

function sameValue(existing: string | number | null, imported: string | number | null) {
  return imported === null || String(existing ?? '').trim().toUpperCase() === String(imported).trim().toUpperCase();
}

export class TruckImportService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async preview(file: File, context: CompanyAuthorization) {
    if (!/\.(csv|xlsx)$/i.test(file.name) || file.size > MAX_FILE_BYTES || file.size === 0) {
      throw new TruckImportValidationError('Use a non-empty CSV or XLSX file no larger than 5 MB.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checksumSha256 = createHash('sha256').update(bytes).digest('hex');
    const prior = await this.database.truckImportBatch.findUnique({
      where: { companyId_checksumSha256: { companyId: context.companyId, checksumSha256 } },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (prior) return prior;
    const parsed = parseRows(bytes);
    if (!parsed.length) throw new TruckImportValidationError('The truck file has no data rows.');
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`truck-import:${context.companyId}`}))`;
      const existing = await tx.truck.findMany({
        where: { OR: [
          { companyId: context.companyId },
          { vinNormalized: { in: parsed.flatMap((row) => row.vinNormalized ? [row.vinNormalized] : []) } },
        ] },
        select: { id: true, companyId: true, unitNumber: true, unitNumberNormalized: true, vin: true, vinNormalized: true, status: true, year: true, make: true, model: true },
      });
      const unitSeen = new Set<string>(); const vinSeen = new Set<string>();
      const rows = parsed.map((row) => {
        const errors = [...row.errors];
        if (row.unitNumberNormalized && unitSeen.has(row.unitNumberNormalized)) errors.push('Duplicate unit number within this file.');
        if (row.vinNormalized && vinSeen.has(row.vinNormalized)) errors.push('Duplicate VIN within this file.');
        if (row.unitNumberNormalized) unitSeen.add(row.unitNumberNormalized);
        if (row.vinNormalized) vinSeen.add(row.vinNormalized);
        const byUnit = row.unitNumberNormalized ? existing.filter((truck) => truck.companyId === context.companyId && (truck.unitNumberNormalized ?? normalizeUnitNumber(truck.unitNumber)) === row.unitNumberNormalized) : [];
        const byVin = row.vinNormalized ? existing.filter((truck) => (truck.vinNormalized ?? (truck.vin ? normalizeVin(truck.vin) : null)) === row.vinNormalized) : [];
        if (byVin.some((truck) => truck.companyId !== context.companyId)) errors.push('VIN belongs to a truck outside the active company.');
        const candidates = [...new Map([...byUnit, ...byVin].map((truck) => [truck.id, truck])).values()];
        let disposition: 'NEW' | 'MATCHED' | 'CONFLICT' | 'REJECTED' = errors.length ? 'REJECTED' : 'NEW';
        let existingTruckId: string | null = null; let message = errors.join(' ');
        if (!errors.length && candidates.length > 1) { disposition = 'CONFLICT'; message = 'Unit number and VIN identify different trucks.'; }
        else if (!errors.length && candidates.length === 1) {
          const truck = candidates[0]; existingTruckId = truck.id;
          const exact = (!row.vinNormalized || (truck.vinNormalized ?? (truck.vin ? normalizeVin(truck.vin) : null)) === row.vinNormalized)
            && sameValue(truck.status, row.status) && sameValue(truck.year, row.year) && sameValue(truck.make, row.make) && sameValue(truck.model, row.model);
          disposition = exact ? 'MATCHED' : 'CONFLICT';
          message = exact ? 'Matches an existing truck; no change will be made.' : 'Existing truck differs; explicit review is required.';
        }
        return { ...row, disposition, existingTruckId, message: message || null };
      });
      const count = (disposition: string) => rows.filter((row) => row.disposition === disposition).length;
      return tx.truckImportBatch.create({ data: {
        companyId: context.companyId, actorUserId: context.user.id, originalName: file.name.slice(0, 255), checksumSha256,
        totalRows: rows.length, newRows: count('NEW'), matchedRows: count('MATCHED'), conflictRows: count('CONFLICT'), rejectedRows: count('REJECTED'),
        rows: { create: rows.map((row) => ({ rowNumber: row.rowNumber, disposition: row.disposition, unitNumber: row.unitNumber, unitNumberNormalized: row.unitNumberNormalized, vin: row.vin, vinNormalized: row.vinNormalized, status: row.status, year: row.year, make: row.make, model: row.model, existingTruckId: row.existingTruckId, message: row.message })) },
      }, include: { rows: { orderBy: { rowNumber: 'asc' } } } });
    }, { isolationLevel: 'Serializable' });
  }

  async get(batchId: string, context: CompanyAuthorization) {
    const batch = await this.database.truckImportBatch.findFirst({ where: { id: batchId, companyId: context.companyId }, include: { rows: { orderBy: { rowNumber: 'asc' } } } });
    if (!batch) throw new TruckImportValidationError('Import preview not found.');
    return batch;
  }

  async commit(batchId: string, context: CompanyAuthorization) {
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`truck-import:${context.companyId}`}))`;
      const batch = await tx.truckImportBatch.findFirst({ where: { id: batchId, companyId: context.companyId }, include: { rows: { orderBy: { rowNumber: 'asc' } } } });
      if (!batch) throw new TruckImportValidationError('Import preview not found.');
      if (batch.status === 'COMMITTED') return batch;
      if (batch.conflictRows || batch.rejectedRows) throw new TruckImportValidationError('Resolve or remove all conflict and rejected rows before importing.');
      for (const row of batch.rows.filter((candidate) => candidate.disposition === 'NEW')) {
        const collision = await tx.truck.findFirst({ where: { OR: [
          { companyId: context.companyId, unitNumberNormalized: row.unitNumberNormalized },
          ...(row.vinNormalized ? [{ vinNormalized: row.vinNormalized }] : []),
        ] }, select: { id: true } });
        if (collision) throw new TruckImportValidationError(`Row ${row.rowNumber} changed since preview; create a new preview.`);
        const truck = await tx.truck.create({ data: {
          companyId: context.companyId, unitNumber: row.unitNumber!, unitNumberNormalized: row.unitNumberNormalized,
          vin: row.vin, vinNormalized: row.vinNormalized, status: row.status ?? 'ACTIVE', year: row.year, make: row.make, model: row.model,
        } });
        await tx.truckImportRow.update({ where: { id: row.id }, data: { createdTruckId: truck.id } });
      }
      return tx.truckImportBatch.update({ where: { id: batch.id }, data: { status: 'COMMITTED', committedAt: new Date() }, include: { rows: { orderBy: { rowNumber: 'asc' } } } });
    }, { isolationLevel: 'Serializable' });
  }
}

export const truckImportService = new TruckImportService();
