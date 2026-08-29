import { createHash } from 'node:crypto';
import { QuickManageError } from './quickmanage-client';
import type { QuickManageFinancialAudit, QuickManageReportType } from './quickmanage-financial-audit';

export const QUICKMANAGE_FIELD_CLASSIFICATIONS = [
  'IDENTIFIER', 'DATE', 'DATETIME', 'TEXT', 'STATUS', 'RELATIONSHIP_ID', 'MONEY',
  'QUANTITY', 'RATE', 'PERCENT', 'BOOLEAN', 'UNKNOWN',
] as const;
export type QuickManageFieldClassification = typeof QUICKMANAGE_FIELD_CLASSIFICATIONS[number];
export type QuickManageVerificationStatus = 'UNVERIFIED' | 'OBSERVED' | 'VENDOR_VERIFIED' | 'ADMIN_VERIFIED';
export type QuickManageCaptureStatus = 'NO_SAMPLE' | 'SAMPLE_AVAILABLE' | 'STRUCTURE_REVIEWED' | 'SEMANTICS_PARTIAL' | 'SEMANTICS_VERIFIED' | 'IMPORT_MAPPING_READY';
export type QuickManageImportReadiness = 'NOT_AVAILABLE' | 'DISCOVERED' | 'NEEDS_REVIEW' | 'BLOCKED' | 'READY_FOR_IMPORT_DESIGN';

export const FLEETPILOT_ACCOUNTING_CONCEPTS = [
  'LOAD_REVENUE', 'LINEHAUL', 'FUEL_SURCHARGE', 'ACCESSORIAL', 'DETENTION', 'LUMPER',
  'DRIVER_PAY', 'OWNER_PAY', 'FUEL_EXPENSE', 'TOLL_EXPENSE', 'MAINTENANCE_EXPENSE',
  'ADVANCE', 'DEDUCTION', 'REIMBURSEMENT', 'ADJUSTMENT', 'RECEIVABLE', 'PAYMENT',
  'INVOICE_AMOUNT', 'BALANCE', 'OTHER',
] as const;
export type FleetPilotAccountingConcept = typeof FLEETPILOT_ACCOUNTING_CONCEPTS[number];

export type QuickManageMoneyContract = {
  status: 'NOT_APPLICABLE' | 'MONEY_CONTRACT_UNVERIFIED' | 'VERIFIED';
  currency: string | null;
  representation: 'MAJOR' | 'MINOR' | null;
  precision: number | null;
  positiveMeaning: string | null;
  negativeMeaning: string | null;
  nullMeaning: string | null;
  zeroMeaning: string | null;
};

export type QuickManageCapturedField = {
  cid: string;
  name: string;
  declaredType: string | null;
  observedTypes: string[];
  examples: string[];
  classification: QuickManageFieldClassification;
  proposedClassification: QuickManageFieldClassification | null;
  verification: QuickManageVerificationStatus;
  proposedBusinessMeaning: string | null;
  proposedDestination: FleetPilotAccountingConcept | null;
  moneyContract: QuickManageMoneyContract;
};

export type QuickManageReportCapture = {
  reportType: QuickManageReportType;
  subtype: string | null;
  parserVersion: number;
  structureFingerprint: string;
  captureStatus: QuickManageCaptureStatus;
  importReadiness: QuickManageImportReadiness;
  blockingReasons: string[];
  fields: QuickManageCapturedField[];
};

export type QuickManageStructureComparison = {
  sameFingerprint: boolean;
  addedColumns: string[];
  removedColumns: string[];
  orderChanged: boolean;
  declaredTypeChanges: Array<{ column: string; before: string | null; after: string | null }>;
  observedTypeChanges: Array<{ column: string; before: string[]; after: string[] }>;
};
export type QuickManageFieldReview = {
  fieldName: string;
  classification: QuickManageFieldClassification;
  proposedBusinessMeaning: string | null;
  proposedDestination: FleetPilotAccountingConcept | null;
  moneyContract?: QuickManageMoneyContract;
};

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = object(value);
  if (record) return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function envelopeShape(value: unknown, depth = 0): unknown {
  if (depth > 5) return 'truncated';
  if (Array.isArray(value)) return { kind: 'array', item: value.length ? envelopeShape(value[0], depth + 1) : 'unknown' };
  const record = object(value);
  if (record) return Object.fromEntries(Object.keys(record).sort().map((key) => [key, envelopeShape(record[key], depth + 1)]));
  return value == null ? 'null' : typeof value;
}

