import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import type { FinancialAuthorization } from './financial-control-authorization';
import { FinancialControlService } from './financial-control-service';
import { FinancialConflictError } from './financial-control-errors';
import { OperatingGroupCompanyService } from './operating-group-company-service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const service = new OperatingGroupCompanyService(prisma);
const control = new FinancialControlService(prisma);
let ownerId = ''; let adminId = ''; let memberId = '';
let companyAId = ''; let companyBId = ''; let companyCId = ''; let companyDId = '';
let groupId = ''; let foreignGroupId = '';
let truckBId = ''; let trailerBId = ''; let bankAccountBId = ''; let bankSubAccountBId = ''; let bankTransactionBId = '';

function context(userId = ownerId, role: 'OWNER' | 'ADMIN' = 'OWNER'): FinancialAuthorization {
  return { userId, role, activeCompanyId: companyAId, operatingGroupId: groupId, companyIds: [companyAId] };
}

before(async () => {
  const companies = await Promise.all(['A', 'B', 'C', 'D'].map((name) => prisma.company.create({ data: { name: `Group ${name} ${suffix}` } })));
  [companyAId, companyBId, companyCId, companyDId] = companies.map(({ id }) => id);
  const users = await Promise.all([
    prisma.user.create({ data: { email: `group-owner-${suffix}@test.dev`, displayName: 'Group owner', activeCompanyId: companyAId } }),
    prisma.user.create({ data: { email: `group-admin-${suffix}@test.dev`, displayName: 'Group admin', activeCompanyId: companyAId } }),
    prisma.user.create({ data: { email: `group-member-${suffix}@test.dev`, displayName: 'Group member', activeCompanyId: companyAId } }),
  ]);
  [ownerId, adminId, memberId] = users.map(({ id }) => id);
  await prisma.companyMembership.createMany({ data: [
    { userId: ownerId, companyId: companyAId, role: 'OWNER' },
    { userId: ownerId, companyId: companyBId, role: 'OWNER' },
    { userId: ownerId, companyId: companyCId, role: 'OWNER' },
    { userId: adminId, companyId: companyAId, role: 'ADMIN' },
    { userId: memberId, companyId: companyAId, role: 'MEMBER' },
  ] });
  const group = await control.createGroup(`Managed group ${suffix}`, {
    companyId: companyAId,
    role: 'OWNER',
    user: { id: ownerId, email: `group-owner-${suffix}@test.dev`, displayName: 'Group owner', isActive: true, activeCompanyId: companyAId },
  });
  groupId = group.id;
  foreignGroupId = (await prisma.operatingGroup.create({ data: { name: `Foreign group ${suffix}`, companies: { create: { companyId: companyDId } } } })).id;
  const [truck, trailer, bankAccount] = await Promise.all([
    prisma.truck.create({ data: { companyId: companyBId, unitNumber: `GROUP-${suffix}`, status: 'ACTIVE' } }),
    prisma.trailer.create({ data: { companyId: companyBId, unitNumber: `GROUP-TRAILER-${suffix}`, status: 'AVAILABLE' } }),
    prisma.bankAccount.create({ data: {
      companyId: companyBId,
      provider: 'PLAID',
      externalConnectionId: `group-bank-${suffix}`,
      institutionName: 'Test institution',
      accessTokenCiphertext: 'test-only-ciphertext',
      createdByUserId: ownerId,
      accounts: { create: { externalAccountId: `group-subaccount-${suffix}`, name: 'Test checking', type: 'depository', currentBalanceMinor: BigInt(12345) } },
    }, include: { accounts: true } }),
  ]);
  truckBId = truck.id; trailerBId = trailer.id; bankAccountBId = bankAccount.id; bankSubAccountBId = bankAccount.accounts[0].id;
  bankTransactionBId = (await prisma.bankTransaction.create({ data: {
    bankAccountId: bankAccountBId,
    subAccountId: bankSubAccountBId,
    companyId: companyBId,
    providerTransactionId: `group-transaction-${suffix}`,
    date: new Date('2026-09-01T00:00:00.000Z'),
    amount: 123.45,
    amountMinor: BigInt(12345),
    name: 'Test transaction',
  } })).id;
});

after(async () => {
  await prisma.financialAuditEvent.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.financialCategory.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroupMembership.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: { in: [groupId, foreignGroupId] } } });
  await prisma.operatingGroup.deleteMany({ where: { id: { in: [groupId, foreignGroupId] } } });
  await prisma.bankTransaction.deleteMany({ where: { id: bankTransactionBId } });
  await prisma.bankSubAccount.deleteMany({ where: { id: bankSubAccountBId } });
  await prisma.bankAccount.deleteMany({ where: { id: bankAccountBId } });
  await prisma.trailer.deleteMany({ where: { id: trailerBId } });
  await prisma.truck.deleteMany({ where: { id: truckBId } });
  await prisma.companyMembership.deleteMany({ where: { userId: { in: [ownerId, adminId, memberId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, memberId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyAId, companyBId, companyCId, companyDId] } } });
  await prisma.$disconnect();
});

