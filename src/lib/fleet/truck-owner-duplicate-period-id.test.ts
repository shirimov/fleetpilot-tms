import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOwnerHistoryChange, saveOwnerHistory } from './truck-owner-editor';

// Synthetic data only. TruckOwnerPeriod.id is a schema primary key.
test('two different reviewed periods cannot share one string audit row ID; distinct IDs confirm', async () => {
  const options = { canManage: true, companies: [{ id: 'company-a', name: 'Synthetic carrier' }], owners: [{ id: 'party-a', name: 'Synthetic owner', companyId: null }], recipients: [{ companyId: 'company-a', id: 'recipient-a', name: 'Synthetic Contractor' }] };
  const base = { companyId: 'company-a', ownerPartyId: 'party-a', providerRecipientId: 'recipient-a' };
  const change = buildOwnerHistoryChange('old-revision', [
    { ...base, effectiveFrom: '2026-06-01', effectiveTo: '2026-07-01' },
    { ...base, effectiveFrom: '2026-07-01', effectiveTo: null },
  ], 'synthetic-source', 'synthetic-reason', options);
  for (const ids of [['synthetic-duplicate-period', 'synthetic-duplicate-period'], ['a', 'b']]) {
    const calls: [string, string][] = [];
    const snapshot = { truckId: 'synthetic-truck', unitNumber: 'Synthetic', revisionId: 'new-revision', periods: change.periods.map((period, index) => ({ ...period, id: ids[index], ownerName: 'Synthetic owner', revisionId: 'new-revision', sourceReference: change.sourceReference, reason: change.reason, actorUserId: 'synthetic-actor', createdAt: '2026-06-01T00:00:00Z' })) };
    const transport: typeof fetch = async (url, init) => {
      const method = init?.method ?? 'GET';
      calls.push([String(url), method]);
      assert.equal(init?.cache, 'no-store');
      if (method === 'POST') assert.deepEqual(JSON.parse(String(init?.body)), change);
      return Response.json(method === 'POST' ? { truckId: 'synthetic-truck', revisionId: 'new-revision' } : snapshot);
    };
    try {
      if (ids[0] === ids[1]) await assert.rejects(saveOwnerHistory('synthetic-truck', change, transport), new Error('Save readback differs from the reviewed timeline. Reload and review; do not resubmit blindly.'));
      else assert.deepEqual(await saveOwnerHistory('synthetic-truck', change, transport), snapshot);
    } finally {
      assert.deepEqual(calls, [['/api/trucks/synthetic-truck/owner-history', 'POST'], ['/api/trucks/synthetic-truck/owner-history', 'GET']]);
    }
  }
});