function observedType(value: unknown) {
  if (value == null || value === '') return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

function sanitizeExample(value: unknown) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '[structured value]';
}

function proposedFromName(name: string): QuickManageFieldClassification | null {
  const normalized = name.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (/\b(id|uuid)$/.test(normalized)) return normalized.match(/^(trip|driver|truck|trailer|customer|user) /) ? 'RELATIONSHIP_ID' : 'IDENTIFIER';
  if (/\b(date|day)$/.test(normalized)) return 'DATE';
  if (/\b(date time|datetime|timestamp|time)$/.test(normalized)) return 'DATETIME';
  if (/\b(status|stage)$/.test(normalized)) return 'STATUS';
  if (/\b(percent|percentage|%)$/.test(normalized)) return 'PERCENT';
  if (/\b(rate|rpm|price per gallon)$/.test(normalized)) return 'RATE';
  if (/\b(amount|revenue|total|balance|pay|cost|fee|charge|deduction)$/.test(normalized)) return 'MONEY';
  if (/\b(gallons|miles|quantity|count|weight)$/.test(normalized)) return 'QUANTITY';
  return null;
}

function classify(column: QuickManageFinancialAudit['columns'][number]): { classification: QuickManageFieldClassification; verification: QuickManageVerificationStatus } {
  const declared = column.dataType?.toLowerCase() ?? null;
  const relationship = /^(trip|driver|truck|trailer|customer|user)[ _-](id|uuid)$/i.test(column.systemName ?? column.name);
  if (relationship) return { classification: 'RELATIONSHIP_ID' as const, verification: 'OBSERVED' as const };
  if (/\b(id|uuid)$/i.test(column.systemName ?? column.name)) return { classification: 'IDENTIFIER', verification: 'OBSERVED' };
  if (['date'].includes(declared ?? '')) return { classification: 'DATE' as const, verification: 'VENDOR_VERIFIED' as const };
  if (['datetime', 'date-time', 'timestamp'].includes(declared ?? '')) return { classification: 'DATETIME' as const, verification: 'VENDOR_VERIFIED' as const };
  if (['boolean', 'bool'].includes(declared ?? '')) return { classification: 'BOOLEAN' as const, verification: 'VENDOR_VERIFIED' as const };
  if (['string', 'text'].includes(declared ?? '')) return { classification: 'TEXT' as const, verification: 'VENDOR_VERIFIED' as const };
  const explicitMoney = (column.unit === 'minor' || column.unit === 'minor_units') ||
    (column.decimalScale != null && ['money', 'decimal', 'currency'].includes(declared ?? ''));
  if (explicitMoney) return { classification: 'MONEY' as const, verification: 'VENDOR_VERIFIED' as const };
  return { classification: 'UNKNOWN' as const, verification: 'UNVERIFIED' as const };
}

function moneyContract(column: QuickManageFinancialAudit['columns'][number], classification: QuickManageFieldClassification): QuickManageMoneyContract {
  if (classification !== 'MONEY') return { status: 'NOT_APPLICABLE', currency: null, representation: null, precision: null, positiveMeaning: null, negativeMeaning: null, nullMeaning: null, zeroMeaning: null };
  const representation = column.unit === 'minor' || column.unit === 'minor_units' ? 'MINOR' : column.decimalScale != null ? 'MAJOR' : null;
  const metadataComplete = Boolean(column.currency && representation && column.decimalScale != null && column.signSemantics && column.nullSemantics && column.zeroSemantics);
  return {
    status: metadataComplete ? 'VERIFIED' : 'MONEY_CONTRACT_UNVERIFIED',
    currency: column.currency,
    representation,
    precision: representation === 'MINOR' ? 0 : column.decimalScale,
    positiveMeaning: column.signSemantics,
    negativeMeaning: column.signSemantics,
    nullMeaning: column.nullSemantics,
    zeroMeaning: column.zeroSemantics,
  };
}