test('OWNER sees included and explicitly eligible companies without cross-group candidates', async () => {
  const result = await service.list(context());
  assert.deepEqual(result.includedCompanies.map(({ companyId }) => companyId), [companyAId]);
  assert.deepEqual(result.availableCompanies.map(({ companyId }) => companyId).sort(), [companyBId, companyCId].sort());
  assert.equal(result.removalSupported, false);
});

test('ADMIN has view-only group access and MEMBER cannot add', async () => {
  const adminResult = await service.list(context(adminId, 'ADMIN'));
  assert.deepEqual(adminResult.includedCompanies.map(({ companyId }) => companyId), [companyAId]);
  assert.deepEqual(adminResult.availableCompanies, []);
  await assert.rejects(service.add(companyBId, context(adminId, 'ADMIN')), AuthorizationDeniedError);
  await assert.rejects(service.add(companyBId, { ...context(memberId, 'ADMIN'), role: 'MEMBER' } as FinancialAuthorization), AuthorizationDeniedError);
});

test('OWNER adds a company without changing canonical company data and receives durable audit evidence', async () => {
  const before = await prisma.company.findUniqueOrThrow({ where: { id: companyBId } });
  const fleetAndBankBefore = await Promise.all([
    prisma.truck.findUniqueOrThrow({ where: { id: truckBId } }),
    prisma.trailer.findUniqueOrThrow({ where: { id: trailerBId } }),
    prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountBId } }),
    prisma.bankSubAccount.findUniqueOrThrow({ where: { id: bankSubAccountBId } }),
    prisma.bankTransaction.findUniqueOrThrow({ where: { id: bankTransactionBId } }),
  ]);
  const financialBefore = await Promise.all([
    prisma.financialTransaction.count({ where: { operatingGroupId: groupId } }),
    prisma.financialExpectation.count({ where: { operatingGroupId: groupId } }),
    prisma.financialAllocation.count({ where: { transaction: { operatingGroupId: groupId } } }),
    prisma.financialSource.count({ where: { operatingGroupId: groupId } }),
    prisma.financialStatement.count({ where: { operatingGroupId: groupId } }),
    prisma.financialTransaction.aggregate({ where: { operatingGroupId: groupId }, _sum: { amountMinor: true, recoveredAmountMinor: true, waivedAmountMinor: true } }),
    prisma.pilotFuelingEvent.count({ where: { invoice: { operatingGroupId: groupId } } }),
    prisma.bankTransaction.count(),
  ]);
  const result = await service.add(companyBId, context());
  assert.equal(result.alreadyIncluded, false);
  const after = await prisma.company.findUniqueOrThrow({ where: { id: companyBId } });
  assert.deepEqual(after, before);
  assert.deepEqual(await Promise.all([
    prisma.truck.findUniqueOrThrow({ where: { id: truckBId } }),
    prisma.trailer.findUniqueOrThrow({ where: { id: trailerBId } }),
    prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountBId } }),
    prisma.bankSubAccount.findUniqueOrThrow({ where: { id: bankSubAccountBId } }),
    prisma.bankTransaction.findUniqueOrThrow({ where: { id: bankTransactionBId } }),
  ]), fleetAndBankBefore);
  const link = await prisma.operatingGroupCompany.findUniqueOrThrow({ where: { companyId: companyBId } });
  assert.equal(link.operatingGroupId, groupId);
  const audit = await prisma.financialAuditEvent.findFirstOrThrow({ where: { operatingGroupId: groupId, companyId: companyBId, action: 'OPERATING_GROUP_COMPANY_ADDED' } });
  assert.equal(audit.actorUserId, ownerId);
  assert.deepEqual(audit.metadata, { companyId: companyBId, companyName: `Group B ${suffix}` });
  assert.deepEqual(await Promise.all([
    prisma.financialTransaction.count({ where: { operatingGroupId: groupId } }),
    prisma.financialExpectation.count({ where: { operatingGroupId: groupId } }),
    prisma.financialAllocation.count({ where: { transaction: { operatingGroupId: groupId } } }),
    prisma.financialSource.count({ where: { operatingGroupId: groupId } }),
    prisma.financialStatement.count({ where: { operatingGroupId: groupId } }),
    prisma.financialTransaction.aggregate({ where: { operatingGroupId: groupId }, _sum: { amountMinor: true, recoveredAmountMinor: true, waivedAmountMinor: true } }),
    prisma.pilotFuelingEvent.count({ where: { invoice: { operatingGroupId: groupId } } }),
    prisma.bankTransaction.count(),
  ]), financialBefore);
});

