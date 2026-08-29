import assert from 'node:assert/strict';
import test from 'node:test';
import { QuickManageError } from './quickmanage-client';
import { fetchQuickManageTrips } from './quickmanage-trip-contract';

const trip = {
  id: '52041c16-cb42-4fc4-91af-2009a8a10fe0', trip_num: 119, ref_number: 'REF-119', po_number: null, other_number: null,
  customer_id: null, customer_name: 'Redacted', remit_payment_to_name: null, shipment_type: 'Full', hauling_rate: 2000, accessorials_total: 10.25,
  status: 'delivered', created_at: '2026-08-29T10:00:00Z', schedule_date: '2026-08-29T00:00:00Z', delivery_date: '2026-08-30T00:00:00Z', booked_by: null, files: [],
  stops: [
    { id: 'stop-1', pickup: true, rate: 1000, accessorials_total: 10.25, distance: 10, deadhead: 0, company_name: 'Origin', address: { address_line_1: 'Redacted', address_line_2: null, city: 'A', state: 'IL', zip_code: '1', country: 'US' }, appointment_date: '2026-08-29T08:00:00-05:00', assigned_truck: null, assigned_trailer: null, assigned_drivers: null, assigned_customer: null },
    { id: 'stop-2', pickup: false, rate: 1000, accessorials_total: 0, distance: 100, deadhead: 0, company_name: 'Destination', address: { address_line_1: null, address_line_2: null, city: 'B', state: 'OH', zip_code: '2', country: 'US' }, appointment_date: '2026-08-30T08:00:00-04:00', assigned_truck: null, assigned_trailer: null, assigned_drivers: [], assigned_customer: null },
  ],
};

test('normalizes the documented Trip search response and preserves timezone offsets', async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const client = { request: async (path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); calls.push({ path, body });
    return { data: { count: 1, items: [trip], page: body.page, page_size: body.page_size } };
  } };
  const result = await fetchQuickManageTrips(client);
  assert.equal(result.length, 1);
  assert.equal(result[0].stops[0].appointment_date, '2026-08-29T08:00:00-05:00');
  assert.equal(result[0].stops[0].assigned_drivers.length, 0);
  assert.deepEqual(calls, [{ path: '/x/trips/search', body: { query: '', filters: [], page: 0, page_size: 100 } }]);
});

test('deduplicates provider pagination and fails closed on repeated or malformed records', async () => {
  let page = 0;
  const duplicate = { request: async () => ({ data: { count: 2, items: [trip], page: page++, page_size: 100 } }) };
  await assert.rejects(fetchQuickManageTrips(duplicate), (error: unknown) => error instanceof QuickManageError && error.code === 'MALFORMED_RESPONSE');
  await assert.rejects(fetchQuickManageTrips({ request: async () => ({ data: { count: 1, items: [{ ...trip, status: 'unknown' }], page: 0, page_size: 100 } }) }), QuickManageError);
});
