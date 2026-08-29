import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { AuthorizationService, type TrustedSession } from '@/lib/auth/authorization';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { PayrollPreviewService } from './payroll-preview-service';

const suffix = randomUUID().slice(0, 8);
let session: TrustedSession = null;
const authorization = new AuthorizationService(prisma, async () => session);
const service = new PayrollPreviewService(prisma, authorization);
let companyId = ''; let foreignCompanyId = ''; let ownerId = ''; let adminId = ''; let memberId = ''; let driverId = ''; let foreignDriverId = ''; let periodId = ''; let groupId = ''; let contractorId = '';

function useUser(userId: string) { session = { user: { id: userId } }; }

before(async () => {
  const [company, foreignCompany] = await Promise.all([prisma.company.create({ data: { name: `Payroll ${suffix}` } }), prisma.company.create({ data: { name: `Payroll foreign ${suffix}` } })]);
  companyId = company.id; foreignCompanyId = foreignCompany.id;
  const [owner, admin, member] = await Promise.all([
    prisma.user.create({ data: { email: `payroll-owner-${suffix}@test.dev`, displayName: 'Owner', activeCompanyId: companyId } }),
    prisma.user.create({ data: { email: `payroll-admin-${suffix}@test.dev`, displayName: 'Admin', activeCompanyId: companyId } }),
    prisma.user.create({ data: { email: `payroll-member-${suffix}@test.dev`, displayName: 'Member', activeCompanyId: companyId } }),
  ]);
  ownerId = owner.id; adminId = admin.id; memberId = member.id;
  await prisma.companyMembership.createMany({ data: [{ companyId, userId: ownerId, role: 'OWNER' }, { companyId, userId: adminId, role: 'ADMIN' }, { companyId, userId: memberId, role: 'MEMBER' }] });
  const [driver, foreignDriver] = await Promise.all([
    prisma.driver.create({ data: { companyId, firstName: 'Audit', lastName: 'Driver', payRate: 0.65, payType: 'PER_MILE' } }),
    prisma.driver.create({ data: { companyId: foreignCompanyId, firstName: 'Foreign', lastName: 'Driver', payRate: 0.65, payType: 'PER_MILE' } }),
  ]);
  driverId = driver.id; foreignDriverId = foreignDriver.id;
  await prisma.load.create({ data: { companyId, loadNumber: `PAY-${suffix}`, status: 'DELIVERED', origin: 'A', destination: 'B', deliveryDate: new Date('2026-08-20T12:00:00Z'), miles: 4663, rate: 1000, driverId } });
  const group = await prisma.operatingGroup.create({ data: { name: `Payroll group ${suffix}` } }); groupId = group.id;
  const contractor = await prisma.financialParty.create({ data: { operatingGroupId: groupId, companyId, type: 'OWNER_OPERATOR', name: `Contractor ${suffix}` } }); contractorId = contractor.id;
});

after(async () => {
  await prisma.payrollExternalReference.deleteMany({ where: { companyId } });
  await prisma.payrollAdjustment.deleteMany({ where: { companyId } });
  await prisma.payrollPayContract.deleteMany({ where: { companyId: { in: [companyId, foreignCompanyId] } } });
  await prisma.payrollPeriod.deleteMany({ where: { companyId } });
  await prisma.load.deleteMany({ where: { companyId } });
  await prisma.driver.deleteMany({ where: { id: { in: [driverId, foreignDriverId] } } });
  await prisma.financialParty.deleteMany({ where: { id: contractorId } });
  await prisma.operatingGroup.deleteMany({ where: { id: groupId } });
  await prisma.companyMembership.deleteMany({ where: { userId: { in: [ownerId, adminId, memberId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, memberId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
  await prisma.$disconnect();
});

test('OWNER creates an isolated period, contract, adjustment and reconciled preview without posting Accounting', async () => {
  useUser(ownerId);
  const financialBefore = await prisma.financialTransaction.count({ where: { companyId } });
  const settlementBefore = await prisma.settlement.count({ where: { driverId } });
  const period = await service.createPeriod({ identifier: `2026-W34-${suffix}`, startDate: '2026-08-16', endDate: '2026-08-22', externalProvider: 'QUICKMANAGE', externalPeriod: '2026-34', externalBatchId: '202634' }); periodId = period.id;
  await service.createContract({ participantType: 'COMPANY_DRIVER', participantId: driverId, type: 'PER_MILE', ratePerMile: '0.65', effectiveFrom: '2026-08-01' });
  await service.createAdjustment({ periodId, participantType: 'COMPANY_DRIVER', participantId: driverId, category: 'REIMBURSEMENT', amount: '250.00', description: 'Preview reimbursement', effectiveDate: '2026-08-20', currency: 'USD' });
  await service.createReference({ periodId, participantType: 'COMPANY_DRIVER', participantId: driverId, provider: 'QUICKMANAGE', earning: '3030.95', reimbursement: '250.00', fuel: '0.00', toll: '0.00', deductions: '0.00', payout: '3280.95', currency: 'USD' });
  const result = await service.periodPreview(periodId);
  const preview = result.previews.find((item) => item.id === driverId)!;
  assert.equal(preview.calculation.baseEarningMinor, '303095');
  assert.equal(preview.calculation.calculatedPayoutMinor, '328095');
  assert.equal(preview.calculation.readiness, 'RECONCILED');
  assert.equal(preview.reference?.fuelMinor, '0');
  assert.equal(preview.reference?.tollMinor, '0');
  assert.equal(await prisma.financialTransaction.count({ where: { companyId } }), financialBefore);
  assert.equal(await prisma.settlement.count({ where: { driverId } }), settlementBefore);
});

test('ADMIN is allowed while MEMBER is denied', async () => {
  useUser(adminId); assert.equal((await service.listPeriods()).length, 1);
  useUser(memberId); await assert.rejects(service.listPeriods(), AuthorizationDeniedError);
});

test('cross-company participants are rejected and active company is authoritative', async () => {
  useUser(ownerId);
  await assert.rejects(service.createContract({ participantType: 'COMPANY_DRIVER', participantId: foreignDriverId, type: 'PER_MILE', ratePerMile: '0.65', effectiveFrom: '2026-08-01' }), /outside the active company/i);
  assert.equal(await prisma.payrollPayContract.count({ where: { driverId: foreignDriverId } }), 0);
});

test('contractor percentage foundation remains blocked instead of guessing the base', async () => {
  useUser(ownerId);
  await service.createContract({ participantType: 'CONTRACTOR', participantId: contractorId, type: 'PERCENTAGE', percentage: '88', percentageBase: 'UNKNOWN', effectiveFrom: '2026-08-01' });
  const result = await service.periodPreview(periodId);
  const preview = result.previews.find((item) => item.id === contractorId)!;
  assert.equal(preview.calculation.readiness, 'BLOCKED');
  assert.match(preview.calculation.blockers.join(' '), /percentage base/i);
});

test('preview recalculation is deterministic and does not persist calculated payroll', async () => {
  useUser(ownerId);
  const first = await service.periodPreview(periodId);
  const second = await service.periodPreview(periodId);
  assert.deepEqual(first, second);
  assert.equal(await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } }).then((period) => period.calculatedAt), null);
});
