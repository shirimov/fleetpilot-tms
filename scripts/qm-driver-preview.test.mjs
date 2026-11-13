import test from 'node:test';
import assert from 'node:assert/strict';
import { preview } from './qm-driver-preview.mjs';
import { mkdtempSync, writeFileSync, readFileSync, statSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./qm-driver-preview-cli.mjs', import.meta.url));
test('CLI produces private actual preview, logs no PII, refuses overwrite and public input', () => {
  const dir = mkdtempSync('/home/hermes/.hermes/cache/scratch/qm-driver-synthetic-');
  chmodSync(dir, 0o700);
  const source = `${dir}/source.json`, mapping = `${dir}/mapping.json`, output = `${dir}/preview.json`;
  writeFileSync(source, JSON.stringify(input()), { mode: 0o600 });
  writeFileSync(mapping, JSON.stringify(mappings), { mode: 0o600 });
  const args = [cli, '--input', source, '--mapping', mapping, '--output', output];
  const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(run.status, 2, run.stderr);
  assert.equal(JSON.parse(run.stdout).uniqueDrivers, 1);
  assert.ok(!run.stdout.includes('Synthetic'));
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')).records[0].source, row());
  assert.equal(spawnSync(process.execPath, args).status, 1);
  chmodSync(source, 0o644);
  assert.equal(spawnSync(process.execPath, [...args.slice(0, -1), `${dir}/second.json`]).status, 1);
});

// Synthetic only; not a QM response contract or retrieved roster.
const row = () => ({ providerDriverId: 'synthetic-driver', providerCompanyId: 'synthetic-carrier', firstName: 'Synthetic', lastName: 'Fixture', phone: null, email: null, licenseNum: null, hireDate: null, lifecycle: { status: 'FORMER', terminationDate: null }, pay: { type: 'SALARY', amount: '123.4500', currency: null, frequency: 'WEEKLY', effectiveDate: null } });
const input = (rows = [row()]) => ({ version: 1, provider: 'QUICKMANAGE', accountKey: 'synthetic-account', operatingGroupId: 'synthetic-group', capturedAt: '2026-10-02T00:00:00Z', coverage: { complete: true, expectedUniqueDrivers: rows.length, evidenceSha256: 'a'.repeat(64) }, drivers: rows });
const mappings = [{ accountKey: 'synthetic-account', operatingGroupId: 'synthetic-group', providerCompanyId: 'synthetic-carrier', companyId: 'synthetic-company' }];

test('preview preserves typed pay, lifecycle and explicit unknowns without creating canonical defaults', () => {
  const source = input();
  const result = preview(source, mappings);
  assert.deepEqual(result.records[0].source, source.drivers[0]);
  assert.equal(result.records[0].companyId, 'synthetic-company');
  assert.equal(result.summary.insertable, 0);
  assert.equal(result.summary.uniqueDrivers, 1);
  assert.ok(result.records[0].blockers.includes('DRIVER_SOURCE_IDENTITY_MIGRATION_REQUIRED'));
  assert.ok(result.records[0].blockers.includes('DRIVER_LIFECYCLE_MIGRATION_REQUIRED'));
  assert.ok(result.records[0].blockers.includes('DRIVER_TYPED_COMPENSATION_MIGRATION_REQUIRED'));
  assert.equal(JSON.stringify(source), JSON.stringify(input()));
});

test('scoped identity deduplicates identical evidence but rejects conflicting versions', () => {
  const source = input([row(), row()]);
  source.coverage.expectedUniqueDrivers = 1;
  const result = preview(source, mappings);
  assert.equal(result.summary.uniqueDrivers, 1);
  assert.equal(result.summary.duplicateRows, 1);
  source.drivers[1].pay.amount = '200';
  assert.throws(() => preview(source, mappings), /CONFLICTING_SOURCE_IDENTITY/);
});

test('missing or ambiguous exact Company mapping blocks without name matching', () => {
  assert.ok(preview(input(), []).records[0].blockers.includes('COMPANY_MAPPING_UNRESOLVED'));
  assert.throws(() => preview(input(), [...mappings, { ...mappings[0], companyId: 'other' }]), /AMBIGUOUS_COMPANY_MAPPING/);
});

test('validates coverage, IDs and field allowlist without leaking rejected values', () => {
  const source = input();
  source.coverage.expectedUniqueDrivers = 2;
  assert.throws(() => preview(source, mappings), /COUNT_MISMATCH/);
  source.coverage.expectedUniqueDrivers = 1;
  source.drivers[0].providerDriverId = ' padded ';
  assert.throws(() => preview(source, mappings), /INVALID_IDENTIFIER/);
  source.drivers[0] = row();
  source.drivers[0].ssn = 'private-value';
  assert.throws(() => preview(source, mappings), error => error.message === 'UNAPPROVED_FIELD');
});

test('same names never merge different source identities; key order does not create conflicts', () => {
  const other = { ...row(), providerDriverId: 'second-synthetic-driver' };
  assert.equal(preview(input([row(), other]), mappings).summary.uniqueDrivers, 2);
  const reordered = Object.fromEntries(Object.entries(row()).reverse());
  const source = input([row(), reordered]);
  source.coverage.expectedUniqueDrivers = 1;
  assert.equal(preview(source, mappings).summary.duplicateRows, 1);
});

test('incomplete coverage is never represented as a complete roster', () => {
  const source = input();
  source.coverage.complete = false;
  const result = preview(source, mappings);
  assert.equal(result.summary.sourceComplete, false);
  assert.ok(result.records[0].blockers.includes('SOURCE_COVERAGE_INCOMPLETE'));
});