export function captureQuickManageReport(
  reportType: QuickManageReportType,
  subtype: string | null,
  value: unknown,
  audit: QuickManageFinancialAudit,
  parserVersion = 1,
): QuickManageReportCapture {
  if (!Number.isInteger(parserVersion) || parserVersion < 1) throw new QuickManageError('MALFORMED_RESPONSE', 'Invalid QuickManage capture parser version.');
  const data = object(value);
  const content = object(data?.content);
  if (!data || !content || !Array.isArray(content.columns) || !Array.isArray(content.rows) || audit.reportType !== reportType) {
    throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage report cannot be captured safely.');
  }
  const descriptor = {
    parserVersion,
    reportType,
    subtype: subtype?.trim() || null,
    envelope: envelopeShape({ header: data.header, content: { columns: content.columns, rows: [] as unknown[] } }),
    columns: audit.columns.map((column) => ({ name: column.name, dataType: column.dataType, systemName: column.systemName, groupName: column.groupName })),
  };
  const structureFingerprint = createHash('sha256').update(stable(descriptor)).digest('hex');
  const rows = content.rows.map((row) => object(row)).filter((row): row is JsonObject => Boolean(row));
  const fields = audit.columns.map((column) => {
    const verified = classify(column);
    const examples = [...new Set(rows.map((row) => sanitizeExample(row[column.cid])).filter((example): example is string => Boolean(example)))].slice(0, 3);
    const observedTypes = [...new Set(rows.map((row) => observedType(row[column.cid])))].sort();
    return {
      cid: column.cid,
      name: column.name,
      declaredType: column.dataType,
      observedTypes,
      examples,
      classification: verified.classification,
      proposedClassification: verified.classification === 'UNKNOWN' ? proposedFromName(column.name) : null,
      verification: verified.verification,
      proposedBusinessMeaning: null,
      proposedDestination: null,
      moneyContract: moneyContract(column, verified.classification),
    } satisfies QuickManageCapturedField;
  });
  const blockingReasons: string[] = [];
  if (!fields.some((field) => field.classification === 'IDENTIFIER' || field.classification === 'RELATIONSHIP_ID')) blockingReasons.push('No verified idempotency identifier is available.');
  if (fields.some((field) => field.proposedClassification === 'MONEY' || field.moneyContract.status === 'MONEY_CONTRACT_UNVERIFIED')) blockingReasons.push('One or more monetary contracts are unverified.');
  if (fields.some((field) => field.verification === 'UNVERIFIED')) blockingReasons.push('One or more field classifications require review.');
  if (!audit.relationshipReferences.length) blockingReasons.push('No canonical relationship identifiers are available.');
  return {
    reportType,
    subtype: subtype?.trim() || null,
    parserVersion,
    structureFingerprint,
    captureStatus: audit.interpretation === 'PARTIALLY_VERIFIED' ? 'SEMANTICS_PARTIAL' : 'SAMPLE_AVAILABLE',
    importReadiness: blockingReasons.length ? 'BLOCKED' : 'NEEDS_REVIEW',
    blockingReasons,
    fields,
  };
}

