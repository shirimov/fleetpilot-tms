import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOwnerHistoryChange, saveOwnerHistory, type OwnerHistorySnapshot } from './truck-owner-editor';

// Synthetic identities only; no live ownership records.
const options = { canManage: true, companies: [{ id: 'company-a', name: 'Synthetic carrier' }], owners: [{ id: 'party-a', name: 'Synthetic owner', companyId: null }], recipients: [{ companyId: 'company-a', id: 'recipient-a', name: 'Synthetic Contractor' }] };
const period = { companyId: 'company-a', ownerPartyId: 'party-a', providerRecipientId: 'recipient-a', effectiveFrom: '2026-06-01', effectiveTo: null };
test('full reviewed snapshot carries the loaded revision and explicit evidence, with no UI metadata', () => {
  const result = buildOwnerHistoryChange('revision-loaded', [{ ...period, id: 'old-period' }], ' Transfer evidence ', ' Confirm timeline ', options);
  assert.deepEqual(result, { expectedRevisionId: 'revision-loaded', periods: [period], sourceReference: 'Transfer evidence', reason: 'Confirm timeline' });
  assert.equal(buildOwnerHistoryChange(null, [period], 'source', 'reason', options).expectedRevisionId, null);
});

test('rejects unverified identity, cross-Company bindings, read-only access and blank audit evidence', () => {
  assert.throws(() => buildOwnerHistoryChange(null, [{ ...period, ownerPartyId: 'typed-fake-id' }], 'source', 'reason', options), /owner/i);
  assert.throws(() => buildOwnerHistoryChange(null, [period], 'source', 'reason', { ...options, owners: [{ ...options.owners[0], companyId: 'foreign-company' }] }), /owner/i);
  assert.throws(() => buildOwnerHistoryChange(null, [period], 'source', 'reason', { ...options, recipients: [{ ...options.recipients[0], companyId: 'foreign-company' }] }), /Contractor/i);
  assert.throws(() => buildOwnerHistoryChange(null, [period], 'source', 'reason', { ...options, canManage: false }), /read-only/i);
  assert.throws(() => buildOwnerHistoryChange(null, [period], ' ', 'reason', options), /evidence/i);
  assert.throws(() => buildOwnerHistoryChange(null, [period], 'source', 'x'.repeat(2001), options), /reason/i);
});

const change = () => buildOwnerHistoryChange('old-revision', [period], 'source', 'reason', options);
const snapshot = (): OwnerHistorySnapshot => ({ truckId: 'synthetic-truck', unitNumber: 'Synthetic', revisionId: 'new-revision', periods: [{ ...period, id: 'saved-period', ownerName: 'Synthetic owner', revisionId: 'new-revision', sourceReference: 'source', reason: 'reason', actorUserId: 'synthetic-actor', createdAt: '2026-06-01T00:00:00Z' }] });
test('save confirms only after exact target readback with matching timeline and audit provenance', async () => {
  const calls: [string, RequestInit | undefined][] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push([String(url), init]);
    return Response.json(init?.method === 'POST' ? { truckId: 'synthetic-truck', revisionId: 'new-revision' } : snapshot());
  };
  assert.deepEqual(await saveOwnerHistory('synthetic-truck', change(), transport), snapshot());
  assert.deepEqual(calls.map(([url, init]) => [url, init?.method ?? 'GET']), [['/api/trucks/synthetic-truck/owner-history', 'POST'], ['/api/trucks/synthetic-truck/owner-history', 'GET']]);
  assert.deepEqual(JSON.parse(String(calls[0][1]?.body)), change());
  assert.equal(calls[1][1]?.cache, 'no-store');
});
test('stale, denied, ambiguous network and mismatched readbacks never claim save confirmation', async () => {
  for (const status of [409, 403]) {
    let calls = 0;
    await assert.rejects(saveOwnerHistory('synthetic-truck', change(), async () => { calls++; return Response.json({ error: 'Reload required' }, { status }); }), /Reload required/);
    assert.equal(calls, 1);
  }
  for (const readback of [null, { ...snapshot(), revisionId: 'other-revision' }, { ...snapshot(), truckId: 'foreign' }, { ...snapshot(), periods: [] }, { ...snapshot(), periods: [{ ...snapshot().periods[0], reason: 'different' }] }, { ...snapshot(), periods: [{ ...snapshot().periods[0], effectiveFrom: '2026-07-01' }] }]) {
    await assert.rejects(saveOwnerHistory('synthetic-truck', change(), async (_url, init) => {
      if (init?.method === 'POST') return Response.json({ truckId: 'synthetic-truck', revisionId: 'new-revision' });
      if (!readback) throw new Error('Readback unavailable');
      return Response.json(readback);
    }), /readback|Readback/);
  }
});

test('calendar dates stay literal; gaps remain gaps and overlaps or timestamp dates fail', () => {
  const periods = [{ ...period, effectiveTo: '2026-06-10' }, { ...period, effectiveFrom: '2026-07-01' }];
  assert.deepEqual(buildOwnerHistoryChange('r', periods.reverse(), 's', 'r', options).periods, [...periods].reverse());
  for (const effectiveFrom of ['2026-02-30', '2026-06-01T12:00:00Z', '']) {
    assert.throws(() => buildOwnerHistoryChange('r', [{ ...period, effectiveFrom }], 's', 'r', options), /calendar date/i);
  }
  assert.throws(() => buildOwnerHistoryChange('r', [period, { ...period, effectiveFrom: '2026-07-01' }], 's', 'r', options), /overlap/i);
  assert.throws(() => buildOwnerHistoryChange('r', [], 's', 'r', options), /1–200/);
});
