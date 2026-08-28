import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import { QuickManageSyncService } from './quickmanage-sync-service';

const suffix = randomUUID().slice(0, 8);
let companyId = '';
let foreignCompanyId = '';
let userId = '';
const createdTruckIds: string[] = [];

const payloads: Record<string, unknown[]> = {
  '/x/trucks/search': [{ id: `qm-truck-${suffix}`, unit: `00${suffix}`, vin: null, plate_number: 'A1', make: 'Volvo', year: 2023, status: 'active', in_service_date: '2023-01-01T00:00:00Z' }],
  '/x/trailers/search': [{ id: `qm-trailer-${suffix}`, unit: 'T-001', vin: null, plate_number: 'B1', make: 'Utility', year: 2022, status: 'active', in_service_date: null }],
  '/x/drivers/search': [{ id: `qm-driver-${suffix}`, first_name: 'Ada', last_name: 'Driver', email: `ada-${suffix}@example.test`, status: 'active' }],
  '/x/customers/search': [{ id: `qm-customer-${suffix}`, name: `Customer ${suffix}`, mc_number: `MC-${suffix}`, type: 'broker', status: 'active' }],
};

const client = { request: async (path: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  const items = payloads[path] ?? [];
  return { 'error-fields': null, message: 'OK', data: { count: items.length, items, page: body.page, page_size: body.page_size } };
} };
const service = new QuickManageSyncService(prisma, client);

function context(): CompanyAuthorization {
  return { companyId, role: 'OWNER', user: { id: userId, email: `qm-sync-${suffix}@example.test`, displayName: 'QM Sync Owner', isActive: true, activeCompanyId: companyId } };
}

before(async () => {
  const [company, foreign] = await Promise.all([
    prisma.company.create({ data: { name: `QM Sync ${suffix}` } }),
    prisma.company.create({ data: { name: `QM Sync Foreign ${suffix}` } }),
  ]);
  companyId = company.id;
  foreignCompanyId = foreign.id;
  const user = await prisma.user.create({ data: { email: `qm-sync-${suffix}@example.test`, displayName: 'QM Sync Owner', activeCompanyId: companyId } });
  userId = user.id;
  await prisma.companyMembership.create({ data: { companyId, userId, role: 'OWNER' } });
});

after(async () => {
  await prisma.externalSyncRow.deleteMany({ where: { batch: { companyId } } });
  await prisma.externalSourceLink.deleteMany({ where: { companyId } });
  await prisma.externalSyncBatch.deleteMany({ where: { companyId } });
  await prisma.truck.deleteMany({ where: { id: { in: createdTruckIds } } });
  await prisma.truck.deleteMany({ where: { companyId } });
  await prisma.trailer.deleteMany({ where: { companyId } });
  await prisma.driver.deleteMany({ where: { companyId } });
  await prisma.customer.deleteMany({ where: { companyId } });
  await prisma.companyMembership.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
});

test('preview is non-canonical, apply is transactional, and repeat sync is idempotent', async () => {
  const beforeCounts = await Promise.all([
    prisma.truck.count({ where: { companyId } }),
    prisma.trailer.count({ where: { companyId } }),
    prisma.customer.count({ where: { companyId } }),
  ]);
  const preview = await service.preview(context());
  assert.deepEqual(await Promise.all([
    prisma.truck.count({ where: { companyId } }),
    prisma.trailer.count({ where: { companyId } }),
    prisma.customer.count({ where: { companyId } }),
  ]), beforeCounts);
  assert.equal(preview.newRows, 3);
  assert.equal(preview.invalidRows, 1);
  assert.equal(preview.rows.find((row) => row.resourceType === 'DRIVER')?.disposition, 'INVALID');

  const [applied, repeatedApply] = await Promise.all([service.apply(preview.id, context()), service.apply(preview.id, context())]);
  assert.equal(applied.status, 'APPLIED');
  assert.equal(repeatedApply.status, 'APPLIED');
  assert.equal(await prisma.externalSourceLink.count({ where: { companyId } }), 3);
  assert.equal(await prisma.truck.count({ where: { companyId, unitNumber: `00${suffix}` } }), 1);
  assert.equal(await prisma.trailer.count({ where: { companyId, unitNumber: 'T-001' } }), 1);
  assert.equal(await prisma.customer.count({ where: { companyId, name: `Customer ${suffix}` } }), 1);

  const repeatPreview = await service.preview(context());
  assert.equal(repeatPreview.unchangedRows, 3);
  assert.equal(repeatPreview.invalidRows, 1);
  await service.apply(repeatPreview.id, context());
  assert.equal(await prisma.externalSourceLink.count({ where: { companyId } }), 3);
});

test('conflicts, cross-company VINs, and existing records are never overwritten', async () => {
  const originalPayload = payloads['/x/trucks/search'];
  payloads['/x/trucks/search'] = [{ id: `qm-conflict-${suffix}`, unit: `CONFLICT-${suffix}`, vin: null, make: 'Source Make', year: 2021, status: 'active' }];
  const current = await prisma.truck.create({ data: {
    companyId,
    unitNumber: `CONFLICT-${suffix}`,
    unitNumberNormalized: `CONFLICT-${suffix}`,
    make: 'Different Make',
    year: 2021,
  } });
  createdTruckIds.push(current.id);
  const conflict = await service.preview(context());
  assert.equal(conflict.rows.find((row) => row.resourceType === 'TRUCK')?.disposition, 'CONFLICT');
  await service.apply(conflict.id, context());
  assert.equal((await prisma.truck.findUniqueOrThrow({ where: { id: current.id } })).make, 'Different Make');

  const legacyCrossCompanyVin = `ZZZZZZZZZZ${suffix.slice(0, 7).toUpperCase()}`;
  payloads['/x/trucks/search'] = [{ id: `qm-cross-company-${suffix}`, unit: `CROSS-${suffix}`, vin: legacyCrossCompanyVin, make: null, year: null, status: 'active' }];
  const foreign = await prisma.truck.create({ data: { companyId: foreignCompanyId, unitNumber: `FOREIGN-${suffix}`, vin: legacyCrossCompanyVin, vinNormalized: legacyCrossCompanyVin } });
  createdTruckIds.push(foreign.id);
  const crossCompany = await service.preview(context());
  assert.equal(crossCompany.rows.find((row) => row.resourceType === 'TRUCK')?.disposition, 'CONFLICT');
  assert.equal(await prisma.truck.count({ where: { companyId, unitNumber: `CROSS-${suffix}` } }), 0);
  payloads['/x/trucks/search'] = originalPayload;
});
