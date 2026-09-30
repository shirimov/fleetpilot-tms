import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePilotTruckOwnerAt, resolveTruckOwnerAt, validateOwnerPeriods } from './truck-owner-resolution';

const periods = [
  { id: 'old-period', ownerPartyId: 'old-owner', companyId: 'carrier', providerRecipientId: 'old-recipient', effectiveFrom: '2026-01-01', effectiveTo: '2026-10-01' },
  { id: 'new-period', ownerPartyId: 'new-owner', companyId: 'carrier', providerRecipientId: 'new-recipient', effectiveFrom: '2026-10-01', effectiveTo: null },
];

test('ownership uses inclusive effective day and exclusive end, independent of posting order', () => {
  assert.deepEqual(resolveTruckOwnerAt(periods, '2026-09-30', 'carrier'), { status: 'EXACT', period: periods[0] });
  assert.deepEqual(resolveTruckOwnerAt([...periods].reverse(), '2026-10-01', 'carrier'), { status: 'EXACT', period: periods[1] });
});

test('missing, overlapping, hidden and timestamp-only evidence fails closed', () => {
  assert.equal(resolveTruckOwnerAt([], '2026-10-01', 'carrier').status, 'NO_CONFIRMED_OWNER');
  assert.equal(resolveTruckOwnerAt([periods[0]], '2026-10-01', 'carrier').status, 'NO_CONFIRMED_OWNER');
  assert.equal(resolveTruckOwnerAt([periods[1], periods[1]], '2026-10-01', 'carrier').status, 'OVERLAPPING_OWNER_HISTORY');
  assert.equal(resolveTruckOwnerAt(periods, '2026-10-01', 'hidden').status, 'OWNER_RECIPIENT_SCOPE_MISMATCH');
  for (const date of [null, '2026-10-01T00:00:00Z', '2026-02-30']) {
    assert.equal(resolveTruckOwnerAt(periods, date, 'carrier').status, 'NEEDS_BUSINESS_DATE');
  }
});

test('resolver rejects invalid durable owner identities instead of returning an exact owner', () => {
  assert.equal(resolveTruckOwnerAt([{ ...periods[1], ownerPartyId: '' }], '2026-10-01', 'carrier').status, 'INVALID_OWNER_HISTORY');
});

for (const format of ['LEGACY_XLS', 'PIPE_INVOICE']) {
  test(`${format} cannot choose an owner across an unresolved Sunday provider boundary`, () => {
    const sunday = [
      { ...periods[0], effectiveTo: '2026-09-20' },
      { ...periods[1], effectiveFrom: '2026-09-20' },
    ];
    assert.equal(resolvePilotTruckOwnerAt(sunday, '2026-09-20', format, 'carrier').status, 'NEEDS_BUSINESS_DATE');
    assert.equal(resolvePilotTruckOwnerAt([sunday[1]], '2026-09-20', format, 'carrier').status, 'NEEDS_BUSINESS_DATE');
    assert.equal(resolvePilotTruckOwnerAt([{ ...sunday[0], effectiveTo: null }], '2026-09-20', format, 'carrier').status, 'EXACT');
    // Same beneficial owner is not enough if its recipient binding changed.
    assert.equal(resolvePilotTruckOwnerAt([sunday[0], { ...sunday[1], ownerPartyId: sunday[0].ownerPartyId }], '2026-09-20', format, 'carrier').status, 'NEEDS_BUSINESS_DATE');
    assert.equal(resolvePilotTruckOwnerAt(periods, '2026-10-01', format, 'carrier').status, 'EXACT');
    assert.equal(resolvePilotTruckOwnerAt(periods, '2026-10-01T00:00:00Z', format, 'carrier').status, 'NEEDS_BUSINESS_DATE');
  });
}

test('portal and unknown formats do not supply an invented ownership purchase date', () => {
  for (const format of ['PORTAL_XLSX', 'UNKNOWN', '']) {
    assert.equal(resolvePilotTruckOwnerAt(periods, '2026-10-01', format, 'carrier').status, 'NEEDS_BUSINESS_DATE');
  }
});

test('same-owner namespace changes and gaps remain explicit calendar boundaries', () => {
  const changed = [periods[0], { ...periods[1], ownerPartyId: periods[0].ownerPartyId, companyId: 'next-carrier' }];
  assert.equal(resolveTruckOwnerAt(changed, '2026-10-01', 'next-carrier').status, 'EXACT');
  assert.equal(resolveTruckOwnerAt(changed, '2026-10-01', 'carrier').status, 'OWNER_RECIPIENT_SCOPE_MISMATCH');
  const gap = [{ ...periods[0], effectiveTo: '2026-09-01' }, periods[1]];
  assert.equal(validateOwnerPeriods(gap).length, 2);
  assert.equal(resolveTruckOwnerAt(gap, '2026-09-30', 'carrier').status, 'NO_CONFIRMED_OWNER');
});

test('history entry allows planned dates and gaps but rejects malformed or overlapping periods', () => {
  assert.deepEqual(validateOwnerPeriods(periods), periods);
  assert.throws(() => validateOwnerPeriods([periods[1], periods[1]]), /overlap/);
  assert.throws(() => validateOwnerPeriods([{ ...periods[0], effectiveTo: periods[0].effectiveFrom }]), /end/);
  assert.throws(() => validateOwnerPeriods([{ ...periods[0], ownerPartyId: '' }]), /required/);
});
