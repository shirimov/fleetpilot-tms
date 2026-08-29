import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import { QuickManageTripSyncService, QUICKMANAGE_TRIP_STATUS_MAP, quickManageMoneyToMinorUnits } from './quickmanage-trip-sync-service';

const suffix = randomUUID().slice(0, 8);
let companyId = '';
let foreignCompanyId = '';
let userId = '';
const externalId = `trip-${suffix}`;
const baseTrip = {
  id: externalId, trip_num: 8000, ref_number: `QM-REF-${suffix}`, po_number: null, other_number: null,
  customer_id: null, customer_name: null, remit_payment_to_name: null, shipment_type: 'Full', hauling_rate: 1234.56, accessorials_total: 12.34,
  status: 'delivered', created_at: '2026-08-29T10:00:00Z', schedule_date: '2026-08-29T00:00:00Z', delivery_date: '2026-08-30T00:00:00Z', booked_by: null, files: [],
  stops: [
    { id: `pickup-${suffix}`, pickup: true, rate: 600, accessorials_total: 12.34, distance: 10, deadhead: 1, company_name: 'Origin', address: { address_line_1: null, address_line_2: null, city: 'Chicago', state: 'IL', zip_code: '60601', country: 'US' }, appointment_date: '2026-08-29T08:00:00-05:00', assigned_truck: null, assigned_trailer: null, assigned_drivers: [], assigned_customer: null },
    { id: `delivery-${suffix}`, pickup: false, rate: 634.56, accessorials_total: 0, distance: 90, deadhead: 0, company_name: 'Destination', address: { address_line_1: null, address_line_2: null, city: 'Columbus', state: 'OH', zip_code: '43004', country: 'US' }, appointment_date: '2026-08-30T08:00:00-04:00', assigned_truck: null, assigned_trailer: null, assigned_drivers: [], assigned_customer: null },
  ],
};
let currentTrip: Record<string, unknown> = baseTrip;
const client = { request: async (_path: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  return { data: { count: 1, items: [currentTrip], page: body.page, page_size: body.page_size } };
} };
const service = new QuickManageTripSyncService(prisma, client);
const context = (): CompanyAuthorization => ({ companyId, role: 'OWNER', user: { id: userId, email: `trip-${suffix}@example.test`, displayName: 'Trip Owner', isActive: true, activeCompanyId: companyId } });

before(async () => {
  const [company, foreign] = await Promise.all([prisma.company.create({ data: { name: `Trip ${suffix}` } }), prisma.company.create({ data: { name: `Trip Foreign ${suffix}` } })]);
  companyId = company.id; foreignCompanyId = foreign.id;
  const user = await prisma.user.create({ data: { email: `trip-${suffix}@example.test`, displayName: 'Trip Owner', activeCompanyId: companyId } });
  userId = user.id;
  await prisma.companyMembership.create({ data: { companyId, userId, role: 'OWNER' } });
});

after(async () => {
  await prisma.externalSyncRow.deleteMany({ where: { batch: { companyId } } });
  await prisma.externalSyncBatch.deleteMany({ where: { companyId } });
  await prisma.externalSourceLink.deleteMany({ where: { companyId } });
  await prisma.loadActivity.deleteMany({ where: { companyId } });
  await prisma.loadStop.deleteMany({ where: { load: { companyId } } });
  await prisma.load.deleteMany({ where: { companyId } });
  await prisma.companyMembership.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
});

test('previews without canonical mutation, explicitly applies, and repeats idempotently', async () => {
  const beforeLoads = await prisma.load.count({ where: { companyId } });
  const preview = await service.preview(context());
  assert.equal(preview.newRows, 1);
  assert.equal(await prisma.load.count({ where: { companyId } }), beforeLoads);
  const [first, duplicate] = await Promise.all([service.apply(preview.id, context()), service.apply(preview.id, context())]);
  assert.equal(first.status, 'APPLIED'); assert.equal(duplicate.status, 'APPLIED');
  const load = await prisma.load.findFirstOrThrow({ where: { companyId, referenceNum: baseTrip.ref_number }, include: { stops: true, activities: true } });
  assert.equal(load.rate, 1234.56); assert.equal(load.status, 'DELIVERED'); assert.equal(load.stops.length, 2); assert.equal(load.activities.length, 1);
  assert.equal(await prisma.externalSourceLink.count({ where: { companyId, resourceType: 'TRIP', loadId: load.id } }), 1);
  assert.equal(await prisma.financialTransaction.count({ where: { companyId } }), 0);
  const repeat = await service.preview(context());
  assert.equal(repeat.unchangedRows, 1);
});

test('unresolved assignments fail closed and company-scoped previews cannot be read cross-tenant', async () => {
  currentTrip = { ...baseTrip, id: `unresolved-${suffix}`, ref_number: `UNRESOLVED-${suffix}`, stops: baseTrip.stops.map((stop, index) => index ? stop : { ...stop, assigned_driver: null, assigned_drivers: [{ id: `missing-driver-${suffix}`, first_name: 'Redacted', last_name: 'Redacted' }] }) };
  const preview = await service.preview(context());
  assert.equal(preview.invalidRows, 1);
  assert.match(preview.rows[0].message ?? '', /unsynchronized QuickManage driver/);
  await assert.rejects(service.get(preview.id, { ...context(), companyId: foreignCompanyId }), /not found/);
  currentTrip = baseTrip;
});

test('status and exact-money mapping are explicit and reject sub-cent values', () => {
  assert.deepEqual(QUICKMANAGE_TRIP_STATUS_MAP, { upcoming: 'PLANNED', dispatched: 'DISPATCHED', in_transit: 'IN_TRANSIT', canceled: 'CANCELLED', rejected: 'CANCELLED', delivered: 'DELIVERED' });
  assert.equal(quickManageMoneyToMinorUnits(12.34, 'money'), 1234);
  assert.throws(() => quickManageMoneyToMinorUnits(1.001, 'money'), /sub-cent/);
});
