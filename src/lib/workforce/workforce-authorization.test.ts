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
  WorkforceAuthorizationService,
  WorkforceResourceNotFoundError,
} from './workforce-authorization';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let activeSession: TrustedSession = null;
let adminUserId = '';
let memberUserId = '';
let inactiveUserId = '';
let nonMemberUserId = '';
let firstCompanyId = '';
let secondCompanyId = '';
let firstEmployeeId = '';
let secondEmployeeId = '';
let legacyEmployeeId = '';
let firstPaymentId = '';
let secondPaymentId = '';
let firstEscrowId = '';
let secondEscrowId = '';

const authorization = new AuthorizationService(prisma, async () => activeSession);
const workforce = new WorkforceAuthorizationService(prisma, authorization);

before(async () => {
  const [firstCompany, secondCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Workforce first ${suffix}` } }),
    prisma.company.create({ data: { name: `Workforce second ${suffix}` } }),
  ]);
  firstCompanyId = firstCompany.id;
  secondCompanyId = secondCompany.id;

  const [admin, member, inactive, nonMember] = await Promise.all([
    prisma.user.create({
      data: {
        email: `workforce-admin-${suffix}@example.test`,
        displayName: 'Workforce admin',
        activeCompanyId: firstCompanyId,
      },
    }),
    prisma.user.create({
      data: {
        email: `workforce-member-${suffix}@example.test`,
        displayName: 'Workforce member',
        activeCompanyId: firstCompanyId,
      },
    }),
    prisma.user.create({
      data: {
        email: `workforce-inactive-${suffix}@example.test`,
        displayName: 'Workforce inactive',
        isActive: false,
      },
    }),
    prisma.user.create({
      data: {
        email: `workforce-none-${suffix}@example.test`,
        displayName: 'Workforce non-member',
      },
    }),
  ]);
  adminUserId = admin.id;
  memberUserId = member.id;
  inactiveUserId = inactive.id;
  nonMemberUserId = nonMember.id;
  await prisma.companyMembership.createMany({
    data: [
      { userId: adminUserId, companyId: firstCompanyId, role: 'ADMIN' },
      { userId: memberUserId, companyId: firstCompanyId, role: 'MEMBER' },
    ],
  });

  const [firstEmployee, secondEmployee, legacyEmployee] = await Promise.all([
    prisma.employee.create({
      data: {
        companyId: firstCompanyId,
        firstName: 'First',
        lastName: 'Employee',
      },
    }),
    prisma.employee.create({
      data: {
        companyId: secondCompanyId,
        firstName: 'Second',
        lastName: 'Employee',
      },
    }),
    prisma.employee.create({
      data: { firstName: 'Legacy', lastName: 'Employee' },
    }),
  ]);
  firstEmployeeId = firstEmployee.id;
  secondEmployeeId = secondEmployee.id;
  legacyEmployeeId = legacyEmployee.id;

  const [firstPayment, secondPayment, firstEscrow, secondEscrow] =
    await Promise.all([
      prisma.employeePayment.create({
        data: {
          employeeId: firstEmployeeId,
          amount: 100,
          period: '2026-01',
        },
      }),
      prisma.employeePayment.create({
        data: {
          employeeId: secondEmployeeId,
          amount: 200,
          period: '2026-01',
        },
      }),
      prisma.employeeEscrow.create({
        data: { employeeId: firstEmployeeId },
      }),
      prisma.employeeEscrow.create({
        data: { employeeId: secondEmployeeId },
      }),
    ]);
  firstPaymentId = firstPayment.id;
  secondPaymentId = secondPayment.id;
  firstEscrowId = firstEscrow.id;
  secondEscrowId = secondEscrow.id;
});

after(async () => {
  await prisma.employeeEscrow.deleteMany({
    where: { id: { in: [firstEscrowId, secondEscrowId] } },
  });
  await prisma.employeePayment.deleteMany({
    where: { id: { in: [firstPaymentId, secondPaymentId] } },
  });
  await prisma.employee.deleteMany({
    where: {
      id: { in: [firstEmployeeId, secondEmployeeId, legacyEmployeeId] },
    },
  });
  await prisma.user.deleteMany({
    where: {
      id: { in: [adminUserId, memberUserId, inactiveUserId, nonMemberUserId] },
    },
  });
  await prisma.company.deleteMany({
    where: { id: { in: [firstCompanyId, secondCompanyId] } },
  });
  await prisma.$disconnect();
});

test('rejects unauthenticated, inactive, non-member, and member workforce access', async () => {
  activeSession = null;
  await assert.rejects(
    workforce.requireEmployee(firstEmployeeId),
    AuthenticationRequiredError,
  );
  activeSession = { user: { id: inactiveUserId } };
  await assert.rejects(
    workforce.requireEmployee(firstEmployeeId),
    AuthenticationRequiredError,
  );
  activeSession = { user: { id: nonMemberUserId } };
  await assert.rejects(
    workforce.requireEmployee(firstEmployeeId),
    AuthorizationDeniedError,
  );
  activeSession = { user: { id: memberUserId } };
  await assert.rejects(
    workforce.requireEmployee(firstEmployeeId),
    AuthorizationDeniedError,
  );
});

test('isolates employees and hides foreign and nullable legacy records', async () => {
  activeSession = { user: { id: adminUserId } };
  assert.equal(
    (await workforce.requireEmployee(firstEmployeeId)).companyId,
    firstCompanyId,
  );
  for (const employeeId of [secondEmployeeId, legacyEmployeeId]) {
    await assert.rejects(
      workforce.requireEmployee(employeeId),
      WorkforceResourceNotFoundError,
    );
  }
});

test('validates payment parent and route employee together', async () => {
  activeSession = { user: { id: adminUserId } };
  assert.equal(
    (await workforce.requirePayment(firstEmployeeId, firstPaymentId)).companyId,
    firstCompanyId,
  );
  for (const [employeeId, paymentId] of [
    [secondEmployeeId, secondPaymentId],
    [firstEmployeeId, secondPaymentId],
  ]) {
    await assert.rejects(
      workforce.requirePayment(employeeId, paymentId),
      WorkforceResourceNotFoundError,
    );
  }
});

test('isolates escrow through its verified employee reference', async () => {
  activeSession = { user: { id: adminUserId } };
  assert.equal(
    (await workforce.requireEscrow(firstEscrowId)).companyId,
    firstCompanyId,
  );
  await assert.rejects(
    workforce.requireEscrow(secondEscrowId),
    WorkforceResourceNotFoundError,
  );
});
