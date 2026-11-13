import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOwnerHistoryChange, saveOwnerHistory } from './truck-owner-editor';

// Explicitly synthetic transport data, not actual ownership records.
test('numeric owner-period id cannot confirm an otherwise matching save; no resubmit', async () => {
  const period = { companyId: 'synthetic-company', ownerPartyId: 'synthetic-owner', providerRecipientId: 'synthetic-recipient', effectiveFrom: '2026-06-01', effectiveTo: null };
  const change = buildOwnerHistoryChange('synthetic-old-revision', [period], 'synthetic-source', 'synthetic-reason', {
    canManage: true,
    companies: [{ id: period.companyId, name: 'Synthetic carrier' }],
    owners: [{ id: period.ownerPartyId, name: 'Synthetic owner', companyId: period.companyId }],
    recipients: [{ id: period.providerRecipientId, companyId: period.companyId, name: 'Synthetic Contractor' }],
  });
  const calls: [string, string][] = [];
  const transport: typeof fetch = async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push([String(url), method]);
    return Response.json(method === 'POST'
      ? { truckId: 'synthetic-truck', revisionId: 'synthetic-new-revision' }
      : { truckId: 'synthetic-truck', unitNumber: 'Synthetic', revisionId: 'synthetic-new-revision', periods: [{
        ...period, id: 42, ownerName: 'Synthetic owner', revisionId: 'synthetic-new-revision',
        sourceReference: change.sourceReference, reason: change.reason,
        actorUserId: 'synthetic-actor', createdAt: '2026-06-01T00:00:00Z',
      }] });
  };
  try {
    await assert.rejects(saveOwnerHistory('synthetic-truck', change, transport), {
      name: 'Error',
      message: 'Save readback differs from the reviewed timeline. Reload and review; do not resubmit blindly.',
    });
  } finally {
    assert.deepEqual(calls, [
      ['/api/trucks/synthetic-truck/owner-history', 'POST'],
      ['/api/trucks/synthetic-truck/owner-history', 'GET'],
    ]);
  }
});
