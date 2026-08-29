import { createHash } from 'node:crypto';
import { QuickManageError } from './quickmanage-client';

export const QUICKMANAGE_FINANCIAL_REPORT_DEFINITIONS = [
  { type: 'trip', label: 'Trip', family: 'operations', semantics: 'PARTIALLY_VERIFIED' },
  { type: 'fuel', label: 'Fuel', family: 'financial', semantics: 'UNVERIFIED' },
  { type: 'toll', label: 'Tolls', family: 'financial', semantics: 'UNVERIFIED' },
  { type: 'statement', label: 'Statements', family: 'financial', semantics: 'UNVERIFIED' },
  { type: 'receivable', label: 'Receivables', family: 'financial', semantics: 'UNVERIFIED' },
  { type: '1099', label: '1099', family: 'tax', semantics: 'UNVERIFIED' },
  { type: 'adjustment', label: 'Adjustments', family: 'financial', semantics: 'UNVERIFIED' },
  { type: 'maintenance', label: 'Maintenance', family: 'operations', semantics: 'UNVERIFIED' },
  { type: 'inspection', label: 'Inspections', family: 'operations', semantics: 'UNVERIFIED' },
  { type: 'account-resource-employee', label: 'Account Resource · Employee', family: 'account-resource', semantics: 'UNVERIFIED' },
  { type: 'account-resource-site-user', label: 'Account Resource · Site User', family: 'account-resource', semantics: 'UNVERIFIED' },
  { type: 'account-resource-equipment', label: 'Account Resource · Equipment', family: 'account-resource', semantics: 'UNVERIFIED' },
  { type: 'account-resource-address', label: 'Account Resource · Address', family: 'account-resource', semantics: 'UNVERIFIED' },
  { type: 'account-resource-vendor', label: 'Account Resource · Vendor', family: 'account-resource', semantics: 'UNVERIFIED' },
  { type: 'account-resource-customer', label: 'Account Resource · Customer', family: 'account-resource', semantics: 'UNVERIFIED' },
  { type: 'account-resource-attachment', label: 'Account Resource · Attachment', family: 'account-resource', semantics: 'UNVERIFIED' },
  { type: 'driver-perf', label: 'Driver Performance', family: 'operations', semantics: 'UNVERIFIED' },
] as const;

export type QuickManageReportType = typeof QUICKMANAGE_FINANCIAL_REPORT_DEFINITIONS[number]['type'];
export type AuditSeverity = 'INFO' | 'WARNING' | 'ERROR';
export type QuickManageAuditFinding = {
  severity: AuditSeverity;
  code: string;
  message: string;
  rowIndexes?: number[];
  column?: string;
};
export type QuickManageAuditColumn = {
  cid: string;
  name: string;
  description: string | null;
  systemName: string | null;
  groupName: string | null;
  dataType: string | null;
  currency: string | null;
  decimalScale: number | null;
  unit: string | null;
  aggregation: string | null;
  signSemantics: string | null;
};
export type ExactColumnTotal = {
  column: string;
  currency: string | null;
  scale: number;
  calculated: string;
  supplied: string | null;
  matches: boolean | null;
};
export type QuickManageFinancialAudit = {
  reportType: QuickManageReportType;
  interpretation: 'PARTIALLY_VERIFIED' | 'UNVERIFIED';
  columns: QuickManageAuditColumn[];
  rowCount: number;
  suppliedSummaryPresent: boolean;
  exactTotals: ExactColumnTotal[];
  relationshipColumns: Array<{ column: string; resource: 'TRIP' | 'DRIVER' | 'TRUCK' | 'TRAILER' | 'CUSTOMER' | 'USER' }>;
  relationshipReferences: Array<{ column: string; resource: 'TRIP' | 'DRIVER' | 'TRUCK' | 'TRAILER' | 'CUSTOMER' | 'USER'; externalId: string; rowIndexes: number[] }>;
  findings: QuickManageAuditFinding[];
};

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

function columnName(column: JsonObject) {
  const key = object(column.key);
  return text(key?.name) ?? text(column.key) ?? `Column ${String(column.cid)}`;
}

