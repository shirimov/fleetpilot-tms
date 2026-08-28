import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchQuickManageFleetSnapshot } from './quickmanage-fleet-contract';
import { QuickManageError } from './quickmanage-client';

function envelope(items: unknown[], count = items.length, page = 0, pageSize = 100) {
  return { 'error-fields': null, message: 'OK', data: { count, items, page, page_size: pageSize } };
}

test('uses only documented fleet search endpoints and parses their narrow schemas', async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const client = { request: async (path: string, init?: RequestInit) => {
    calls.push({ path, body: JSON.parse(String(init?.body)) });
    if (path.includes('trucks')) return envelope([{ id: 'truck-1', unit: '0037', vin: '1HGCM82633A004352', plate_number: 'A1', make: 'Volvo', year: 2023, status: 'active', in_service_date: '2023-01-01T00:00:00Z' }]);
    if (path.includes('trailers')) return envelope([{ id: 'trailer-1', unit: 'T-1', vin: null, plate_number: 'B1', make: 'Utility', year: 2022, status: 'unassigned', in_service_date: null }]);
    if (path.includes('drivers')) return envelope([{ id: 'driver-1', first_name: 'Ada', last_name: 'Driver', email: 'ADA@example.test', phone: '1', number: 7, role: 'Company Driver', status: 'active' }]);
    return envelope([{ id: 'customer-1', name: 'Customer', mc_number: '123', type: 'broker', status: 'active' }]);
  } };
  const snapshot = await fetchQuickManageFleetSnapshot(client);
  assert.equal(snapshot.trucks[0].unit, '0037');
  assert.equal(snapshot.drivers[0].email, 'ADA@example.test');
  assert.equal(snapshot.customers[0].mcNumber, '123');
  assert.deepEqual(calls.map(({ path }) => path).sort(), ['/x/customers/search', '/x/drivers/search', '/x/trailers/search', '/x/trucks/search']);
  assert.ok(calls.every(({ body }) => body.page === 0 && body.page_size === 100 && Array.isArray(body.filters)));
});

test('paginates with a bounded page count and rejects malformed provider payloads', async () => {
  let truckCalls = 0;
  const client = { request: async (path: string, init?: RequestInit) => {
    const page = JSON.parse(String(init?.body)).page;
    if (!path.includes('trucks')) return envelope([]);
    truckCalls += 1;
    return envelope([{ id: `truck-${page}`, unit: String(page) }], 2, page, 100);
  } };
  const snapshot = await fetchQuickManageFleetSnapshot(client);
  assert.equal(snapshot.trucks.length, 2);
  assert.equal(truckCalls, 2);

  await assert.rejects(fetchQuickManageFleetSnapshot({ request: async () => ({ data: { items: [] } }) }), (error: unknown) =>
    error instanceof QuickManageError && error.code === 'MALFORMED_RESPONSE');
});
