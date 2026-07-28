import type { CompanyMembershipRole, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  AuthorizationService,
  authorizationService,
  type CompanyAuthorization,
} from '@/lib/auth/authorization';

export class WorkforceResourceNotFoundError extends Error {
  constructor() {
    super('Not found');
    this.name = 'WorkforceResourceNotFoundError';
  }
}

export class WorkforceAuthorizationService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly authorization: AuthorizationService = authorizationService,
  ) {}

  requireCompany(
    minimumRole: CompanyMembershipRole = 'ADMIN',
  ): Promise<CompanyAuthorization> {
    return this.authorization.requireActiveCompany(minimumRole);
  }

  async requireEmployee(employeeId: string): Promise<CompanyAuthorization> {
    const context = await this.requireCompany();
    const employee = await this.database.employee.findFirst({
      where: { id: employeeId, companyId: context.companyId },
      select: { id: true },
    });
    if (!employee) throw new WorkforceResourceNotFoundError();
    return context;
  }

  async requirePayment(
    employeeId: string,
    paymentId: string,
  ): Promise<CompanyAuthorization> {
    const context = await this.requireCompany();
    const payment = await this.database.employeePayment.findFirst({
      where: {
        id: paymentId,
        employeeId,
        employee: { companyId: context.companyId },
      },
      select: { id: true },
    });
    if (!payment) throw new WorkforceResourceNotFoundError();
    return context;
  }

  async requireEscrow(escrowId: string): Promise<CompanyAuthorization> {
    const context = await this.requireCompany();
    const escrow = await this.database.employeeEscrow.findFirst({
      where: {
        id: escrowId,
        employeeId: {
          in: (
            await this.database.employee.findMany({
              where: { companyId: context.companyId },
              select: { id: true },
            })
          ).map(({ id }) => id),
        },
      },
      select: { id: true },
    });
    if (!escrow) throw new WorkforceResourceNotFoundError();
    return context;
  }
}

export const workforceAuthorizationService =
  new WorkforceAuthorizationService();
