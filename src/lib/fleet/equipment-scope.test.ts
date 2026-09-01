import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { AuthorizationService, type TrustedSession } from '@/lib/auth/authorization';
import { EquipmentScopeService } from './equipment-scope';
import { FleetAuthorizationService } from './fleet-authorization';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let activeSession: TrustedSession = null;
let adminUserId = '';
let memberUserId = '';
let activeCompanyId = '';
let unauthorizedCompanyId = '';
let authorizedCompanyIds: string[] = [];
let crossCompanyTruckId = '';
let crossCompanyTrailerId = '';

const authorization = new AuthorizationService(prisma, async () => activeSession);
const scopeService = new EquipmentScopeService(prisma, authorization);
const fleetAuthorization = new FleetAuthorizationService(prisma, authorization);

before(async () => {
  const companies = await Promise.all(
    ['Marybeg', 'Angels', 'Turner', 'Caribe', 'One Nine', 'Guven', 'Unauthorized'].map((name) =>
      prisma.company.create({ data: { name: `${name} equipment scope ${suffix}` } }),
    ),
  );
  authorizedCompanyIds = companies.slice(0, 6).map(({ id }) => id);
  activeCompanyId = authorizedCompanyIds[0];
  unauthorizedCompanyId = companies[6].id;
  const [admin, member] = await Promise.all([
    prisma.user.create({
      data: { email: `equipment-admin-${suffix}@example.test`, displayName: 'Equipment admin', activeCompanyId },
    }),
    prisma.user.create({
      data: { email: `equipment-member-${suffix}@example.test`, displayName: 'Equipment member', activeCompanyId },
    }),
  ]);
  adminUserId = admin.id;
  memberUserId = member.id;
  await prisma.companyMembership.createMany({
    data: [
      ...authorizedCompanyIds.map((companyId, index) => ({
        userId: adminUserId,
        companyId,
        role: index === 0 ? 'OWNER' as const : 'ADMIN' as const,
      })),
      { userId: memberUserId, companyId: activeCompanyId, role: 'MEMBER' },
    ],
  });

  const truckCounts = [1, 37, 15, 5];
  const truckRows = truckCounts.flatMap((count, companyIndex) =>
    Array.from({ length: count }, (_, index) => ({
      companyId: authorizedCompanyIds[companyIndex],
      unitNumber: companyIndex === 1 && index === 0 ? '0281' : `T-${companyIndex}-${index}-${suffix}`,
      status: companyIndex === 2 && index === 0 ? 'INACTIVE' as const : 'ACTIVE' as const,
    })),
  );
  const trailerCounts = [24, 8, 10];
  const trailerCompanyIndexes = [0, 4, 5];
  const trailerRows = trailerCounts.flatMap((count, distributionIndex) =>
    Array.from({ length: count }, (_, index) => ({
      companyId: authorizedCompanyIds[trailerCompanyIndexes[distributionIndex]],
      unitNumber: distributionIndex === 1 && index === 0 ? 'SM510414' : `R-${distributionIndex}-${index}-${suffix}`,
      vin: distributionIndex === 1 && index === 0 ? null : `VIN-${distributionIndex}-${index}-${suffix}`,
    })),
  );
  await prisma.truck.createMany({ data: truckRows });
  await prisma.trailer.createMany({ data: trailerRows });
  crossCompanyTruckId = (await prisma.truck.findFirstOrThrow({ where: { companyId: authorizedCompanyIds[1] }, select: { id: true } })).id;
  crossCompanyTrailerId = (await prisma.trailer.findFirstOrThrow({ where: { companyId: authorizedCompanyIds[4] }, select: { id: true } })).id;
});

