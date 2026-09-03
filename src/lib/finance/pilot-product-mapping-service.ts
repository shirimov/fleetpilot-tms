import { Prisma, PrismaClient, type PilotProductType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import type { FinancialAuthorization } from './financial-control-authorization';
import { FinancialValidationError } from './financial-control-errors';

export const PILOT_GROUP_MAPPING_ACCOUNT = '*';

export const PILOT_SUPPORTED_PRODUCTS = [
  { productCode: '020', productType: 'TRUCK_DIESEL' as const, label: 'Truck Diesel' },
  { productCode: '033', productType: 'REEFER_FUEL' as const, label: 'Reefer Fuel' },
  { productCode: '140', productType: 'DEF' as const, label: 'DEF' },
] as const;

const supportedByCode = new Map<string, { productCode: string; productType: PilotProductType; label: string }>(
  PILOT_SUPPORTED_PRODUCTS.map((product) => [product.productCode, product]),
);

export class PilotProductMappingService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async list(context: FinancialAuthorization) {
    const mappings = await this.database.pilotProductMapping.findMany({
      where: {
        operatingGroupId: context.operatingGroupId,
        provider: 'PILOT',
        providerAccountHash: PILOT_GROUP_MAPPING_ACCOUNT,
        productCode: { in: PILOT_SUPPORTED_PRODUCTS.map(({ productCode }) => productCode) },
      },
      select: {
        id: true,
        productCode: true,
        productType: true,
        version: true,
        isActive: true,
        approvedAt: true,
        category: { select: { id: true, name: true, type: true, isActive: true } },
      },
    });
    const byCode = new Map(mappings.map((mapping) => [mapping.productCode, mapping]));
    return PILOT_SUPPORTED_PRODUCTS.map((product) => ({ ...product, mapping: byCode.get(product.productCode) ?? null }));
  }

  async save(productCodeInput: unknown, categoryIdInput: unknown, context: FinancialAuthorization) {
    const productCode = typeof productCodeInput === 'string' ? productCodeInput.trim().toUpperCase() : '';
    const categoryId = typeof categoryIdInput === 'string' ? categoryIdInput.trim() : '';
    const product = supportedByCode.get(productCode);
    if (!product) throw new FinancialValidationError('Select a supported Pilot product code.');
    if (!categoryId) throw new FinancialValidationError('Accounting category is required.');

    return this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pilot-product-mapping:${context.operatingGroupId}:${productCode}`}, 0))::text AS lock_result`;
      await this.revalidateAuthority(tx, context);
      const category = await tx.financialCategory.findFirst({
        where: { id: categoryId, operatingGroupId: context.operatingGroupId, isActive: true, type: 'DIRECT_EXPENSE' },
        select: { id: true, name: true, type: true },
      });
      if (!category) throw new FinancialValidationError('Select an active Direct Expense category in this operating group.');

      const key = {
        operatingGroupId: context.operatingGroupId,
        provider: 'PILOT',
        providerAccountHash: PILOT_GROUP_MAPPING_ACCOUNT,
        productCode,
      };
      const existing = await tx.pilotProductMapping.findUnique({
        where: { operatingGroupId_provider_providerAccountHash_productCode: key },
        select: { id: true, categoryId: true, version: true, isActive: true },
      });
      if (existing?.categoryId === category.id && existing.isActive) {
        return { changed: false, mappingId: existing.id, productCode, productType: product.productType, category };
      }

      const mapping = existing
        ? await tx.pilotProductMapping.update({
            where: { id: existing.id },
            data: { categoryId: category.id, productType: product.productType, isActive: true, version: { increment: 1 }, approvedByUserId: context.userId, approvedAt: new Date() },
          })
        : await tx.pilotProductMapping.create({
            data: { ...key, productType: product.productType, categoryId: category.id, approvedByUserId: context.userId },
          });
      await tx.financialAuditEvent.create({
        data: {
          operatingGroupId: context.operatingGroupId,
          companyId: context.activeCompanyId,
          actorUserId: context.userId,
          action: existing ? 'PILOT_PRODUCT_MAPPING_CHANGED' : 'PILOT_PRODUCT_MAPPING_CREATED',
          before: existing ? { categoryId: existing.categoryId, version: existing.version, isActive: existing.isActive } : undefined,
          after: { categoryId: category.id, version: mapping.version, isActive: true },
          metadata: { provider: 'PILOT', productCode, productType: product.productType, mappingScope: 'OPERATING_GROUP' },
        },
      });
      return { changed: true, mappingId: mapping.id, productCode, productType: product.productType, category };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async revalidateAuthority(tx: Prisma.TransactionClient, context: FinancialAuthorization) {
    const users = await tx.$queryRaw<Array<{ isActive: boolean }>>`SELECT "isActive" FROM "User" WHERE id=${context.userId} FOR UPDATE`;
    const memberships = await tx.$queryRaw<Array<{ role: string }>>`SELECT role::text FROM "OperatingGroupMembership" WHERE "operatingGroupId"=${context.operatingGroupId} AND "userId"=${context.userId} FOR UPDATE`;
    const activeGroup = await tx.operatingGroupCompany.findUnique({ where: { companyId: context.activeCompanyId }, select: { operatingGroupId: true } });
    const companyMembership = await tx.companyMembership.findUnique({ where: { userId_companyId: { companyId: context.activeCompanyId, userId: context.userId } }, select: { role: true } });
    if (!users[0]?.isActive || !memberships[0] || !['OWNER', 'ADMIN'].includes(memberships[0].role)
      || activeGroup?.operatingGroupId !== context.operatingGroupId || !companyMembership || !['OWNER', 'ADMIN'].includes(companyMembership.role)) {
      throw new AuthorizationDeniedError();
    }
  }
}

export const pilotProductMappingService = new PilotProductMappingService();
