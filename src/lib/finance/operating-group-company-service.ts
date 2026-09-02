import { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import type { FinancialAuthorization } from './financial-control-authorization';
import { FinancialConflictError, FinancialValidationError } from './financial-control-errors';

export class OperatingGroupCompanyService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async list(context: FinancialAuthorization) {
    const [includedCompanies, ownerMemberships] = await Promise.all([
      this.database.operatingGroupCompany.findMany({
        where: {
          operatingGroupId: context.operatingGroupId,
          companyId: { in: context.companyIds },
        },
        orderBy: { company: { name: 'asc' } },
        select: {
          companyId: true,
          joinedAt: true,
          company: { select: { id: true, name: true } },
        },
      }),
      context.role === 'OWNER'
        ? this.database.companyMembership.findMany({
            where: { userId: context.userId, role: 'OWNER', user: { isActive: true } },
            orderBy: { company: { name: 'asc' } },
            select: {
              companyId: true,
              company: {
                select: {
                  id: true,
                  name: true,
                  operatingGroupLink: { select: { operatingGroupId: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const availableCompanies = ownerMemberships
      .filter(({ company }) => !company.operatingGroupLink)
      .map(({ companyId, company }) => ({ companyId, company: { id: company.id, name: company.name } }));

    return {
      role: context.role,
      includedCompanies,
      availableCompanies,
      removalSupported: false,
    };
  }

  async add(companyIdInput: unknown, context: FinancialAuthorization) {
    if (context.role !== 'OWNER') throw new AuthorizationDeniedError();
    if (typeof companyIdInput !== 'string' || !companyIdInput.trim()) {
      throw new FinancialValidationError('Company is required.');
    }
    const companyId = companyIdInput.trim();

    return this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`operating-group-company:${companyId}`}, 0))::text AS lock_result`;

      const user = await tx.user.findUnique({ where: { id: context.userId }, select: { isActive: true } });
      if (!user?.isActive) throw new AuthorizationDeniedError();

      const activeGroupLink = await tx.operatingGroupCompany.findUnique({
        where: { companyId: context.activeCompanyId },
        select: { operatingGroupId: true },
      });
      const groupMembership = await tx.operatingGroupMembership.findUnique({
        where: { operatingGroupId_userId: { operatingGroupId: context.operatingGroupId, userId: context.userId } },
        select: { role: true },
      });
      if (activeGroupLink?.operatingGroupId !== context.operatingGroupId || groupMembership?.role !== 'OWNER') {
        throw new AuthorizationDeniedError();
      }

      const lockedMembership = await tx.$queryRaw<Array<{ role: string }>>`
        SELECT role::text
        FROM "CompanyMembership"
        WHERE "userId" = ${context.userId} AND "companyId" = ${companyId}
        FOR UPDATE
      `;
      if (lockedMembership[0]?.role !== 'OWNER') throw new AuthorizationDeniedError();
      const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
      if (!company) throw new AuthorizationDeniedError();

      const existing = await tx.operatingGroupCompany.findUnique({
        where: { companyId },
        select: { operatingGroupId: true, joinedAt: true },
      });
      if (existing?.operatingGroupId === context.operatingGroupId) {
        return { company, joinedAt: existing.joinedAt, alreadyIncluded: true };
      }
      if (existing) throw new FinancialConflictError('This company already belongs to another operating group.');

      const created = await tx.operatingGroupCompany.create({
        data: { operatingGroupId: context.operatingGroupId, companyId },
        select: { joinedAt: true },
      });
      await tx.financialAuditEvent.create({
        data: {
          operatingGroupId: context.operatingGroupId,
          companyId,
          actorUserId: context.userId,
          action: 'OPERATING_GROUP_COMPANY_ADDED',
          metadata: { companyId, companyName: company.name },
        },
      });
      return { company, joinedAt: created.joinedAt, alreadyIncluded: false };
    });
  }
}

export const operatingGroupCompanyService = new OperatingGroupCompanyService();
