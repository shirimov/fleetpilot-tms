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
  FinancialAuthorizationService,
  FinancialResourceNotFoundError,
} from './financial-authorization';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let activeSession: TrustedSession = null;
let adminUserId = '';
let memberUserId = '';
let inactiveUserId = '';
let nonMemberUserId = '';
let firstCompanyId = '';
let secondCompanyId = '';
let firstTruckId = '';
let secondTruckId = '';
let firstSettlementId = '';
let secondSettlementId = '';
let firstBankAccountId = '';
let secondBankAccountId = '';
let legacyBankAccountId = '';

const authorization = new AuthorizationService(prisma, async () => activeSession);
const financialAuthorization = new FinancialAuthorizationService(
  prisma,
  authorization,
);

before(async () => {
  const [firstCompany, secondCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Finance first ${suffix}` } }),
    prisma.company.create({ data: { name: `Finance second ${suffix}` } }),
  ]);
  firstCompanyId = firstCompany.id;
  secondCompanyId = secondCompany.id;

  const [admin, member, inactive, nonMember] = await Promise.all([
    prisma.user.create({
      data: {
        email: `finance-admin-${suffix}@example.test`,
        displayName: 'Finance admin',
        activeCompanyId: firstCompanyId,
      },
    }),
    prisma.user.create({
      data: {
        email: `finance-member-${suffix}@example.test`,
        displayName: 'Finance member',
        activeCompanyId: firstCompanyId,
      },
    }),
    prisma.user.create({
      data: {
        email: `finance-inactive-${suffix}@example.test`,
        displayName: 'Finance inactive',
        isActive: false,
      },
    }),
    prisma.user.create({
      data: {
        email: `finance-none-${suffix}@example.test`,
        displayName: 'Finance non-member',
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

  const [firstTruck, secondTruck] = await Promise.all([
    prisma.truck.create({
      data: {
        companyId: firstCompanyId,
        unitNumber: `finance-first-${suffix}`,
      },
    }),
    prisma.truck.create({
      data: {
        companyId: secondCompanyId,
        unitNumber: `finance-second-${suffix}`,
      },
    }),
  ]);
  firstTruckId = firstTruck.id;
  secondTruckId = secondTruck.id;

  const [firstSettlement, secondSettlement] = await Promise.all([
    prisma.settlement.create({
      data: {
        truckId: firstTruckId,
        weekEnding: new Date(),
        grossRevenue: 100,
        driverPay: 50,
        netPay: 50,
      },
    }),
    prisma.settlement.create({
      data: {
        truckId: secondTruckId,
        weekEnding: new Date(),
        grossRevenue: 200,
        driverPay: 100,
        netPay: 100,
      },
    }),
  ]);
  firstSettlementId = firstSettlement.id;
  secondSettlementId = secondSettlement.id;

  const [firstAccount, secondAccount, legacyAccount] = await Promise.all([
    prisma.bankAccount.create({
      data: {
        companyId: firstCompanyId,
        plaidItemId: `finance-first-${suffix}`,
        plaidAccessToken: 'test-only-token',
      },
    }),
    prisma.bankAccount.create({
      data: {
        companyId: secondCompanyId,
        plaidItemId: `finance-second-${suffix}`,
        plaidAccessToken: 'test-only-token',
      },
    }),
    prisma.bankAccount.create({
      data: {
        plaidItemId: `finance-legacy-${suffix}`,
        plaidAccessToken: 'test-only-token',
      },
    }),
  ]);
  firstBankAccountId = firstAccount.id;
  secondBankAccountId = secondAccount.id;
  legacyBankAccountId = legacyAccount.id;
});

after(async () => {
  await prisma.bankAccount.deleteMany({
    where: {
      id: {
        in: [firstBankAccountId, secondBankAccountId, legacyBankAccountId],
      },
    },
  });
  await prisma.settlement.deleteMany({
    where: { id: { in: [firstSettlementId, secondSettlementId] } },
  });
  await prisma.truck.deleteMany({
    where: { id: { in: [firstTruckId, secondTruckId] } },
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

test('rejects unauthenticated, inactive, and non-member finance access', async () => {
  activeSession = null;
  await assert.rejects(
    financialAuthorization.requireSettlement(firstSettlementId),
    AuthenticationRequiredError,
  );
  activeSession = { user: { id: inactiveUserId } };
  await assert.rejects(
    financialAuthorization.requireSettlement(firstSettlementId),
    AuthenticationRequiredError,
  );
  activeSession = { user: { id: nonMemberUserId } };
  await assert.rejects(
    financialAuthorization.requireSettlement(firstSettlementId),
    AuthorizationDeniedError,
  );
});

test('scopes settlement ownership and privileged mutations by company', async () => {
  activeSession = { user: { id: memberUserId } };
  assert.equal(
    (await financialAuthorization.requireSettlement(firstSettlementId))
      .companyId,
    firstCompanyId,
  );
  await assert.rejects(
    financialAuthorization.requireSettlement(firstSettlementId, 'ADMIN'),
    AuthorizationDeniedError,
  );

  activeSession = { user: { id: adminUserId } };
  await assert.rejects(
    financialAuthorization.requireSettlement(secondSettlementId, 'ADMIN'),
    FinancialResourceNotFoundError,
  );
});

test('scopes Plaid accounts and hides foreign and nullable legacy ownership', async () => {
  activeSession = { user: { id: adminUserId } };
  assert.equal(
    (await financialAuthorization.requireBankAccount(firstBankAccountId))
      .companyId,
    firstCompanyId,
  );
  for (const accountId of [secondBankAccountId, legacyBankAccountId]) {
    await assert.rejects(
      financialAuthorization.requireBankAccount(accountId),
      FinancialResourceNotFoundError,
    );
  }
});

test('member cannot use a spoofed Plaid account selector to gain admin access', async () => {
  activeSession = { user: { id: memberUserId } };
  await assert.rejects(
    financialAuthorization.requireBankAccount(secondBankAccountId),
    AuthorizationDeniedError,
  );
});