test('repeat and concurrent additions are idempotent and create one link and audit event', async () => {
  const repeated = await service.add(companyBId, context());
  assert.equal(repeated.alreadyIncluded, true);
  const concurrent = await Promise.all([service.add(companyCId, context()), service.add(companyCId, context())]);
  assert.equal(concurrent.filter(({ alreadyIncluded }) => !alreadyIncluded).length, 1);
  assert.equal(concurrent.filter(({ alreadyIncluded }) => alreadyIncluded).length, 1);
  assert.equal(await prisma.operatingGroupCompany.count({ where: { companyId: companyCId } }), 1);
  assert.equal(await prisma.financialAuditEvent.count({ where: { companyId: companyCId, action: 'OPERATING_GROUP_COMPANY_ADDED' } }), 1);
});

test('revoked membership, inactive user, and a company in another group fail closed', async () => {
  await assert.rejects(service.add(companyDId, context()), AuthorizationDeniedError);
  await prisma.companyMembership.create({ data: { userId: ownerId, companyId: companyDId, role: 'OWNER' } });
  await assert.rejects(service.add(companyDId, context()), FinancialConflictError);
  await prisma.companyMembership.update({ where: { userId_companyId: { userId: ownerId, companyId: companyCId } }, data: { role: 'ADMIN' } });
  await prisma.operatingGroupCompany.delete({ where: { companyId: companyCId } });
  await assert.rejects(service.add(companyCId, context()), AuthorizationDeniedError);
  await prisma.companyMembership.update({ where: { userId_companyId: { userId: ownerId, companyId: companyCId } }, data: { role: 'MEMBER' } });
  await assert.rejects(service.add(companyCId, context()), AuthorizationDeniedError);
  await prisma.companyMembership.update({ where: { userId_companyId: { userId: ownerId, companyId: companyCId } }, data: { role: 'OWNER' } });
  await prisma.user.update({ where: { id: ownerId }, data: { isActive: false } });
  await assert.rejects(service.add(companyCId, context()), AuthorizationDeniedError);
  await prisma.user.update({ where: { id: ownerId }, data: { isActive: true } });
});

test('client context cannot redirect an Add to a non-active operating group', async () => {
  await assert.rejects(service.add(companyCId, { ...context(), operatingGroupId: foreignGroupId }), AuthorizationDeniedError);
  assert.equal(await prisma.operatingGroupCompany.count({ where: { companyId: companyCId } }), 0);
});

test('membership revocation racing an Add is observed before the association can be created', async () => {
  let release!: () => void;
  let locked!: () => void;
  const releaseGate = new Promise<void>((resolve) => { release = resolve; });
  const lockReady = new Promise<void>((resolve) => { locked = resolve; });
  const revoke = prisma.$transaction(async (tx) => {
    await tx.companyMembership.update({
      where: { userId_companyId: { userId: ownerId, companyId: companyCId } },
      data: { role: 'ADMIN' },
    });
    locked();
    await releaseGate;
  });
  await lockReady;
  const addResult = service.add(companyCId, context()).then(
    () => ({ status: 'fulfilled' as const }),
    (error: unknown) => ({ status: 'rejected' as const, error }),
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  release();
  await revoke;
  const result = await addResult;
  assert.equal(result.status, 'rejected');
  assert.ok(result.status === 'rejected' && result.error instanceof AuthorizationDeniedError);
  assert.equal(await prisma.operatingGroupCompany.count({ where: { companyId: companyCId } }), 0);
  await prisma.companyMembership.update({ where: { userId_companyId: { userId: ownerId, companyId: companyCId } }, data: { role: 'OWNER' } });
});

test('user deactivation racing an Add is observed before the association can be created', async () => {
  let release!: () => void;
  let locked!: () => void;
  const releaseGate = new Promise<void>((resolve) => { release = resolve; });
  const lockReady = new Promise<void>((resolve) => { locked = resolve; });
  const deactivate = prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: ownerId }, data: { isActive: false } });
    locked();
    await releaseGate;
  });
  await lockReady;
  const addResult = service.add(companyCId, context()).then(
    () => ({ status: 'fulfilled' as const }),
    (error: unknown) => ({ status: 'rejected' as const, error }),
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  release();
  await deactivate;
  const result = await addResult;
  assert.equal(result.status, 'rejected');
  assert.ok(result.status === 'rejected' && result.error instanceof AuthorizationDeniedError);
  assert.equal(await prisma.operatingGroupCompany.count({ where: { companyId: companyCId } }), 0);
  await prisma.user.update({ where: { id: ownerId }, data: { isActive: true } });
});
