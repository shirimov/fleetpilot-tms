import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import {
  WorkforceProfileService,
  WorkforceValidationError,
} from './workforce-profile-service';
import { WorkforceResourceNotFoundError } from './workforce-authorization';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const service = new WorkforceProfileService(prisma);
let companyId = '';
let foreignCompanyId = '';
let ownerId = '';
let adminId = '';
let memberId = '';
let secondMemberId = '';
let foreignUserId = '';

function context(userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER', tenant = companyId): CompanyAuthorization {
  return {
    companyId: tenant,
    role,
    user: {
      id: userId,
      email: `${userId}@test.dev`,
      displayName: role,
      isActive: true,
      activeCompanyId: tenant,
    },
  };
}

before(async () => {
  const [company, foreignCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Onboarding ${suffix}` } }),
    prisma.company.create({ data: { name: `Onboarding foreign ${suffix}` } }),
  ]);
  companyId = company.id;
  foreignCompanyId = foreignCompany.id;
  const [owner, admin, member, secondMember, foreignUser] = await Promise.all([
    prisma.user.create({ data: { email: `onboarding-owner-${suffix}@test.dev`, displayName: 'Owner', activeCompanyId: companyId } }),
    prisma.user.create({ data: { email: `onboarding-admin-${suffix}@test.dev`, displayName: 'Admin', activeCompanyId: companyId } }),
    prisma.user.create({ data: { email: `onboarding-member-${suffix}@test.dev`, displayName: 'Member', activeCompanyId: companyId } }),
    prisma.user.create({ data: { email: `onboarding-second-${suffix}@test.dev`, displayName: 'Second', activeCompanyId: companyId } }),
    prisma.user.create({ data: { email: `onboarding-foreign-${suffix}@test.dev`, displayName: 'Foreign', activeCompanyId: foreignCompanyId } }),
  ]);
  ownerId = owner.id;
  adminId = admin.id;
  memberId = member.id;
  secondMemberId = secondMember.id;
  foreignUserId = foreignUser.id;
  await prisma.companyMembership.createMany({ data: [
    { companyId, userId: ownerId, role: 'OWNER' },
    { companyId, userId: adminId, role: 'ADMIN' },
    { companyId, userId: memberId, role: 'MEMBER' },
    { companyId, userId: secondMemberId, role: 'MEMBER' },
    { companyId: foreignCompanyId, userId: foreignUserId, role: 'MEMBER' },
  ] });
});

after(async () => {
  await prisma.employee.deleteMany({
    where: { companyId: { in: [companyId, foreignCompanyId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ownerId, adminId, memberId, secondMemberId, foreignUserId] } },
  });
  await prisma.company.deleteMany({
    where: { id: { in: [companyId, foreignCompanyId] } },
  });
  await prisma.$disconnect();
});

test('OWNER creates and atomically links a profile to the existing User', async () => {
  const employee = await service.createForUser(context(ownerId, 'OWNER'), memberId, {
    firstName: 'Maya',
    lastName: 'Member',
    preferredName: 'Maya',
    jobTitle: 'Dispatcher',
    department: 'Operations',
    timezone: 'America/Chicago',
    salary: 65000,
  });
  assert.equal(employee.companyId, companyId);
  assert.equal(employee.userId, memberId);
  assert.equal(employee.email, `onboarding-member-${suffix}@test.dev`);
  const matchingUsers = await prisma.user.findMany({
    where: { email: `onboarding-member-${suffix}@test.dev` },
    select: { id: true },
  });
  assert.deepEqual(matchingUsers, [{ id: memberId }]);
  assert.equal(
    (await prisma.employee.findUnique({ where: { userId: memberId } }))?.id,
    employee.id,
  );
});

test('duplicate profile and already-linked User are rejected', async () => {
  await assert.rejects(
    service.createForUser(context(ownerId, 'OWNER'), memberId, {
      firstName: 'Duplicate', lastName: 'Member',
    }),
    WorkforceValidationError,
  );
  const unlinked = await prisma.employee.create({
    data: { companyId, firstName: 'Unused', lastName: 'Profile' },
  });
  await assert.rejects(
    service.linkUser(context(ownerId, 'OWNER'), unlinked.id, memberId),
    WorkforceValidationError,
  );
});

test('ADMIN is allowed and MEMBER is denied profile creation', async () => {
  const adminCreated = await service.createForUser(
    context(adminId, 'ADMIN'),
    secondMemberId,
    { firstName: 'Second', lastName: 'Member' },
  );
  assert.equal(adminCreated.userId, secondMemberId);
  await assert.rejects(
    service.createForUser(context(memberId, 'MEMBER'), ownerId, {
      firstName: 'Denied', lastName: 'Member',
    }),
    AuthorizationDeniedError,
  );
});

test('cross-company User, manager, and Employee links are rejected', async () => {
  await assert.rejects(
    service.createForUser(context(ownerId, 'OWNER'), foreignUserId, {
      firstName: 'Foreign', lastName: 'User',
    }),
    WorkforceValidationError,
  );
  const foreignEmployee = await prisma.employee.create({
    data: { companyId: foreignCompanyId, firstName: 'Foreign', lastName: 'Employee' },
  });
  await assert.rejects(
    service.linkUser(context(ownerId, 'OWNER'), foreignEmployee.id, ownerId),
    WorkforceResourceNotFoundError,
  );
  await assert.rejects(
    service.createForUser(context(ownerId, 'OWNER'), ownerId, {
      firstName: 'Owner', lastName: 'Profile', managerId: foreignEmployee.id,
    }),
    WorkforceValidationError,
  );
});

test('already-linked Employee cannot be reassigned to another User', async () => {
  const linked = await prisma.employee.findUniqueOrThrow({ where: { userId: memberId } });
  await assert.rejects(
    service.linkUser(context(ownerId, 'OWNER'), linked.id, ownerId),
    WorkforceValidationError,
  );
});

test('linked MEMBER resolves only their safe profile without compensation', async () => {
  const linked = await prisma.employee.findUniqueOrThrow({ where: { userId: memberId } });
  const profile = await service.getProfile(context(memberId, 'MEMBER'), linked.id);
  assert.equal(profile.userId, memberId);
  assert.equal('salary' in profile, false);
  assert.equal('compensationNotes' in profile, false);
});
