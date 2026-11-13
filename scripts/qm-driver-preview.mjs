// Offline only: no DB, network, environment loading, or canonical writes.
import { isDeepStrictEqual } from 'node:util';

function requireValue(condition, code) {
  if (!condition) throw new Error(code);
}
function fields(value, allowed) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_OBJECT');
  requireValue(Object.keys(value).every(key => allowed.includes(key)), 'UNAPPROVED_FIELD');
  requireValue(allowed.every(key => Object.hasOwn(value, key)), 'MISSING_FIELD');
}
function identifier(value) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value), 'INVALID_IDENTIFIER');
}
function nullableText(value) {
  requireValue(value === null || (typeof value === 'string' && value.length <= 4096), 'INVALID_TEXT');
}

export function preview(envelope, mappings) {
  fields(envelope, ['version', 'provider', 'accountKey', 'operatingGroupId', 'capturedAt', 'coverage', 'drivers']);
  requireValue(envelope.version === 1 && envelope.provider === 'QUICKMANAGE', 'INVALID_FORMAT');
  identifier(envelope.accountKey);
  identifier(envelope.operatingGroupId);
  requireValue(typeof envelope.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(envelope.capturedAt) && Number.isFinite(Date.parse(envelope.capturedAt)), 'INVALID_CAPTURE_TIME');
  fields(envelope.coverage, ['complete', 'expectedUniqueDrivers', 'evidenceSha256']);
  requireValue(typeof envelope.coverage.complete === 'boolean', 'INVALID_COVERAGE');
  requireValue(envelope.coverage.expectedUniqueDrivers === null || (Number.isSafeInteger(envelope.coverage.expectedUniqueDrivers) && envelope.coverage.expectedUniqueDrivers >= 0), 'INVALID_COUNT');
  requireValue(typeof envelope.coverage.evidenceSha256 === 'string' && /^[a-f0-9]{64}$/.test(envelope.coverage.evidenceSha256), 'INVALID_EVIDENCE_HASH');
  requireValue(Array.isArray(envelope.drivers) && envelope.drivers.length <= 100000 && Array.isArray(mappings), 'INVALID_COLLECTION');
  const companies = new Map();
  for (const mapping of mappings) {
    fields(mapping, ['accountKey', 'operatingGroupId', 'providerCompanyId', 'companyId']);
    Object.values(mapping).forEach(identifier);
    const key = JSON.stringify([mapping.operatingGroupId, mapping.accountKey, mapping.providerCompanyId]);
    requireValue(!companies.has(key) || companies.get(key) === mapping.companyId, 'AMBIGUOUS_COMPANY_MAPPING');
    companies.set(key, mapping.companyId);
  }
  const identities = new Map();
  let duplicateRows = 0;
  for (const source of envelope.drivers) {
    fields(source, ['providerDriverId', 'providerCompanyId', 'firstName', 'lastName', 'phone', 'email', 'licenseNum', 'hireDate', 'lifecycle', 'pay']);
    identifier(source.providerDriverId);
    identifier(source.providerCompanyId);
    for (const field of ['firstName', 'lastName', 'phone', 'email', 'licenseNum', 'hireDate']) nullableText(source[field]);
    fields(source.lifecycle, ['status', 'terminationDate']);
    Object.values(source.lifecycle).forEach(nullableText);
    fields(source.pay, ['type', 'amount', 'currency', 'frequency', 'effectiveDate']);
    for (const field of ['type', 'currency', 'frequency', 'effectiveDate']) nullableText(source.pay[field]);
    requireValue(source.pay.amount === null || (typeof source.pay.amount === 'number' && Number.isFinite(source.pay.amount)) || (typeof source.pay.amount === 'string' && source.pay.amount.length <= 256), 'INVALID_PAY_AMOUNT');
    const key = JSON.stringify([envelope.operatingGroupId, envelope.accountKey, source.providerCompanyId, source.providerDriverId]);
    if (identities.has(key)) {
      requireValue(isDeepStrictEqual(identities.get(key), source), 'CONFLICTING_SOURCE_IDENTITY');
      duplicateRows++;
    } else identities.set(key, source);
  }
  const expected = envelope.coverage.expectedUniqueDrivers;
  requireValue(expected === null || (envelope.coverage.complete ? identities.size === expected : identities.size <= expected), 'COUNT_MISMATCH');
  const records = [...identities.values()].map(source => {
    const companyId = companies.get(JSON.stringify([envelope.operatingGroupId, envelope.accountKey, source.providerCompanyId])) ?? null;
    const blockers = ['DRIVER_SOURCE_IDENTITY_MIGRATION_REQUIRED', 'DRIVER_LIFECYCLE_MIGRATION_REQUIRED', 'DRIVER_TYPED_COMPENSATION_MIGRATION_REQUIRED'];
    if (!companyId) blockers.push('COMPANY_MAPPING_UNRESOLVED');
    if (!envelope.coverage.complete) blockers.push('SOURCE_COVERAGE_INCOMPLETE');
    if (!source.firstName || !source.lastName) blockers.push('CANONICAL_NAME_REQUIRED');
    return { source: structuredClone(source), companyId, blockers };
  });
  return {
    summary: { insertable: 0, sourceRows: envelope.drivers.length, uniqueDrivers: records.length, duplicateRows, sourceComplete: envelope.coverage.complete, unmappedDrivers: records.filter(record => !record.companyId).length },
    provenance: { ...structuredClone(envelope), drivers: undefined },
    records,
  };
}
