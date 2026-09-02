import type { CompanyMembershipRole, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { AuthorizationService, authorizationService } from '@/lib/auth/authorization';

export type FinancialAuthorization = {
  userId: string;
  activeCompanyId: string;
  operatingGroupId: string;
  role: CompanyMembershipRole;
  companyIds: string[];
};

const weight: Record<CompanyMembershipRole, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

export class FinancialControlAuthorizationService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly authorization: AuthorizationService = authorizationService,
  ) {}

  async requireContext(minimumRole: CompanyMembershipRole = 'ADMIN'): Promise<FinancialAuthorization> {
    const active = await this.authorization.requireActiveCompany(minimumRole);
    const link = await this.database.operatingGroupCompany.findUnique({
      where: { companyId: active.companyId },
      select: {
        operatingGroupId: true,
        operatingGroup: {
          select: {
            companies: { select: { companyId: true } },
            memberships: {
              where: { userId: active.user.id },
              select: { role: true },
            },
          },
        },
      },
    });
    const groupRole = link?.operatingGroup.memberships[0]?.role;
    if (!link || !groupRole || weight[groupRole] < weight[minimumRole]) {
      throw new AuthorizationDeniedError();
    }
    const groupCompanyIds = link.operatingGroup.companies.map(({ companyId }) => companyId);
    const authorizedMemberships = await this.database.companyMembership.findMany({
      where: {
        userId: active.user.id,
        companyId: { in: groupCompanyIds },
        role: { in: minimumRole === 'OWNER' ? ['OWNER'] : ['ADMIN', 'OWNER'] },
      },
      select: { companyId: true },
    });
    const companyIds = authorizedMemberships.map(({ companyId }) => companyId);
    if (!companyIds.includes(active.companyId)) throw new AuthorizationDeniedError();
    return {
      userId: active.user.id,
      activeCompanyId: active.companyId,
      operatingGroupId: link.operatingGroupId,
      role: groupRole,
      companyIds,
    };
  }

  async requireSetupAuthority() {
    return this.authorization.requireActiveCompany('ADMIN');
  }
}

export const financialControlAuthorization = new FinancialControlAuthorizationService();
