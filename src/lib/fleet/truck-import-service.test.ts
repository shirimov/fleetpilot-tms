import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { TruckImportService, normalizeUnitNumber } from './truck-import-service';
import { TruckLifecycleService } from './truck-lifecycle-service';

const suffix = randomUUID().slice(0, 8);
const service = new TruckImportService(prisma);
const lifecycleService = new TruckLifecycleService(prisma);
let companyId = ''; let foreignCompanyId = ''; let userId = '';
const batchIds: string[] = []; const truckIds: string[] = [];

function context(): CompanyAuthorization {
  return { companyId, role: 'OWNER', user: { id: userId, email: `truck-import-${suffix}@example.com`, displayName: 'Truck Import Owner', isActive: true, activeCompanyId: companyId } };
}
function csv(lines: string[], name = `trucks-${suffix}.csv`) {
  return new File([lines.join('\n')], name, { type: 'text/csv' });
}

before(async () => {
  const [company, foreignCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Truck Import ${suffix}` } }),
    prisma.company.create({ data: { name: `Truck Import Foreign ${suffix}` } }),
  ]);
  companyId = company.id; foreignCompanyId = foreignCompany.id;
  const user = await prisma.user.create({ data: { email: `truck-import-${suffix}@example.com`, displayName: 'Truck Import Owner', activeCompanyId: companyId } });
  userId = user.id;
  await prisma.companyMembership.create({ data: { companyId, userId, role: 'OWNER' } });
});

after(async () => {
  await prisma.load.deleteMany({ where: { companyId } });
  await prisma.truckLifecycleEvent.deleteMany({ where: { companyId } });
  await prisma.truckImportRow.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.truckImportBatch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.truck.deleteMany({ where: { id: { in: truckIds } } });
  await prisma.companyMembership.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
});

test('previews and commits valid trucks while preserving leading-zero unit numbers', async () => {
  const preview = await service.preview(csv([
    'Unit Number,VIN,Status,Year,Make,Model',
    '0037,1HGCM82633A004352,ACTIVE,2023,Freightliner,Cascadia',
    '125,,MAINTENANCE,2021,Volvo,VNL',
  ], `valid-${suffix}.csv`), context());
  batchIds.push(preview.id);
  assert.deepEqual([preview.newRows, preview.matchedRows, preview.conflictRows, preview.rejectedRows], [2, 0, 0, 0]);
  const committed = await service.commit(preview.id, context());
  assert.equal(committed.status, 'COMMITTED');
  const trucks = await prisma.truck.findMany({ where: { companyId, unitNumberNormalized: { in: ['0037', '125'] } }, orderBy: { unitNumber: 'asc' } });
  truckIds.push(...trucks.map(({ id }) => id));
  assert.equal(trucks[0].unitNumber, '0037');
  assert.equal(trucks[0].unitNumberNormalized, normalizeUnitNumber('0037'));
  assert.equal(trucks.length, 2);
});

test('rejects duplicate identifiers and malformed rows before commit', async () => {
  const preview = await service.preview(csv([
    'Unit Number,VIN,Status,Year',
    '0099,1M8GDM9AXKP042788,ACTIVE,2022',
    ' 0099 ,1M8GDM9AXKP042788,BROKEN,not-a-year',
    ',INVALIDVIN,ACTIVE,2020',
  ], `invalid-${suffix}.csv`), context());
  batchIds.push(preview.id);
  assert.equal(preview.rejectedRows, 2);
  assert.equal(preview.conflictRows + preview.rejectedRows > 0, true);
  await assert.rejects(service.commit(preview.id, context()), /Resolve or remove/);
  assert.equal(await prisma.truck.count({ where: { companyId, unitNumberNormalized: '0099' } }), 0);
});

test('repeat upload and commit are idempotent and never overwrite an existing truck', async () => {
  const existing = await prisma.truck.create({ data: { companyId, unitNumber: `EX-${suffix}`, unitNumberNormalized: `EX-${suffix}`.toUpperCase(), status: 'ACTIVE', make: 'Volvo' } });
  truckIds.push(existing.id);
  const file = csv(['Unit Number,Status,Make', `${existing.unitNumber},ACTIVE,Volvo`], `repeat-${suffix}.csv`);
  const first = await service.preview(file, context()); batchIds.push(first.id);
  const second = await service.preview(file, context());
  assert.equal(second.id, first.id); assert.equal(first.matchedRows, 1); assert.equal(first.newRows, 0);
  await service.commit(first.id, context()); await service.commit(first.id, context());
  assert.equal(await prisma.truck.count({ where: { id: existing.id } }), 1);
  assert.equal((await prisma.truck.findUnique({ where: { id: existing.id } }))?.make, 'Volvo');

  const conflict = await service.preview(csv(['Unit Number,Status,Make', `${existing.unitNumber},ACTIVE,Kenworth`], `conflict-${suffix}.csv`), context());
  batchIds.push(conflict.id); assert.equal(conflict.conflictRows, 1);
  await assert.rejects(service.commit(conflict.id, context()), /Resolve or remove/);
  assert.equal((await prisma.truck.findUnique({ where: { id: existing.id } }))?.make, 'Volvo');
});

test('cross-company VIN is rejected without exposing or linking the foreign truck', async () => {
  const foreign = await prisma.truck.create({ data: { companyId: foreignCompanyId, unitNumber: `FOREIGN-${suffix}`, unitNumberNormalized: `FOREIGN-${suffix}`.toUpperCase(), vin: '1M8GDM9AXKP042788', vinNormalized: '1M8GDM9AXKP042788' } });
  truckIds.push(foreign.id);
  const preview = await service.preview(csv(['Unit Number,VIN', `LOCAL-${suffix},1M8GDM9AXKP042788`], `foreign-${suffix}.csv`), context());
  batchIds.push(preview.id); assert.equal(preview.rejectedRows, 1);
  assert.equal(preview.rows[0].existingTruckId, null);
  await assert.rejects(service.commit(preview.id, context()));
});

test('late commit failure rolls back all truck creation and batch state', async () => {
  const preview = await service.preview(csv(['Unit Number', `ROLLBACK-A-${suffix}`, `ROLLBACK-B-${suffix}`], `rollback-${suffix}.csv`), context());
  batchIds.push(preview.id);
  const functionName = `reject_truck_import_${suffix}`.replace(/-/g, '_');
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late failure'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${functionName} BEFORE UPDATE ON "TruckImportBatch" FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
  try { await assert.rejects(service.commit(preview.id, context()), /late failure/); }
  finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${functionName} ON "TruckImportBatch"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${functionName}()`);
  }
  assert.equal(await prisma.truck.count({ where: { companyId, unitNumberNormalized: { startsWith: 'ROLLBACK-' } } }), 0);
  assert.equal((await prisma.truckImportBatch.findUnique({ where: { id: preview.id } }))?.status, 'PREVIEWED');
});

