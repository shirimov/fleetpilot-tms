import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
} from '@/lib/auth/auth-errors';
import {
  AuthorizationService,
  type TrustedSession,
} from '@/lib/auth/authorization';
import {
  FleetAuthorizationService,
  FleetResourceNotFoundError,
} from './fleet-authorization';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let activeSession: TrustedSession = null;
let memberUserId = '';
let adminUserId = '';
let inactiveUserId = '';
let nonMemberUserId = '';
let firstCompanyId = '';
let secondCompanyId = '';
let firstTruckId = '';
let secondTruckId = '';
let firstDriverId = '';
let secondDriverId = '';
let legacyDriverId = '';
let firstLoadId = '';
let secondLoadId = '';
let firstInspectionId = '';
let secondInspectionId = '';
let firstOrientationId = '';
let secondOrientationId = '';

const authorization = new AuthorizationService(prisma, async () => activeSession);
const fleetAuthorization = new FleetAuthorizationService(prisma, authorization);

before(async () => {
  const [firstCompany, secondCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Fleet auth first ${suffix}` } }),
    prisma.company.create({ data: { name: `Fleet auth second ${suffix}` } }),
  ]);
  firstCompanyId = firstCompany.id;
  secondCompanyId = secondCompany.id;

  const [member, admin, inactive, nonMember] = await Promise.all([
    prisma.user.create({
      data: {
        email: `fleet-member-${suffix}@example.test`,
        displayName: 'Fleet member',
        activeCompanyId: firstCompanyId,
      },
    }),
    prisma.user.create({
      data: {
        email: `fleet-admin-${suffix}@example.test`,
        displayName: 'Fleet admin',
        activeCompanyId: firstCompanyId,
      },
    }),
    prisma.user.create({
      data: {
        email: `fleet-inactive-${suffix}@example.test`,
        displayName: 'Fleet inactive',
        isActive: false,
      },
    }),
    prisma.user.create({
      data: {
        email: `fleet-non-member-${suffix}@example.test`,
        displayName: 'Fleet non-member',
      },
    }),
  ]);
  memberUserId = member.id;
  adminUserId = admin.id;
  inactiveUserId = inactive.id;
  nonMemberUserId = nonMember.id;

  await prisma.companyMembership.createMany({
    data: [
      {
        userId: memberUserId,
        companyId: firstCompanyId,
        role: 'MEMBER',
      },
      {
        userId: adminUserId,
        companyId: firstCompanyId,
        role: 'ADMIN',
      },
    ],
  });

  const [firstTruck, secondTruck] = await Promise.all([
    prisma.truck.create({
      data: {
        companyId: firstCompanyId,
        unitNumber: `fleet-auth-first-${suffix}`,
      },
    }),
    prisma.truck.create({
      data: {
        companyId: secondCompanyId,
        unitNumber: `fleet-auth-second-${suffix}`,
      },
    }),
  ]);
  firstTruckId = firstTruck.id;
  secondTruckId = secondTruck.id;

  const [firstDriver, secondDriver, legacyDriver] = await Promise.all([
    prisma.driver.create({
      data: {
        firstName: 'First',
        lastName: 'Driver',
        payRate: 0,
        companyId: firstCompanyId,
        truckId: firstTruckId,
      },
    }),
    prisma.driver.create({
      data: {
        firstName: 'Second',
        lastName: 'Driver',
        payRate: 0,
        companyId: secondCompanyId,
        truckId: secondTruckId,
      },
    }),
    prisma.driver.create({
      data: {
        firstName: 'Legacy',
        lastName: 'Driver',
        payRate: 0,
      },
    }),
  ]);
  firstDriverId = firstDriver.id;
  secondDriverId = secondDriver.id;
  legacyDriverId = legacyDriver.id;

  const [firstLoad, secondLoad] = await Promise.all([
    prisma.load.create({
      data: {
        loadNumber: `fleet-auth-first-load-${suffix}`,
        origin: 'First origin',
        destination: 'First destination',
        rate: 1000,
        truckId: firstTruckId,
        driverId: firstDriverId,
        companyId: firstCompanyId,
      },
    }),
    prisma.load.create({
      data: {
        loadNumber: `fleet-auth-second-load-${suffix}`,
        origin: 'Second origin',
        destination: 'Second destination',
        rate: 2000,
        truckId: secondTruckId,
        driverId: secondDriverId,
        companyId: secondCompanyId,
      },
    }),
  ]);
  firstLoadId = firstLoad.id;
  secondLoadId = secondLoad.id;

  const [firstInspection, secondInspection, firstOrientation, secondOrientation] =
    await Promise.all([
      prisma.truckInspection.create({
        data: {
          truckId: firstTruckId,
          inspectedBy: 'Inspector',
          phase1: {},
          phase2: {},
          phase3: {},
        },
      }),
      prisma.truckInspection.create({
        data: {
          truckId: secondTruckId,
          inspectedBy: 'Inspector',
          phase1: {},
          phase2: {},
          phase3: {},
        },
      }),
      prisma.driverOrientation.create({
        data: {
          driverId: firstDriverId,
          completedBy: 'Trainer',
          checklist: {},
          signature: 'signed',
        },
      }),
      prisma.driverOrientation.create({
        data: {
          driverId: secondDriverId,
          completedBy: 'Trainer',
          checklist: {},
          signature: 'signed',
        },
      }),
    ]);
  firstInspectionId = firstInspection.id;
  secondInspectionId = secondInspection.id;
  firstOrientationId = firstOrientation.id;
  secondOrientationId = secondOrientation.id;
});

after(async () => {
  await prisma.load.deleteMany({
    where: { id: { in: [firstLoadId, secondLoadId] } },
  });
  await prisma.driverOrientation.deleteMany({
    where: { id: { in: [firstOrientationId, secondOrientationId] } },
  });
  await prisma.truckInspection.deleteMany({
    where: { id: { in: [firstInspectionId, secondInspectionId] } },
  });
  await prisma.driver.deleteMany({
    where: { id: { in: [firstDriverId, secondDriverId, legacyDriverId] } },
  });
  await prisma.truck.deleteMany({
    where: { id: { in: [firstTruckId, secondTruckId] } },
  });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [memberUserId, adminUserId, inactiveUserId, nonMemberUserId],
      },
    },
  });
  await prisma.company.deleteMany({
    where: { id: { in: [firstCompanyId, secondCompanyId] } },
  });
  await prisma.$disconnect();
});

test('rejects unauthenticated, inactive, and non-member fleet requests', async () => {
  activeSession = null;
  await assert.rejects(
    fleetAuthorization.requireCompany(),
    AuthenticationRequiredError,
  );

  activeSession = { user: { id: inactiveUserId } };
  await assert.rejects(
    fleetAuthorization.requireCompany(),
    AuthenticationRequiredError,
  );

  activeSession = { user: { id: nonMemberUserId } };
  await assert.rejects(
    fleetAuthorization.requireCompany(),
    AuthorizationDeniedError,
  );
});

test('enforces admin mutations without trusting a selected company', async () => {
  activeSession = { user: { id: memberUserId } };
  await assert.rejects(
    fleetAuthorization.requireCompany('ADMIN'),
    AuthorizationDeniedError,
  );
  await assert.rejects(
    fleetAuthorization.requireTruck(firstTruckId, 'ADMIN'),
    AuthorizationDeniedError,
  );

  activeSession = { user: { id: adminUserId } };
  assert.equal(
    (await fleetAuthorization.requireTruck(firstTruckId, 'ADMIN')).companyId,
    firstCompanyId,
  );
  await assert.rejects(
    fleetAuthorization.requireTruck(secondTruckId, 'ADMIN'),
    FleetResourceNotFoundError,
  );
});

test('allows same-company indirect resources and hides foreign parents', async () => {
  activeSession = { user: { id: memberUserId } };

  assert.equal(
    (await fleetAuthorization.requireTruck(firstTruckId)).companyId,
    firstCompanyId,
  );
  assert.equal(
    (await fleetAuthorization.requireTruckInspection(firstInspectionId))
      .companyId,
    firstCompanyId,
  );
  assert.equal(
    (await fleetAuthorization.requireDriver(firstDriverId)).companyId,
    firstCompanyId,
  );
  assert.equal(
    (
      await fleetAuthorization.requireDriverOrientation(firstOrientationId)
    ).companyId,
    firstCompanyId,
  );
  assert.equal(
    (await fleetAuthorization.requireLoad(firstLoadId)).companyId,
    firstCompanyId,
  );

  for (const request of [
    () => fleetAuthorization.requireTruck(secondTruckId),
    () => fleetAuthorization.requireTruckInspection(secondInspectionId),
    () => fleetAuthorization.requireDriver(secondDriverId),
    () => fleetAuthorization.requireDriver(legacyDriverId),
    () => fleetAuthorization.requireDriverOrientation(secondOrientationId),
    () => fleetAuthorization.requireLoad(secondLoadId),
  ]) {
    await assert.rejects(request(), FleetResourceNotFoundError);
  }
});

test('foreign and nonexistent fleet IDs have identical not-found errors', async () => {
  activeSession = { user: { id: memberUserId } };

  for (const truckId of [secondTruckId, `missing-${suffix}`]) {
    await assert.rejects(
      fleetAuthorization.requireTruck(truckId),
      (error: unknown) =>
        error instanceof FleetResourceNotFoundError &&
        error.message === 'Not found',
    );
  }
});
