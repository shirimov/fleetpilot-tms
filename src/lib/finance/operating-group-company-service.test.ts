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
});

after(async () => {
  await prisma.financialAuditEvent.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.financialCategory.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroupMembership.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: { in: [groupId, foreignGroupId] } } });
  await prisma.operatingGroup.deleteMany({ where: { id: { in: [groupId, foreignGroupId] } } });
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
  const financialBefore = await Promise.all([
    prisma.financialTransaction.count({ where: { operatingGroupId: groupId } }),
    prisma.financialExpectation.count({ where: { operatingGroupId: groupId } }),
    prisma.financialAllocation.count({ where: { transaction: { operatingGroupId: groupId } } }),
    prisma.financialSource.count({ where: { operatingGroupId: groupId } }),
    prisma.financialStatement.count({ where: { operatingGroupId: groupId } }),
  ]);
  const result = await service.add(companyBId, context());
  assert.equal(result.alreadyIncluded, false);
  const after = await prisma.company.findUniqueOrThrow({ where: { id: companyBId } });
  assert.deepEqual(after, before);
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
  await prisma.companyMembership.update({ where: { userId_companyId: { userId: ownerId, companyId: companyCId } }, data: { role: 'OWNER' } });
  await prisma.user.update({ where: { id: ownerId }, data: { isActive: false } });
  await assert.rejects(service.add(companyCId, context()), AuthorizationDeniedError);
  await prisma.user.update({ where: { id: ownerId }, data: { isActive: true } });
});