export function compareQuickManageStructures(before: QuickManageReportCapture, after: QuickManageReportCapture): QuickManageStructureComparison {
  const beforeNames = before.fields.map((field) => field.name);
  const afterNames = after.fields.map((field) => field.name);
  const shared = before.fields.filter((field) => afterNames.includes(field.name));
  return {
    sameFingerprint: before.structureFingerprint === after.structureFingerprint,
    addedColumns: afterNames.filter((name) => !beforeNames.includes(name)),
    removedColumns: beforeNames.filter((name) => !afterNames.includes(name)),
    orderChanged: shared.map((field) => field.name).join('\u0000') !== after.fields.filter((field) => beforeNames.includes(field.name)).map((field) => field.name).join('\u0000'),
    declaredTypeChanges: shared.flatMap((field) => {
      const next = after.fields.find((candidate) => candidate.name === field.name)!;
      return field.declaredType === next.declaredType ? [] : [{ column: field.name, before: field.declaredType, after: next.declaredType }];
    }),
    observedTypeChanges: shared.flatMap((field) => {
      const next = after.fields.find((candidate) => candidate.name === field.name)!;
      return stable(field.observedTypes) === stable(next.observedTypes) ? [] : [{ column: field.name, before: field.observedTypes, after: next.observedTypes }];
    }),
  };
}

export function reviewQuickManageCapture(capture: QuickManageReportCapture, reviews: QuickManageFieldReview[]): QuickManageReportCapture {
  if (new Set(reviews.map((review) => review.fieldName)).size !== reviews.length) throw new QuickManageError('MALFORMED_RESPONSE', 'Duplicate QuickManage field review.');
  const byName = new Map(reviews.map((review) => [review.fieldName, review]));
  for (const name of byName.keys()) if (!capture.fields.some((field) => field.name === name)) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage field review does not match this structure.');
  const fields = capture.fields.map((field) => {
    const review = byName.get(field.name);
    if (!review) return field;
    if (!QUICKMANAGE_FIELD_CLASSIFICATIONS.includes(review.classification) ||
      (review.proposedDestination && !FLEETPILOT_ACCOUNTING_CONCEPTS.includes(review.proposedDestination))) {
      throw new QuickManageError('MALFORMED_RESPONSE', 'Invalid QuickManage field review.');
    }
    const reviewedMoney = review.classification === 'MONEY'
      ? review.moneyContract ?? { ...field.moneyContract, status: 'MONEY_CONTRACT_UNVERIFIED' as const }
      : { status: 'NOT_APPLICABLE' as const, currency: null, representation: null, precision: null, positiveMeaning: null, negativeMeaning: null, nullMeaning: null, zeroMeaning: null };
    return {
      ...field,
      classification: review.classification,
      proposedClassification: null,
      verification: 'ADMIN_VERIFIED' as const,
      proposedBusinessMeaning: review.proposedBusinessMeaning?.trim() || null,
      proposedDestination: review.proposedDestination,
      moneyContract: reviewedMoney,
    };
  });
  const blockingReasons: string[] = [];
  if (!fields.some((field) => field.classification === 'IDENTIFIER' || field.classification === 'RELATIONSHIP_ID')) blockingReasons.push('No verified idempotency identifier is available.');
  if (!fields.some((field) => field.classification === 'RELATIONSHIP_ID')) blockingReasons.push('Required canonical relationships are not understood.');
  if (fields.some((field) => field.verification === 'UNVERIFIED')) blockingReasons.push('One or more field classifications require review.');
  if (fields.some((field) => field.classification === 'MONEY' && field.moneyContract.status !== 'VERIFIED')) blockingReasons.push('One or more monetary contracts are unverified.');
  if (fields.some((field) => field.classification === 'MONEY' && !field.proposedDestination)) blockingReasons.push('One or more monetary fields have no reviewed FleetPilot concept.');
  const reviewedAll = fields.every((field) => field.verification !== 'UNVERIFIED');
  return {
    ...capture,
    fields,
    captureStatus: blockingReasons.length ? (reviewedAll ? 'STRUCTURE_REVIEWED' : capture.captureStatus) : 'IMPORT_MAPPING_READY',
    importReadiness: blockingReasons.length ? 'BLOCKED' : 'READY_FOR_IMPORT_DESIGN',
    blockingReasons,
  };
}
