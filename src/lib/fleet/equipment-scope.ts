import type { CompanyMembershipRole, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { AuthorizationService, authorizationService } from '@/lib/auth/authorization';
import { roleCanAccessModule } from '@/lib/auth/module-permissions';

export const ALL_AUTHORIZED_COMPANIES = 'all';

export type EquipmentCompanyOption = {
  id: string;
  name: string;
  role: CompanyMembershipRole;
  canManage: boolean;
};

export type EquipmentScope = {
  activeCompanyId: string;
  companyIds: string[];
  companies: EquipmentCompanyOption[];
  selectedCompany: string;
};

export class EquipmentScopeService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly authorization: AuthorizationService = authorizationService,
  ) {}

  async resolve(requestedCompany?: string | null): Promise<EquipmentScope> {
    const activeContext = await this.authorization.requireModule('fleet');
    const memberships = await this.database.companyMembership.findMany({
      where: { userId: activeContext.user.id },
      select: {
        companyId: true,
        role: true,
        company: { select: { name: true } },
      },
      orderBy: [{ company: { name: 'asc' } }, { companyId: 'asc' }],
    });
    const companies = memberships
      .filter(({ role }) => roleCanAccessModule(role, 'fleet'))
      .map(({ companyId, company, role }) => ({
        id: companyId,
        name: company.name,
        role,
        canManage: role === 'ADMIN' || role === 'OWNER',
      }));
    const selectedCompany = requestedCompany?.trim() || activeContext.companyId;
    if (selectedCompany === ALL_AUTHORIZED_COMPANIES) {
      return {
        activeCompanyId: activeContext.companyId,
        companyIds: companies.map(({ id }) => id),
        companies,
        selectedCompany,
      };
    }
    if (!companies.some(({ id }) => id === selectedCompany)) {
      throw new AuthorizationDeniedError();
    }
    return {
      activeCompanyId: activeContext.companyId,
      companyIds: [selectedCompany],
      companies,
      selectedCompany,
    };
  }
}

export const equipmentScopeService = new EquipmentScopeService();
