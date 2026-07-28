import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { DispatchConflictError, DispatchResourceNotFoundError } from './dispatch-errors';
import { DispatchService } from './dispatch-service';
import type { DispatchDocumentStorage } from './dispatch-storage';

class MemoryStorage implements DispatchDocumentStorage {
  values = new Map<string, Uint8Array>();
  sequence = 0;
  async put(bytes: Uint8Array) {
    const key = `00000000-0000-4000-8000-${String(++this.sequence).padStart(12, '0')}`;
    this.values.set(key, bytes);
    return key;
  }
  async get(key: string) {
    const value = this.values.get(key);
    if (!value) throw new Error('Missing');
    return value;
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const storage = new MemoryStorage();
const service = new DispatchService(prisma, storage);
let companyId = '';
let foreignCompanyId = '';
let userId = '';
let truckId = '';
let alternateTruckId = '';
let foreignTruckId = '';
let driverId = '';
let alternateDriverId = '';
let trailerId = '';
let alternateTrailerId = '';
let customerId = '';
let foreignCustomerId = '';
let actor: CompanyAuthorization;
const createdLoadIds: string[] = [];

before(async () => {
  const [company, foreignCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Dispatch ${suffix}` } }),
    prisma.company.create({ data: { name: `Foreign dispatch ${suffix}` } }),
  ]);
  companyId = company.id;
  foreignCompanyId = foreignCompany.id;
  const user = await prisma.user.create({
    data: {
      email: `dispatch-${suffix}@example.test`,
      displayName: 'Dispatch tester',
      activeCompanyId: companyId,
    },
  });
  userId = user.id;
  await prisma.companyMembership.create({
    data: { userId, companyId, role: 'ADMIN' },
  });
  actor = {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isActive: user.isActive,
      activeCompanyId: user.activeCompanyId,
    },
    companyId,
    role: 'ADMIN',
  };
  const [
    truck,
    alternateTruck,
    foreignTruck,
    driver,
    alternateDriver,
    trailer,
    alternateTrailer,
    customer,
    foreignCustomer,
  ] =
    await Promise.all([
      prisma.truck.create({
        data: { companyId, unitNumber: `D-${suffix}` },
      }),
      prisma.truck.create({
        data: { companyId, unitNumber: `DA-${suffix}` },
      }),
      prisma.truck.create({
        data: { companyId: foreignCompanyId, unitNumber: `FD-${suffix}` },
      }),
      prisma.driver.create({
        data: {
          companyId,
          firstName: 'Alpha',
          lastName: 'Driver',
          payRate: 25,
        },
      }),
      prisma.driver.create({
        data: {
          companyId,
          firstName: 'Alternate',
          lastName: 'Driver',
          payRate: 25,
        },
      }),
      prisma.trailer.create({
        data: { companyId, unitNumber: `TR-${suffix}` },
      }),
      prisma.trailer.create({
        data: { companyId, unitNumber: `TRA-${suffix}` },
      }),
      service.createCustomer(
        {
          name: `Alpha customer ${suffix}`,
          contacts: [{ name: 'Dock manager', email: 'dock@example.test' }],
        },
        actor,
      ),
      prisma.customer.create({
        data: { companyId: foreignCompanyId, name: `Foreign customer ${suffix}` },
      }),
    ]);
  truckId = truck.id;
  alternateTruckId = alternateTruck.id;
  foreignTruckId = foreignTruck.id;
  driverId = driver.id;
  alternateDriverId = alternateDriver.id;
  trailerId = trailer.id;
  alternateTrailerId = alternateTrailer.id;
  customerId = customer.id;
  foreignCustomerId = foreignCustomer.id;
});

after(async () => {
  await prisma.loadActivity.deleteMany({ where: { companyId } });
  await prisma.settlement.deleteMany({ where: { loadId: { in: createdLoadIds } } });
  await prisma.load.deleteMany({ where: { id: { in: createdLoadIds } } });
  await prisma.customer.deleteMany({
    where: { id: { in: [customerId, foreignCustomerId] } },
  });
  await prisma.trailer.deleteMany({
    where: { id: { in: [trailerId, alternateTrailerId] } },
  });
  await prisma.driver.deleteMany({
    where: { id: { in: [driverId, alternateDriverId] } },
  });
  await prisma.truck.deleteMany({
    where: { id: { in: [truckId, alternateTruckId, foreignTruckId] } },
  });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.company.deleteMany({
    where: { id: { in: [companyId, foreignCompanyId] } },
  });
  await prisma.$disconnect();
});

function loadInput(loadNumber: string, startHour = 8) {
  const hour = (value: number) => String(value).padStart(2, '0');
  return {
    loadNumber,
    status: 'DRAFT' as const,
    rate: 2500,
    customerId,
    truckId,
    driverId,
    trailerId,
    stops: [
      {
        type: 'DELIVERY' as const,
        order: 9,
        facilityName: 'Receiver',
        city: 'Dallas',
        state: 'TX',
        appointmentStart: new Date(`2026-08-02T${hour(startHour + 4)}:00:00.000Z`),
        appointmentEnd: new Date(`2026-08-02T${hour(startHour + 5)}:00:00.000Z`),
      },
      {
        type: 'PICKUP' as const,
        order: 4,
        facilityName: 'Shipper',
        city: 'Houston',
        state: 'TX',
        appointmentStart: new Date(`2026-08-02T${hour(startHour)}:00:00.000Z`),
        appointmentEnd: new Date(`2026-08-02T${hour(startHour + 1)}:00:00.000Z`),
      },
    ],
  };
}

test('customer contacts are company scoped and searchable', async () => {
  const results = await service.getCustomers(companyId, 'Dock');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, customerId);
  assert.equal(results[0].contacts[0].name, 'Dock manager');
  assert.equal((await service.getCustomers(foreignCompanyId, 'Dock')).length, 0);
});

test('load creation normalizes stop order and records verified activity', async () => {
  const load = await service.createLoad(loadInput(`ALPHA-${suffix}`), actor);
  createdLoadIds.push(load.id);
  assert.deepEqual(load.stops.map(({ order, type }) => [order, type]), [
    [0, 'PICKUP'],
    [1, 'DELIVERY'],
  ]);
  assert.equal(load.origin, 'Houston, TX');
  assert.equal(load.destination, 'Dallas, TX');
  const activity = await prisma.loadActivity.findFirstOrThrow({
    where: { loadId: load.id },
  });
  assert.equal(activity.action, 'LOAD_CREATED');
  assert.equal(activity.actorUserId, userId);
});

test('foreign customer and truck relationships remain non-enumerable', async () => {
  await assert.rejects(
    service.createLoad(
      { ...loadInput(`FOREIGN-CUSTOMER-${suffix}`), customerId: foreignCustomerId },
      actor,
    ),
    DispatchResourceNotFoundError,
  );
  await assert.rejects(
    service.createLoad(
      { ...loadInput(`FOREIGN-TRUCK-${suffix}`), truckId: foreignTruckId },
      actor,
    ),
    DispatchResourceNotFoundError,
  );
});

test('lifecycle transitions are ordered and assignment conflicts are rejected', async () => {
  const first = await service.createLoad(loadInput(`LIFE-${suffix}`), actor);
  createdLoadIds.push(first.id);
  await assert.rejects(
    service.transitionLoad(first.id, 'DISPATCHED', actor),
    /cannot move/,
  );
  await service.transitionLoad(first.id, 'PLANNED', actor);
  await service.transitionLoad(first.id, 'ASSIGNED', actor);

  const conflicting = await service.createLoad(
    loadInput(`CONFLICT-${suffix}`),
    actor,
  );
  createdLoadIds.push(conflicting.id);
  await service.transitionLoad(conflicting.id, 'PLANNED', actor);
  await assert.rejects(
    service.transitionLoad(conflicting.id, 'ASSIGNED', actor),
    DispatchConflictError,
  );
  const driverConflict = await service.createLoad(
    {
      ...loadInput(`DRIVER-CONFLICT-${suffix}`),
      truckId: alternateTruckId,
      trailerId: alternateTrailerId,
    },
    actor,
  );
  createdLoadIds.push(driverConflict.id);
  await service.transitionLoad(driverConflict.id, 'PLANNED', actor);
  await assert.rejects(
    service.transitionLoad(driverConflict.id, 'ASSIGNED', actor),
    /driver is already assigned/,
  );
  const trailerConflict = await service.createLoad(
    {
      ...loadInput(`TRAILER-CONFLICT-${suffix}`),
      truckId: alternateTruckId,
      driverId: alternateDriverId,
    },
    actor,
  );
  createdLoadIds.push(trailerConflict.id);
  await service.transitionLoad(trailerConflict.id, 'PLANNED', actor);
  await assert.rejects(
    service.transitionLoad(trailerConflict.id, 'ASSIGNED', actor),
    /trailer is already assigned/,
  );

  await service.transitionLoad(first.id, 'DISPATCHED', actor);
  await service.transitionLoad(first.id, 'PICKED_UP', actor);
  await service.transitionLoad(first.id, 'IN_TRANSIT', actor);
  await service.transitionLoad(first.id, 'DELIVERED', actor);
  await assert.rejects(
    service.transitionLoad(first.id, 'POD_UPLOADED', actor),
    /POD document/,
  );
  await service.addLoadDocument(
    first.id,
    {
      type: 'POD',
      originalFilename: 'pod.pdf',
      displayFilename: 'pod.pdf',
      mimeType: 'application/pdf',
      byteSize: 5,
    },
    new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    actor,
  );
  await service.transitionLoad(first.id, 'POD_UPLOADED', actor);
  const invoicedInput = {
    ...loadInput(first.loadNumber),
    status: 'POD_UPLOADED' as const,
    invoiceNumber: 'INV-100',
  };
  await service.updateLoad(first.id, invoicedInput, actor);
  await service.transitionLoad(first.id, 'INVOICED', actor);
  await prisma.settlement.create({
    data: {
      loadId: first.id,
      truckId,
      weekEnding: new Date('2026-08-08T00:00:00.000Z'),
      grossRevenue: 2500,
      driverPay: 500,
      netPay: 500,
      isPaid: true,
      paidAt: new Date(),
    },
  });
  const paid = await service.transitionLoad(first.id, 'PAID', actor);
  assert.equal(paid.status, 'PAID');
});
