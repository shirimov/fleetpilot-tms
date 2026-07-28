import type { CompanyMembershipRole, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  AuthorizationService,
  authorizationService,
  type CompanyAuthorization,
} from '@/lib/auth/authorization';

export class FinancialResourceNotFoundError extends Error {
  constructor() {
    super('Not found');
    this.name = 'FinancialResourceNotFoundError';
  }
}

export class FinancialAuthorizationService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly authorization: AuthorizationService = authorizationService,
  ) {}

  async requireSettlement(
    settlementId: string,
    minimumRole: CompanyMembershipRole = 'MEMBER',
  ): Promise<CompanyAuthorization> {
    const context =
      await this.authorization.requireActiveCompany(minimumRole);
    const settlement = await this.database.settlement.findFirst({
      where: {
        id: settlementId,
        truck: { companyId: context.companyId },
      },
      select: { id: true },
    });
    if (!settlement) throw new FinancialResourceNotFoundError();
    return context;
  }

  async requireBankAccount(
    bankAccountId: string,
    minimumRole: CompanyMembershipRole = 'ADMIN',
  ): Promise<CompanyAuthorization> {
    const context =
      await this.authorization.requireActiveCompany(minimumRole);
    const bankAccount = await this.database.bankAccount.findFirst({
      where: { id: bankAccountId, companyId: context.companyId },
      select: { id: true },
    });
    if (!bankAccount) throw new FinancialResourceNotFoundError();
    return context;
  }
}

export const financialAuthorizationService =
  new FinancialAuthorizationService();