function parseColumn(value: unknown): QuickManageAuditColumn {
  const column = object(value);
  if (!column || (!Number.isInteger(column.cid) && typeof column.cid !== 'string')) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid report column.');
  const key = object(column.key);
  const metadata = object(column.metadata) ?? {};
  const scale = metadata.decimal_scale;
  return {
    cid: String(column.cid),
    name: columnName(column),
    description: text(column.description),
    systemName: text(metadata.system_name),
    groupName: text(metadata.group_name),
    dataType: text(key?.data_type) ?? text(metadata.data_type),
    currency: text(metadata.currency),
    decimalScale: Number.isInteger(scale) && Number(scale) >= 0 && Number(scale) <= 9 ? Number(scale) : null,
    unit: text(metadata.unit),
    aggregation: text(metadata.aggregation) ?? text(metadata.aggregate),
    signSemantics: text(metadata.sign_semantics),
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const row = object(value);
  if (row) return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function parseScaledDecimal(value: unknown, scale: number): bigint | null {
  if (value == null || value === '') return null;
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const match = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match || (match[3]?.length ?? 0) > scale) return null;
  const sign = match[1] === '-' ? -BigInt(1) : BigInt(1);
  const fraction = (match[3] ?? '').padEnd(scale, '0');
  return sign * BigInt(`${match[2]}${fraction}`);
}

function formatScaled(value: bigint, scale: number) {
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const formatted = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return `${negative ? '-' : ''}${formatted}`;
}

function summaryValue(summary: JsonObject | null, column: QuickManageAuditColumn) {
  if (!summary) return undefined;
  return summary[column.cid] ?? summary[column.name] ?? (column.systemName ? summary[column.systemName] : undefined);
}

function relationshipResource(name: string) {
  const normalized = name.trim().toLowerCase().replace(/[_-]+/g, ' ');
  const rules: Array<[RegExp, QuickManageFinancialAudit['relationshipColumns'][number]['resource']]> = [
    [/^trip (id|uuid)$/, 'TRIP'], [/^driver (id|uuid)$/, 'DRIVER'], [/^truck (id|uuid)$/, 'TRUCK'],
    [/^trailer (id|uuid)$/, 'TRAILER'], [/^customer (id|uuid)$/, 'CUSTOMER'], [/^user (id|uuid)$/, 'USER'],
  ];
  return rules.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

export function auditQuickManageReportContent(reportType: QuickManageReportType, value: unknown): QuickManageFinancialAudit {
  const data = object(value);
  const content = object(data?.content);
  if (!data || !content || !Array.isArray(content.columns) || !Array.isArray(content.rows)) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned invalid financial report content.');
  if (content.columns.length > 200 || content.rows.length > 500) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage financial report exceeds the safe audit limit.');
  const columns = content.columns.map(parseColumn);
  const rows = content.rows.map((row) => {
    const parsed = object(row);
    if (!parsed) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid financial report row.');
    return parsed;
  });
  const summary = object(content.summary);
  const findings: QuickManageAuditFinding[] = [];
  const fingerprints = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const fingerprint = createHash('sha256').update(stable(Object.fromEntries(Object.entries(row).filter(([key]) => key !== '__key__')))).digest('hex');
    fingerprints.set(fingerprint, [...(fingerprints.get(fingerprint) ?? []), index]);
  });
  for (const indexes of fingerprints.values()) if (indexes.length > 1) findings.push({ severity: 'WARNING', code: 'DUPLICATE_ROW', message: 'QuickManage returned duplicate report rows.', rowIndexes: indexes });

  const relationshipColumns = columns.flatMap((column) => {
    const resource = relationshipResource(column.systemName ?? column.name);
    return resource ? [{ column: column.name, resource }] : [];
  });
  if (!relationshipColumns.length) findings.push({ severity: 'INFO', code: 'NO_CANONICAL_RELATIONSHIP_IDS', message: 'The report exposes no verified entity-ID columns; name/number-only matching is intentionally disabled.' });
  for (const column of relationshipColumns) {
    const definition = columns.find((entry) => entry.name === column.column)!;
    const missing = rows.map((row, index) => row[definition.cid] == null || row[definition.cid] === '' ? index : -1).filter((index) => index >= 0);
    if (missing.length) findings.push({ severity: 'WARNING', code: 'MISSING_RELATIONSHIP_ID', message: `Some rows have no ${column.column}.`, rowIndexes: missing, column: column.column });
  }
  const relationshipReferences = relationshipColumns.flatMap((relationship) => {
    const definition = columns.find((entry) => entry.name === relationship.column)!;
    const occurrences = new Map<string, number[]>();
    rows.forEach((row, index) => {
      const externalId = text(row[definition.cid]);
      if (externalId) occurrences.set(externalId, [...(occurrences.get(externalId) ?? []), index]);
    });
    return [...occurrences.entries()].map(([externalId, rowIndexes]) => ({ ...relationship, externalId, rowIndexes }));
  });

  for (const column of columns) {
    const normalized = (column.systemName ?? column.name).trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (!/^(transaction|report row|line item|adjustment|fuel transaction|toll transaction) (id|uuid)$/.test(normalized)) continue;
    const occurrences = new Map<string, number[]>();
    rows.forEach((row, index) => {
      const identifier = text(row[column.cid]);
      if (identifier) occurrences.set(identifier, [...(occurrences.get(identifier) ?? []), index]);
    });
    for (const indexes of occurrences.values()) if (indexes.length > 1) findings.push({ severity: 'ERROR', code: 'DUPLICATE_EXTERNAL_ID', message: `QuickManage returned duplicate ${column.name} values.`, rowIndexes: indexes, column: column.name });
  }

  const exactTotals: ExactColumnTotal[] = [];
  for (const column of columns) {
    const explicitMinor = column.unit === 'minor' || column.unit === 'minor_units';
    const explicitDecimal = column.decimalScale != null && ['money', 'decimal', 'currency'].includes(column.dataType ?? '');
    const explicitSum = column.aggregation?.toLowerCase() === 'sum';
    if ((!explicitMinor && !explicitDecimal) || !explicitSum) continue;
    const scale = explicitMinor ? 0 : column.decimalScale!;
    const values = rows.map((row) => row[column.cid]).filter((entry) => entry != null && entry !== '');
    const parsed = values.map((entry) => parseScaledDecimal(entry, scale));
    if (parsed.some((entry) => entry == null)) {
      findings.push({ severity: 'ERROR', code: 'INVALID_MONETARY_VALUE', message: `${column.name} contains a value incompatible with its explicit precision contract.`, column: column.name });
      continue;
    }
    if (column.signSemantics == null && parsed.some((entry) => entry != null && entry < BigInt(0))) {
      findings.push({ severity: 'WARNING', code: 'SIGN_SEMANTICS_UNVERIFIED', message: `${column.name} contains negative values but QuickManage supplied no debit/credit sign contract.`, column: column.name });
    }
    const calculatedMinor = parsed.reduce<bigint>((sum, entry) => sum + entry!, BigInt(0));
    const suppliedRaw = summaryValue(summary, column);
    const suppliedMinor = suppliedRaw == null ? null : parseScaledDecimal(suppliedRaw, scale);
    const calculated = formatScaled(calculatedMinor, scale);
    const supplied = suppliedMinor == null ? null : formatScaled(suppliedMinor, scale);
    const matches = suppliedMinor == null ? null : suppliedMinor === calculatedMinor;
    exactTotals.push({ column: column.name, currency: column.currency, scale, calculated, supplied, matches });
    if (suppliedRaw != null && suppliedMinor == null) findings.push({ severity: 'ERROR', code: 'INVALID_SUPPLIED_TOTAL', message: `QuickManage supplied an invalid ${column.name} total.`, column: column.name });
    else if (matches === false) findings.push({ severity: 'ERROR', code: 'TOTAL_MISMATCH', message: `QuickManage supplied total does not match the exact ${column.name} line sum.`, column: column.name });
  }
  if (!exactTotals.length) findings.push({ severity: 'WARNING', code: 'MONETARY_SEMANTICS_UNVERIFIED', message: 'QuickManage did not provide explicit currency/unit/precision metadata, so FleetPilot did not calculate a financial total.' });
  if (!summary) findings.push({ severity: 'INFO', code: 'NO_SUPPLIED_SUMMARY', message: 'QuickManage supplied no structured summary for independent comparison.' });

  const definition = QUICKMANAGE_FINANCIAL_REPORT_DEFINITIONS.find((entry) => entry.type === reportType)!;
  return { reportType, interpretation: definition.semantics, columns, rowCount: rows.length, suppliedSummaryPresent: Boolean(summary), exactTotals, relationshipColumns, relationshipReferences, findings };
}

export type QuickManageTripFinancialReportInterpretation = QuickManageFinancialAudit & {
  reportType: 'trip';
  interpretation: 'PARTIALLY_VERIFIED';
};
