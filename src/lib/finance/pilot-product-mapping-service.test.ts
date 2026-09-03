import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import type { FinancialAuthorization } from './financial-control-authorization';
import { FinancialControlService } from './financial-control-service';
import { FinancialValidationError } from './financial-control-errors';
import { PILOT_GROUP_MAPPING_ACCOUNT, PilotProductMappingService } from './pilot-product-mapping-service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const service = new PilotProductMappingService(prisma);
const control = new FinancialControlService(prisma);
let companyId = ''; let foreignCompanyId = ''; let userId = ''; let memberId = ''; let groupId = ''; let fuelId = ''; let reeferId = ''; let overheadId = '';
const context = (): FinancialAuthorization => ({ userId, role: 'OWNER', activeCompanyId: companyId, operatingGroupId: groupId, companyIds: [companyId] });

before(async () => {
  const [company, foreign] = await Promise.all([prisma.company.create({ data: { name: `Mapping ${suffix}` } }), prisma.company.create({ data: { name: `Mapping foreign ${suffix}` } })]);
  companyId = company.id; foreignCompanyId = foreign.id;
  const [owner, member] = await Promise.all([
    prisma.user.create({ data: { email: `mapping-owner-${suffix}@test.dev`, displayName: 'Mapping owner', activeCompanyId: companyId } }),
    prisma.user.create({ data: { email: `mapping-member-${suffix}@test.dev`, displayName: 'Mapping member', activeCompanyId: companyId } }),
  ]);
  userId = owner.id; memberId = member.id;
  await prisma.companyMembership.createMany({ data: [{ companyId, userId, role: 'OWNER' }, { companyId, userId: memberId, role: 'MEMBER' }] });
  const group = await control.createGroup(`Mapping group ${suffix}`, { companyId, role: 'OWNER', user: { id: userId, email: owner.email, displayName: owner.displayName, isActive: true, activeCompanyId: companyId } });
  groupId = group.id;
  await prisma.operatingGroupMembership.create({ data: { operatingGroupId: groupId, userId: memberId, role: 'MEMBER' } });
  const fuel = await prisma.financialCategory.findFirstOrThrow({ where: { operatingGroupId: groupId, name: 'Fuel' } }); fuelId = fuel.id;
  const reefer = await prisma.financialCategory.create({ data: { operatingGroupId: groupId, name: `Reefer Fuel ${suffix}`, type: 'DIRECT_EXPENSE', parentCategoryId: fuelId } }); reeferId = reefer.id;
  overheadId = (await prisma.financialCategory.findFirstOrThrow({ where: { operatingGroupId: groupId, type: 'OVERHEAD' } })).id;
});

after(async () => {
  await prisma.financialAuditEvent.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.pilotProductMapping.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.financialCategory.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroupMembership.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroupCompany.deleteMany({ where: { operatingGroupId: groupId } });
  await prisma.operatingGroup.deleteMany({ where: { id: groupId } });
  await prisma.companyMembership.deleteMany({ where: { userId: { in: [userId, memberId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, memberId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
  await prisma.$disconnect();
});

test('saves all supported group-wide mappings and is idempotent', async () => {
  for (const [code, categoryId] of [['020', fuelId], ['033', reeferId], ['140', fuelId]] as const) {
    assert.equal((await service.save(code, categoryId, context())).changed, true);
    assert.equal((await service.save(code, categoryId, context())).changed, false);
  }
  const rows = await service.list(context());
  assert.equal(rows.length, 3);
  assert.ok(rows.every(({ mapping }) => mapping?.isActive));
  assert.equal(await prisma.pilotProductMapping.count({ where: { operatingGroupId: groupId, providerAccountHash: PILOT_GROUP_MAPPING_ACCOUNT } }), 3);
  assert.equal(await prisma.financialAuditEvent.count({ where: { operatingGroupId: groupId, action: 'PILOT_PRODUCT_MAPPING_CREATED' } }), 3);
});

test('mapping changes are versioned and auditable', async () => {
  const changed = await service.save('020', reeferId, context());
  assert.equal(changed.changed, true);
  const mapping = await prisma.pilotProductMapping.findFirstOrThrow({ where: { operatingGroupId: groupId, providerAccountHash: PILOT_GROUP_MAPPING_ACCOUNT, productCode: '020' } });
  assert.equal(mapping.version, 2);
  assert.equal(mapping.categoryId, reeferId);
  assert.equal(await prisma.financialAuditEvent.count({ where: { operatingGroupId: groupId, action: 'PILOT_PRODUCT_MAPPING_CHANGED' } }), 1);
});

test('rejects unsupported, inactive, non-direct, and cross-group categories', async () => {
  const inactive = await prisma.financialCategory.create({ data: { operatingGroupId: groupId, name: `Inactive ${suffix}`, type: 'DIRECT_EXPENSE', isActive: false } });
  const foreignGroup = await prisma.operatingGroup.create({ data: { name: `Foreign ${suffix}` } });
  const foreignCategory = await prisma.financialCategory.create({ data: { operatingGroupId: foreignGroup.id, name: `Foreign fuel ${suffix}`, type: 'DIRECT_EXPENSE' } });
  await assert.rejects(() => service.save('999', fuelId, context()), FinancialValidationError);
  await assert.rejects(() => service.save('020', inactive.id, context()), FinancialValidationError);
  await assert.rejects(() => service.save('020', overheadId, context()), FinancialValidationError);
  await assert.rejects(() => service.save('020', foreignCategory.id, context()), FinancialValidationError);
  await prisma.financialCategory.delete({ where: { id: foreignCategory.id } });
  await prisma.operatingGroup.delete({ where: { id: foreignGroup.id } });
});

test('transactionally denies MEMBER and inactive-user saves', async () => {
  const memberContext: FinancialAuthorization = { ...context(), userId: memberId, role: 'MEMBER' };
  await assert.rejects(() => service.save('020', fuelId, memberContext), AuthorizationDeniedError);
  await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
  await assert.rejects(() => service.save('020', fuelId, context()), AuthorizationDeniedError);
  await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
});

test('concurrent changes serialize to one unambiguous mapping', async () => {
  const results = await Promise.allSettled([service.save('140', fuelId, context()), service.save('140', reeferId, context())]);
  assert.ok(results.some(({ status }) => status === 'fulfilled'));
  const mappings = await prisma.pilotProductMapping.findMany({ where: { operatingGroupId: groupId, providerAccountHash: PILOT_GROUP_MAPPING_ACCOUNT, productCode: '140' } });
  assert.equal(mappings.length, 1);
  assert.ok([fuelId, reeferId].includes(mappings[0].categoryId));
});

test('inactive mapped category is reported as invalid until explicitly remapped', async () => {
  await service.save('020', reeferId, context());
  await prisma.financialCategory.update({ where: { id: reeferId }, data: { isActive: false } });
  const row = (await service.list(context())).find(({ productCode }) => productCode === '020');
  assert.equal(row?.status, 'INVALID');
  await prisma.financialCategory.update({ where: { id: reeferId }, data: { isActive: true } });
  assert.equal((await service.list(context())).find(({ productCode }) => productCode === '020')?.status, 'MAPPED');
});
