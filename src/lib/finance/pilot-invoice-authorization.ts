import type { PrismaClient, Prisma } from '@prisma/client';
import type { FinancialAuthorization } from './financial-control-authorization';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';

type InvoiceAuthorizationRepository = Pick<PrismaClient | Prisma.TransactionClient, 'operatingGroupCompany' | 'companyMembership'>;

// Group invoice economics are indivisible: both original scope and fresh Company authority are required.
export async function hasPilotInvoiceAccess(context: FinancialAuthorization, database: InvoiceAuthorizationRepository): Promise<boolean> {
  const companies = await database.operatingGroupCompany.findMany({
    where: { operatingGroupId: context.operatingGroupId }, select: { companyId: true },
  });
  if (!companies.length || companies.some(({ companyId }) => !context.companyIds.includes(companyId))) return false;
  const memberships = await database.companyMembership.findMany({
    where: { userId: context.userId, companyId: { in: companies.map(({ companyId }) => companyId) }, role: { in: ['ADMIN', 'OWNER'] } },
    select: { companyId: true },
  });
  const authorized = new Set(memberships.map(({ companyId }) => companyId));
  return companies.every(({ companyId }) => authorized.has(companyId));
}

export async function requirePilotInvoiceAccess(context: FinancialAuthorization, database: InvoiceAuthorizationRepository): Promise<void> {
  if (!await hasPilotInvoiceAccess(context, database)) throw new AuthorizationDeniedError();
}