after(async () => {
  await prisma.trailer.deleteMany({ where: { companyId: { in: [...authorizedCompanyIds, unauthorizedCompanyId] } } });
  await prisma.truck.deleteMany({ where: { companyId: { in: [...authorizedCompanyIds, unauthorizedCompanyId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, memberUserId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [...authorizedCompanyIds, unauthorizedCompanyId] } } });
  await prisma.$disconnect();
});

test('defaults to active company and aggregates only authorized companies', async () => {
  activeSession = { user: { id: adminUserId } };
  const active = await scopeService.resolve();
  assert.deepEqual(active.companyIds, [activeCompanyId]);
  assert.equal(active.selectedCompany, activeCompanyId);

  const aggregate = await scopeService.resolve('all');
  assert.deepEqual(new Set(aggregate.companyIds), new Set(authorizedCompanyIds));
  assert.equal(aggregate.companyIds.includes(unauthorizedCompanyId), false);
  assert.equal(aggregate.companies.length, 6);
  assert.ok(aggregate.companies.every(({ canManage }) => canManage));
});

test('rejects injected company IDs and MEMBER fleet aggregation', async () => {
  activeSession = { user: { id: adminUserId } };
  await assert.rejects(scopeService.resolve(unauthorizedCompanyId), AuthorizationDeniedError);
  activeSession = { user: { id: memberUserId } };
  await assert.rejects(scopeService.resolve('all'), AuthorizationDeniedError);
});

test('authorized aggregate yields exact fleet fixtures, filters, labels, and no duplicates', async () => {
  activeSession = { user: { id: adminUserId } };
  const scope = await scopeService.resolve('all');
  const trucks = await prisma.truck.findMany({
    where: { companyId: { in: scope.companyIds } },
    include: { company: { select: { name: true } } },
  });
  const trailers = await prisma.trailer.findMany({
    where: { companyId: { in: scope.companyIds } },
    include: { company: { select: { name: true } } },
  });
  assert.equal(trucks.length, 58);
  assert.equal(trailers.length, 42);
  assert.equal(new Set(trucks.map(({ id }) => id)).size, 58);
  assert.equal(new Set(trailers.map(({ id }) => id)).size, 42);
  assert.ok(trucks.every(({ company }) => company.name));
  assert.ok(trailers.every(({ company }) => company.name));
  assert.equal(trucks.filter(({ status }) => status !== 'INACTIVE').length, 57);
  assert.equal(trucks.filter(({ unitNumber }) => unitNumber.includes('0281')).length, 1);
  assert.equal(trailers.filter(({ unitNumber, vin }) => unitNumber.includes('SM510414') && !vin).length, 1);
  assert.deepEqual(
    authorizedCompanyIds.slice(0, 4).map((companyId) => trucks.filter((truck) => truck.companyId === companyId).length),
    [1, 37, 15, 5],
  );
  assert.deepEqual(
    [authorizedCompanyIds[0], authorizedCompanyIds[4], authorizedCompanyIds[5]].map((companyId) =>
      trailers.filter((trailer) => trailer.companyId === companyId).length,
    ),
    [24, 8, 10],
  );
});

test('individual authorized company scopes preserve exact equipment distribution', async () => {
  activeSession = { user: { id: adminUserId } };
  for (const [index, expected] of [1, 37, 15, 5, 0, 0].entries()) {
    const scope = await scopeService.resolve(authorizedCompanyIds[index]);
    assert.equal(await prisma.truck.count({ where: { companyId: { in: scope.companyIds } } }), expected);
  }
  for (const [index, expected] of [24, 0, 0, 0, 8, 10].entries()) {
    const scope = await scopeService.resolve(authorizedCompanyIds[index]);
    assert.equal(await prisma.trailer.count({ where: { companyId: { in: scope.companyIds } } }), expected);
  }
});

test('record mutations authorize the equipment actual company, not active company', async () => {
  activeSession = { user: { id: adminUserId } };
  assert.equal((await fleetAuthorization.requireTruck(crossCompanyTruckId, 'ADMIN')).companyId, authorizedCompanyIds[1]);
  assert.equal((await fleetAuthorization.requireTrailer(crossCompanyTrailerId, 'ADMIN')).companyId, authorizedCompanyIds[4]);
});