test('deactivation and reactivation preserve legacy VIN and historical relationships', async () => {
  const legacyVin = '1HGCM82633A004353';
  const truck = await prisma.truck.create({ data: { companyId, unitNumber: `6009-${suffix}`, vin: legacyVin, status: 'MAINTENANCE' } });
  truckIds.push(truck.id);
  const load = await prisma.load.create({ data: { companyId, loadNumber: `legacy-${suffix}`, origin: 'A', destination: 'B', rate: 100, truckId: truck.id } });
  const deactivated = await lifecycleService.changeStatus(truck.id, 'INACTIVE', context());
  assert.equal(deactivated.id, truck.id); assert.equal(deactivated.vin, legacyVin); assert.equal(deactivated.status, 'INACTIVE');
  assert.equal((await prisma.load.findUnique({ where: { id: load.id } }))?.truckId, truck.id);
  await assert.rejects(lifecycleService.deleteUnused(truck.id, context()), /protected history/);
  const reactivated = await lifecycleService.changeStatus(truck.id, 'ACTIVE', context());
  assert.equal(reactivated.id, truck.id); assert.equal(reactivated.vin, legacyVin); assert.equal(reactivated.status, 'ACTIVE');
  assert.equal(await prisma.truckLifecycleEvent.count({ where: { truckReference: truck.id, action: { in: ['TRUCK_DEACTIVATED', 'TRUCK_REACTIVATED'] } } }), 2);
  await prisma.load.delete({ where: { id: load.id } });
});

test('only a dependency-free erroneous Truck can be permanently deleted with durable audit', async () => {
  const truck = await prisma.truck.create({ data: { companyId, unitNumber: `ERR-${suffix}` } });
  await lifecycleService.deleteUnused(truck.id, context());
  assert.equal(await prisma.truck.count({ where: { id: truck.id } }), 0);
  assert.equal(await prisma.truckLifecycleEvent.count({ where: { truckReference: truck.id, action: 'TRUCK_DELETED' } }), 1);
});
