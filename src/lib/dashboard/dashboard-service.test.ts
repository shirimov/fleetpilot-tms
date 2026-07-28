import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { DashboardService } from './dashboard-service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let firstCompanyId = '';
let secondCompanyId = '';
let firstTruckId = '';
let secondTruckId = '';
let firstLoadId = '';
let secondLoadId = '';

before(async () => {
  const [firstCompany, secondCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Dashboard first ${suffix}` } }),
    prisma.company.create({ data: { name: `Dashboard second ${suffix}` } }),
  ]);
  firstCompanyId = firstCompany.id;
  secondCompanyId = secondCompany.id;

  const [firstTruck, secondTruck] = await Promise.all([
    prisma.truck.create({
      data: {
        companyId: firstCompanyId,
        unitNumber: `dash-first-${suffix}`,
        status: 'ACTIVE',
      },
    }),
    prisma.truck.create({
      data: {
        companyId: secondCompanyId,
        unitNumber: `dash-second-${suffix}`,
        status: 'ACTIVE',
      },
    }),
  ]);
  firstTruckId = firstTruck.id;
  secondTruckId = secondTruck.id;

  const [firstLoad, secondLoad] = await Promise.all([
    prisma.load.create({
      data: {
        companyId: firstCompanyId,
        truckId: firstTruckId,
        loadNumber: `dash-first-${suffix}`,
        origin: 'A',
        destination: 'B',
        rate: 1000,
        fuelSurcharge: 100,
      },
    }),
    prisma.load.create({
      data: {
        companyId: secondCompanyId,
        truckId: secondTruckId,
        loadNumber: `dash-second-${suffix}`,
        origin: 'C',
        destination: 'D',
        rate: 9000,
        fuelSurcharge: 900,
      },
    }),
  ]);
  firstLoadId = firstLoad.id;
  secondLoadId = secondLoad.id;

  await Promise.all([
    prisma.settlement.create({
      data: {
        truckId: firstTruckId,
        loadId: firstLoadId,
        weekEnding: new Date(),
        grossRevenue: 1100,
        driverPay: 0,
        netPay: 1100,
      },
    }),
    prisma.settlement.create({
      data: {
        truckId: secondTruckId,
        loadId: secondLoadId,
        weekEnding: new Date(),
        grossRevenue: 9900,
        driverPay: 0,
        netPay: 9900,
      },
    }),
  ]);
});

after(async () => {
  await prisma.settlement.deleteMany({
    where: { loadId: { in: [firstLoadId, secondLoadId] } },
  });
  await prisma.load.deleteMany({
    where: { id: { in: [firstLoadId, secondLoadId] } },
  });
  await prisma.truck.deleteMany({
    where: { id: { in: [firstTruckId, secondTruckId] } },
  });
  await prisma.company.deleteMany({
    where: { id: { in: [firstCompanyId, secondCompanyId] } },
  });
  await prisma.$disconnect();
});

test('isolates every dashboard aggregate and recent load by company', async () => {
  const snapshot = await new DashboardService(prisma).getSnapshot(
    firstCompanyId,
  );

  assert.equal(snapshot.activeTrucks, 1);
  assert.equal(snapshot.totalTrucks, 1);
  assert.equal(snapshot.loadsThisWeek, 1);
  assert.equal(snapshot.revenueThisWeek, 1100);
  assert.equal(snapshot.pendingSettlements, 1);
  assert.deepEqual(
    snapshot.recentLoads.map(({ id }) => id),
    [firstLoadId],
  );
  assert.ok(
    snapshot.recentLoads.every(
      ({ companyId }) => companyId === firstCompanyId,
    ),
  );
});
