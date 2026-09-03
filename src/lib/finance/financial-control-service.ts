import { createHash } from 'node:crypto';
import {
  Prisma,
  type FinancialCategoryType,
  type FinancialDirection,
  type FinancialMatchMethod,
  type FinancialProgramType,
  type FinancialSourceType,
  type FinancialStatementType,
  PrismaClient,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import type { FinancialAuthorization } from './financial-control-authorization';
import { FinancialConflictError, FinancialNotFoundError, FinancialValidationError } from './financial-control-errors';
import { bigintJson, normalizeCurrency, parsePositiveMinorUnits } from './money';
import type { CanonicalImportCandidate } from './financial-importers';

const defaults: ReadonlyArray<[FinancialCategoryType, string]> = [
  ['INCOME', 'Freight Revenue'], ['INCOME', 'Accessorial Revenue'], ['INCOME', 'Detention'], ['INCOME', 'Other Revenue'],
  ['DIRECT_EXPENSE', 'Fuel'], ['DIRECT_EXPENSE', 'Reefer Fuel'], ['DIRECT_EXPENSE', 'Driver Pay'],
  ['DIRECT_EXPENSE', 'Owner Operator Pay'], ['DIRECT_EXPENSE', 'Tolls'], ['DIRECT_EXPENSE', 'Truck Repair'],
  ['DIRECT_EXPENSE', 'Trailer Repair'], ['DIRECT_EXPENSE', 'Tires'], ['DIRECT_EXPENSE', 'Truck Wash'],
  ['DIRECT_EXPENSE', 'DEF'], ['DIRECT_EXPENSE', 'Insurance'], ['DIRECT_EXPENSE', 'Permits'],
  ['DIRECT_EXPENSE', 'Registration'], ['DIRECT_EXPENSE', 'Factoring Fees'],
  ['EQUIPMENT_FINANCING', 'Truck Payment'], ['EQUIPMENT_FINANCING', 'Trailer Payment'],
  ['EQUIPMENT_FINANCING', 'Interest'], ['EQUIPMENT_FINANCING', 'Equipment Purchase'],
  ['OVERHEAD', 'Office Rent'], ['OVERHEAD', 'Payroll/Admin'], ['OVERHEAD', 'Software'],
  ['OVERHEAD', 'Phone'], ['OVERHEAD', 'Bank Fees'], ['OVERHEAD', 'Legal'],
  ['OVERHEAD', 'General Operations'], ['OTHER', 'Other'],
];

function text(value: unknown, label: string, max = 255) {
  if (typeof value !== 'string' || !value.trim()) throw new FinancialValidationError(`${label} is required.`);
  return value.trim().slice(0, max);
}

function optionalText(value: unknown, max = 255) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

export function financialDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new FinancialValidationError(`${label} is invalid.`);
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new FinancialValidationError(`${label} is invalid.`);
  return parsed;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new FinancialValidationError(`${label} is invalid.`);
  return value as T;
}

export class FinancialControlService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async getGroup(active: CompanyAuthorization) {
    return this.database.operatingGroupCompany.findUnique({
      where: { companyId: active.companyId },
      select: { operatingGroup: { select: { id: true, name: true, currency: true } } },
    });
  }

  async createGroup(name: unknown, active: CompanyAuthorization) {
    const existing = await this.getGroup(active);
    if (existing) throw new FinancialConflictError('This company already belongs to an operating group.');
    return this.database.$transaction(async (tx) => {
      const managers = await tx.companyMembership.findMany({
        where: { companyId: active.companyId, role: { in: ['OWNER', 'ADMIN'] }, user: { isActive: true } },
        select: { userId: true, role: true },
      });
      const group = await tx.operatingGroup.create({
        data: {
          name: text(name, 'Operating group name'),
          companies: { create: { companyId: active.companyId } },
          memberships: { create: managers.map(({ userId, role }) => ({ userId, role })) },
          categories: {
            create: defaults.map(([type, categoryName]) => ({ type, name: categoryName, isSystemDefault: true })),
          },
        },
        select: { id: true, name: true, currency: true },
      });
      await tx.financialAuditEvent.create({
        data: { operatingGroupId: group.id, companyId: active.companyId, actorUserId: active.user.id, action: 'OPERATING_GROUP_CREATED' },
      });
      return group;
    });
  }

  async listSources(context: FinancialAuthorization) {
    return this.database.financialSource.findMany({
      where: { operatingGroupId: context.operatingGroupId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, type: true, institution: true, provider: true, currency: true, lastFour: true, isActive: true, company: { select: { id: true, name: true } }, _count: { select: { statements: true, transactions: true, destinationTransfers: true, expectations: true } } },
    });
  }

  async updateSource(sourceId: string, input: Record<string, unknown>, context: FinancialAuthorization) {
    if (typeof input.isActive !== 'boolean') throw new FinancialValidationError('Only active status can be changed.');
    const source = await this.database.financialSource.findFirst({ where: { id: sourceId, operatingGroupId: context.operatingGroupId } });
    if (!source) throw new FinancialNotFoundError();
    return this.database.financialSource.update({ where: { id: sourceId }, data: { isActive: input.isActive } });
  }

  async deleteSource(sourceId: string, context: FinancialAuthorization) {
    this.requireOwner(context);
    return this.database.$transaction(async (tx) => {
      await this.lockFinancialRows(tx, [`financial-source:${sourceId}`]);
      const source = await tx.financialSource.findFirst({ where: { id: sourceId, operatingGroupId: context.operatingGroupId }, select: { id: true, name: true, _count: { select: { statements: true, transactions: true, destinationTransfers: true, expectations: true } } } });
      if (!source) throw new FinancialNotFoundError();
      if (Object.values(source._count).some((count) => count > 0)) throw new FinancialConflictError('This financial account cannot be deleted because it has financial history. Deactivate it instead.');
      await tx.financialSource.delete({ where: { id: sourceId } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, actorUserId: context.userId, action: 'FINANCIAL_SOURCE_DELETED', metadata: { deletedSourceId: source.id, name: source.name } } });
      return { deleted: true };
    });
  }

  async createSource(input: Record<string, unknown>, context: FinancialAuthorization) {
    const companyId = optionalText(input.companyId);
    if (companyId && !context.companyIds.includes(companyId)) throw new FinancialValidationError('Company is outside this operating group.');
    return this.database.financialSource.create({
      data: {
        operatingGroupId: context.operatingGroupId,
        companyId,
        name: text(input.name, 'Source name'),
        type: enumValue(input.type, ['BANK_ACCOUNT', 'CREDIT_CARD', 'FUEL_CARD', 'TOLL_ACCOUNT', 'TMS_SETTLEMENT', 'CUSTOMER_SETTLEMENT', 'OWNER_SETTLEMENT', 'CASH', 'OTHER'] satisfies FinancialSourceType[], 'Source type'),
        institution: optionalText(input.institution), provider: optionalText(input.provider),
        currency: normalizeCurrency(input.currency ?? 'USD'),
        lastFour: optionalText(input.lastFour, 4),
      },
    });
  }

  async listCategories(context: FinancialAuthorization) {
    const categories = await this.database.financialCategory.findMany({ where: { operatingGroupId: context.operatingGroupId }, orderBy: [{ name: 'asc' }], include: { _count: { select: { childCategories: true, transactions: true, allocations: true } } } });
    const byId = new Map(categories.map((category) => [category.id, category]));
    const pathFor = (category: (typeof categories)[number]) => {
      const names = [category.name];
      const visited = new Set([category.id]);
      let parentId = category.parentCategoryId;
      while (parentId) {
        if (visited.has(parentId)) break;
        visited.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) break;
        names.unshift(parent.name);
        parentId = parent.parentCategoryId;
      }
      return names.join(' / ');
    };
    return categories.map((category) => ({ ...category, path: pathFor(category) })).sort((a, b) => a.path.localeCompare(b.path));
  }

  async deleteCategory(categoryId: string, context: FinancialAuthorization) {
    this.requireOwner(context);
    return this.database.$transaction(async (tx) => {
      await this.lockFinancialRows(tx, [`financial-category:${categoryId}`]);
      const category = await tx.financialCategory.findFirst({ where: { id: categoryId, operatingGroupId: context.operatingGroupId }, select: { id: true, name: true, isSystemDefault: true, _count: { select: { childCategories: true, transactions: true, allocations: true, pilotProductMappings: true } } } });
      if (!category) throw new FinancialNotFoundError();
      if (category.isSystemDefault || Object.values(category._count).some((count) => count > 0)) throw new FinancialConflictError('This category cannot be deleted because it has financial history, dependent categories, or provider mappings. Deactivate or remap it instead.');
      await tx.financialCategory.delete({ where: { id: categoryId } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, actorUserId: context.userId, action: 'FINANCIAL_CATEGORY_DELETED', metadata: { deletedCategoryId: category.id, name: category.name } } });
      return { deleted: true };
    });
  }

  async createCategory(input: Record<string, unknown>, context: FinancialAuthorization) {
    const parentCategoryId = optionalText(input.parentCategoryId);
    if (parentCategoryId) await this.requireCategory(parentCategoryId, context);
    return this.database.financialCategory.create({ data: {
      operatingGroupId: context.operatingGroupId,
      name: text(input.name, 'Category name'),
      type: enumValue(input.type, ['INCOME', 'DIRECT_EXPENSE', 'EQUIPMENT_FINANCING', 'OVERHEAD', 'OTHER'] satisfies FinancialCategoryType[], 'Category type'),
      parentCategoryId,
    } });
  }

  async updateCategory(categoryId: string, input: Record<string, unknown>, context: FinancialAuthorization) {
    return this.database.$transaction(async (tx) => {
      await this.lockFinancialRows(tx, [`financial-category:${categoryId}`]);
      const existing = await tx.financialCategory.findFirst({ where: { id: categoryId, operatingGroupId: context.operatingGroupId } });
      if (!existing) throw new FinancialNotFoundError();
      const parentCategoryId = input.parentCategoryId === undefined ? existing.parentCategoryId : optionalText(input.parentCategoryId);
      if (parentCategoryId === categoryId) throw new FinancialValidationError('A category cannot be its own parent.');
      if (parentCategoryId) {
        const parent = await tx.financialCategory.findFirst({ where: { id: parentCategoryId, operatingGroupId: context.operatingGroupId, isActive: true }, select: { id: true } });
        if (!parent) throw new FinancialValidationError('Category is outside this operating group.');
        const descendants = await this.categoryDescendantIds(categoryId, context);
        if (descendants.has(parentCategoryId)) throw new FinancialValidationError('Category hierarchy cannot contain a cycle.');
      }
      return tx.financialCategory.update({ where: { id: categoryId }, data: {
        name: input.name === undefined ? undefined : text(input.name, 'Category name'),
        type: input.type === undefined ? undefined : enumValue(input.type, ['INCOME', 'DIRECT_EXPENSE', 'EQUIPMENT_FINANCING', 'OVERHEAD', 'OTHER'] satisfies FinancialCategoryType[], 'Category type'),
        isActive: typeof input.isActive === 'boolean' ? input.isActive : undefined,
        parentCategoryId,
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listPrograms(context: FinancialAuthorization) {
    return this.database.financialProgram.findMany({ where: { operatingGroupId: context.operatingGroupId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], include: { _count: { select: { allocations: true } } } });
  }

  async updateProgram(programId: string, input: Record<string, unknown>, context: FinancialAuthorization) {
    if (typeof input.isActive !== 'boolean') throw new FinancialValidationError('Only active status can be changed.');
    const program = await this.database.financialProgram.findFirst({ where: { id: programId, operatingGroupId: context.operatingGroupId } });
    if (!program) throw new FinancialNotFoundError();
    return this.database.financialProgram.update({ where: { id: programId }, data: { isActive: input.isActive } });
  }

  async deleteProgram(programId: string, context: FinancialAuthorization) {
    this.requireOwner(context);
    return this.database.$transaction(async (tx) => {
      await this.lockFinancialRows(tx, [`financial-program:${programId}`]);
      const program = await tx.financialProgram.findFirst({ where: { id: programId, operatingGroupId: context.operatingGroupId }, select: { id: true, code: true, name: true, _count: { select: { allocations: true } } } });
      if (!program) throw new FinancialNotFoundError();
      if (program._count.allocations > 0) throw new FinancialConflictError('This program cannot be deleted because it has financial history. Deactivate it instead.');
      await tx.financialProgram.delete({ where: { id: programId } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, actorUserId: context.userId, action: 'FINANCIAL_PROGRAM_DELETED', metadata: { deletedProgramId: program.id, code: program.code, name: program.name } } });
      return { deleted: true };
    });
  }

  async createProgram(input: Record<string, unknown>, context: FinancialAuthorization) {
    return this.database.financialProgram.create({ data: {
      operatingGroupId: context.operatingGroupId,
      code: text(input.code, 'Program code', 40).toUpperCase(),
      name: text(input.name, 'Program name'),
      type: enumValue(input.type ?? 'OTHER', ['ADMIN', 'SAFETY', 'RECRUITING', 'MAINTENANCE', 'SHOP', 'INSURANCE', 'TRAILER_RENTAL', 'OTHER'] satisfies FinancialProgramType[], 'Program type'),
    } });
  }

  async createParty(input: Record<string, unknown>, context: FinancialAuthorization) {
    const companyId = optionalText(input.companyId) ?? context.activeCompanyId;
    if (!context.companyIds.includes(companyId)) throw new FinancialValidationError('Party company is outside this operating group.');
    return this.database.financialParty.create({ data: {
      operatingGroupId: context.operatingGroupId,
      companyId,
      type: enumValue(input.type, ['VENDOR', 'OWNER_OPERATOR', 'OTHER'] as const, 'Party type'),
      name: text(input.name, 'Party name'),
      externalReference: optionalText(input.externalReference),
    } });
  }

  async listDimensions(context: FinancialAuthorization) {
    const companyWhere = { companyId: { in: context.companyIds } };
    const [companies, trucks, trailers, drivers, employees, loads, customers, parties, programs] = await Promise.all([
      this.database.company.findMany({ where: { id: { in: context.companyIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.database.truck.findMany({ where: { ...companyWhere, status: 'ACTIVE' }, select: { id: true, unitNumber: true, year: true, make: true, model: true, isOwnerOp: true, companyId: true, company: { select: { name: true } } }, orderBy: [{ company: { name: 'asc' } }, { unitNumber: 'asc' }] }),
      this.database.trailer.findMany({ where: companyWhere, select: { id: true, unitNumber: true, equipmentType: true }, orderBy: { unitNumber: 'asc' } }),
      this.database.driver.findMany({ where: companyWhere, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
      this.database.employee.findMany({ where: companyWhere, select: { id: true, firstName: true, lastName: true, preferredName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
      this.database.load.findMany({ where: companyWhere, select: { id: true, loadNumber: true }, orderBy: { loadNumber: 'asc' } }),
      this.database.customer.findMany({ where: companyWhere, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.database.financialParty.findMany({ where: { operatingGroupId: context.operatingGroupId, isActive: true }, select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } }),
      this.database.financialProgram.findMany({ where: { operatingGroupId: context.operatingGroupId, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { companies, trucks, trailers, drivers, employees, loads, customers, parties, programs };
  }

  async listAdminFeeAgreements(context: FinancialAuthorization) {
    const rows = await this.database.adminFeeAgreement.findMany({ where: { operatingGroupId: context.operatingGroupId }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], include: { ownerParty: { select: { id: true, name: true } }, truck: { select: { id: true, unitNumber: true } } } });
    return rows.map((row) => ({ ...row, amountMinor: row.amountMinor.toString(), effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10), effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null }));
  }

  async createAdminFeeAgreement(input: Record<string, unknown>, context: FinancialAuthorization) {
    const scope = enumValue(input.scope, ['OWNER', 'TRUCK'] as const, 'Agreement scope');
    const ownerPartyId = optionalText(input.ownerPartyId);
    const truckId = optionalText(input.truckId);
    if (scope === 'OWNER' && (!ownerPartyId || truckId) || scope === 'TRUCK' && (!truckId || ownerPartyId)) throw new FinancialValidationError('OWNER requires only an owner; TRUCK requires only a truck.');
    if (ownerPartyId && !await this.database.financialParty.findFirst({ where: { id: ownerPartyId, operatingGroupId: context.operatingGroupId, type: 'OWNER_OPERATOR' } })) throw new FinancialValidationError('Owner is outside this operating group.');
    if (truckId && !await this.database.truck.findFirst({ where: { id: truckId, companyId: { in: context.companyIds } } })) throw new FinancialValidationError('Truck is outside this operating group.');
    const effectiveFrom = financialDate(input.effectiveFrom, 'Effective from');
    const effectiveTo = input.effectiveTo ? financialDate(input.effectiveTo, 'Effective to') : null;
    if (effectiveTo && effectiveTo < effectiveFrom) throw new FinancialValidationError('Effective to must be on or after effective from.');
    const key = scope === 'OWNER' ? `admin-fee:owner:${ownerPartyId}` : `admin-fee:truck:${truckId}`;
    return this.database.$transaction(async (tx) => {
      await this.lockFinancialRows(tx, [key]);
      const overlap = await tx.adminFeeAgreement.findFirst({ where: { operatingGroupId: context.operatingGroupId, scope, ownerPartyId, truckId, isActive: true, effectiveFrom: { lte: effectiveTo ?? new Date('9999-12-31T00:00:00.000Z') }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] } });
      if (overlap) throw new FinancialConflictError('Admin Fee agreement overlaps an existing active period.');
      const agreement = await tx.adminFeeAgreement.create({ data: { operatingGroupId: context.operatingGroupId, scope, ownerPartyId, truckId, amountMinor: parsePositiveMinorUnits(input.amount), currency: normalizeCurrency(input.currency ?? 'USD'), frequency: 'WEEKLY', effectiveFrom, effectiveTo, isActive: input.isActive !== false, createdByUserId: context.userId } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, actorUserId: context.userId, action: 'ADMIN_FEE_AGREEMENT_CREATED', metadata: { agreementId: agreement.id, scope, ownerPartyId, truckId, amountMinor: agreement.amountMinor.toString(), effectiveFrom: effectiveFrom.toISOString().slice(0, 10), effectiveTo: effectiveTo?.toISOString().slice(0, 10) ?? null } } });
      return { ...agreement, amountMinor: agreement.amountMinor.toString(), effectiveFrom: effectiveFrom.toISOString().slice(0, 10), effectiveTo: effectiveTo?.toISOString().slice(0, 10) ?? null };
    });
  }

  async updateAdminFeeAgreement(agreementId: string, input: Record<string, unknown>, context: FinancialAuthorization) {
    if (typeof input.isActive !== 'boolean') throw new FinancialValidationError('Only active status can be changed; create a new effective-dated agreement for rate changes.');
    const isActive = input.isActive;
    return this.database.$transaction(async (tx) => {
      const existing = await tx.adminFeeAgreement.findFirst({ where: { id: agreementId, operatingGroupId: context.operatingGroupId } });
      if (!existing) throw new FinancialNotFoundError();
      const key = existing.scope === 'OWNER' ? `admin-fee:owner:${existing.ownerPartyId}` : `admin-fee:truck:${existing.truckId}`;
      await this.lockFinancialRows(tx, [key]);
      if (isActive) {
        const overlap = await tx.adminFeeAgreement.findFirst({ where: { id: { not: agreementId }, operatingGroupId: context.operatingGroupId, scope: existing.scope, ownerPartyId: existing.ownerPartyId, truckId: existing.truckId, isActive: true, effectiveFrom: { lte: existing.effectiveTo ?? new Date('9999-12-31T00:00:00.000Z') }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: existing.effectiveFrom } }] } });
        if (overlap) throw new FinancialConflictError('Admin Fee agreement overlaps an existing active period.');
      }
      const updated = await tx.adminFeeAgreement.update({ where: { id: agreementId }, data: { isActive } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, actorUserId: context.userId, action: isActive ? 'ADMIN_FEE_AGREEMENT_ACTIVATED' : 'ADMIN_FEE_AGREEMENT_DEACTIVATED', metadata: { agreementId } } });
      return { ...updated, amountMinor: updated.amountMinor.toString() };
    });
  }

  async deleteAdminFeeAgreement(agreementId: string, context: FinancialAuthorization) {
    this.requireOwner(context);
    return this.database.$transaction(async (tx) => {
      await this.lockFinancialRows(tx, [`admin-fee-agreement:${agreementId}`]);
      const agreement = await tx.adminFeeAgreement.findFirst({ where: { id: agreementId, operatingGroupId: context.operatingGroupId } });
      if (!agreement) throw new FinancialNotFoundError();
      if (!agreement.isActive || agreement.effectiveFrom <= new Date()) throw new FinancialConflictError('Historical Admin Fee agreements cannot be deleted. Deactivate or end-date them instead.');
      const history = await tx.financialAuditEvent.count({ where: { operatingGroupId: context.operatingGroupId, metadata: { path: ['agreementId'], equals: agreementId }, action: { not: 'ADMIN_FEE_AGREEMENT_CREATED' } } });
      if (history > 0) throw new FinancialConflictError('This Admin Fee agreement has protected history and cannot be deleted.');
      await tx.financialAuditEvent.deleteMany({ where: { operatingGroupId: context.operatingGroupId, action: 'ADMIN_FEE_AGREEMENT_CREATED', metadata: { path: ['agreementId'], equals: agreementId } } });
      await tx.adminFeeAgreement.delete({ where: { id: agreementId } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, actorUserId: context.userId, action: 'ADMIN_FEE_AGREEMENT_DELETED', metadata: { deletedAgreementId: agreement.id, scope: agreement.scope, effectiveFrom: agreement.effectiveFrom.toISOString().slice(0, 10) } } });
      return { deleted: true };
    });
  }

  async adminFeeAt(input: { ownerPartyId?: string; truckId?: string; on: string }, context: FinancialAuthorization) {
    if (Boolean(input.ownerPartyId) === Boolean(input.truckId)) throw new FinancialValidationError('Lookup requires exactly one owner or truck.');
    if (input.ownerPartyId && !await this.database.financialParty.findFirst({ where: { id: input.ownerPartyId, operatingGroupId: context.operatingGroupId, type: 'OWNER_OPERATOR' } })) throw new FinancialValidationError('Owner is outside this operating group.');
    if (input.truckId && !await this.database.truck.findFirst({ where: { id: input.truckId, companyId: { in: context.companyIds } } })) throw new FinancialValidationError('Truck is outside this operating group.');
    const on = financialDate(input.on, 'Lookup date');
    const row = await this.database.adminFeeAgreement.findFirst({ where: { operatingGroupId: context.operatingGroupId, isActive: true, ownerPartyId: input.ownerPartyId, truckId: input.truckId, effectiveFrom: { lte: on }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }] }, orderBy: { effectiveFrom: 'desc' } });
    return row ? { ...row, amountMinor: row.amountMinor.toString() } : null;
  }

  async listStatements(context: FinancialAuthorization) {
    const statements = await this.database.financialStatement.findMany({
      where: { operatingGroupId: context.operatingGroupId }, orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, periodStart: true, periodEnd: true, originalFilename: true, mimeType: true, byteSize: true, checksumSha256: true, importStatus: true, currency: true, sourceTotalMinor: true, importedRowCount: true, matchedRowCount: true, unresolvedRowCount: true, createdAt: true, source: { select: { id: true, name: true } } },
    });
    return statements.map((statement) => ({ ...statement, sourceTotalMinor: bigintJson(statement.sourceTotalMinor) }));
  }

  async registerStatement(input: {
    sourceId: string; type: FinancialStatementType; periodStart: Date; periodEnd: Date;
    originalFilename: string; displayFilename: string; mimeType: string; byteSize: number;
    storageKey: string; checksumSha256: string; currency: string;
  }, context: FinancialAuthorization) {
    if (input.periodEnd < input.periodStart) throw new FinancialValidationError('Statement period end must be on or after its start.');
    const source = await this.database.financialSource.findFirst({ where: { id: input.sourceId, operatingGroupId: context.operatingGroupId }, select: { id: true } });
    if (!source) throw new FinancialNotFoundError();
    try {
      return await this.database.$transaction(async (tx) => {
        const statement = await tx.financialStatement.create({ data: {
          ...input, operatingGroupId: context.operatingGroupId, importedByUserId: context.userId,
        } });
        await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, actorUserId: context.userId, action: 'STATEMENT_UPLOADED', metadata: { statementId: statement.id, checksumSha256: input.checksumSha256 } } });
        return statement;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new FinancialConflictError('This statement file was already uploaded.');
      throw error;
    }
  }

  async importRawRecords(statementId: string, records: CanonicalImportCandidate[], context: FinancialAuthorization) {
    return this.database.$transaction(async (tx) => {
      const statement = await tx.financialStatement.findFirst({
        where: { id: statementId, operatingGroupId: context.operatingGroupId, importStatus: 'UPLOADED' },
        select: { id: true },
      });
      if (!statement) throw new FinancialNotFoundError();
      const seen = new Set<string>();
      await tx.financialImportRecord.createMany({ data: records.map((record) => {
        const duplicate = seen.has(record.fingerprintSha256);
        seen.add(record.fingerprintSha256);
        return { ...record, statementId, status: duplicate ? 'DUPLICATE_SUSPECTED' : record.candidateAmountMinor && record.candidateDate ? 'UNREVIEWED' : 'NEEDS_REVIEW' };
      }) });
      const unresolvedRowCount = records.length;
      await tx.financialStatement.update({ where: { id: statementId }, data: { importStatus: 'IMPORTED', importedAt: new Date(), importedRowCount: records.length, unresolvedRowCount } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, actorUserId: context.userId, action: 'RAW_RECORDS_IMPORTED', metadata: { statementId, rowCount: records.length } } });
      return { importedRowCount: records.length, unresolvedRowCount };
    });
  }

  async createTransaction(input: Record<string, unknown>, context: FinancialAuthorization) {
    const amountMinor = parsePositiveMinorUnits(input.amount);
    const companyId = optionalText(input.companyId) ?? context.activeCompanyId;
    const transactionDate = financialDate(input.transactionDate, 'Transaction date');
    const direction = enumValue(input.direction, ['INFLOW', 'OUTFLOW', 'TRANSFER'] satisfies FinancialDirection[], 'Direction');
    const description = text(input.description, 'Description', 500);
    const reference = optionalText(input.reference);
    const currency = normalizeCurrency(input.currency ?? 'USD');
    const sourceId = optionalText(input.sourceId);
    const destinationSourceId = optionalText(input.destinationSourceId);
    const ownerId = optionalText(input.ownerId);
    const fingerprintSha256 = this.fingerprint([transactionDate.toISOString().slice(0, 10), amountMinor, currency, direction, description.toLowerCase(), reference, sourceId, destinationSourceId]);
    await this.validateDimensions({ companyId, sourceId, categoryId: optionalText(input.categoryId), customerId: optionalText(input.customerId), vendorId: optionalText(input.vendorId), ownerId }, context);
    if (direction === 'TRANSFER') {
      if (!sourceId || !destinationSourceId || sourceId === destinationSourceId) throw new FinancialValidationError('Transfers require distinct source and destination accounts.');
      const sources = await this.database.financialSource.findMany({ where: { id: { in: [sourceId, destinationSourceId] }, operatingGroupId: context.operatingGroupId }, select: { id: true, currency: true } });
      if (sources.length !== 2) throw new FinancialValidationError('Transfer account is outside this operating group.');
      if (sources.some((source) => source.currency !== currency)) throw new FinancialValidationError('Transfer accounts and transaction currency must match.');
    } else if (destinationSourceId) {
      throw new FinancialValidationError('Destination account is only valid for transfers.');
    } else if (sourceId) {
      const source = await this.database.financialSource.findFirst({ where: { id: sourceId, operatingGroupId: context.operatingGroupId }, select: { currency: true } });
      if (!source || source.currency !== currency) throw new FinancialValidationError('Source and transaction currencies must match.');
    }
    if (ownerId) {
      const owner = await this.database.financialParty.findFirst({ where: { id: ownerId, operatingGroupId: context.operatingGroupId }, select: { companyId: true } });
      if (!owner || owner.companyId && owner.companyId !== companyId) throw new FinancialValidationError('Owner and transaction company must match.');
    }
    const duplicate = await this.database.financialTransaction.findFirst({ where: { operatingGroupId: context.operatingGroupId, fingerprintSha256, status: { not: 'VOIDED' } }, select: { id: true } });
    return this.database.$transaction(async (tx) => {
      const transaction = await tx.financialTransaction.create({ data: {
        operatingGroupId: context.operatingGroupId, companyId,
        sourceId, destinationSourceId, transactionDate,
        amountMinor, currency,
        direction, description, categoryId: optionalText(input.categoryId),
        customerId: optionalText(input.customerId), vendorId: optionalText(input.vendorId), ownerId,
        reference, memo: optionalText(input.memo, 2000), createdByUserId: context.userId, fingerprintSha256,
        reconciliationStatus: duplicate ? 'DUPLICATE_SUSPECTED' : 'UNREVIEWED',
        recoverableFromOwner: input.recoverableFromOwner === true,
        expectedRecoveryMinor: input.recoverableFromOwner === true ? parsePositiveMinorUnits(input.expectedRecoveryAmount ?? input.amount) : BigInt(0),
        recoveryStatus: input.recoverableFromOwner === true ? 'OPEN' : 'NOT_APPLICABLE',
      } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId, transactionId: transaction.id, actorUserId: context.userId, action: 'TRANSACTION_CREATED', after: { amountMinor: amountMinor.toString() } } });
      return { ...transaction, amountMinor: transaction.amountMinor.toString(), expectedRecoveryMinor: transaction.expectedRecoveryMinor.toString(), recoveredAmountMinor: transaction.recoveredAmountMinor.toString(), waivedAmountMinor: transaction.waivedAmountMinor.toString() };
    });
  }

  async listTransactions(context: FinancialAuthorization) {
    const [transactions, categories] = await Promise.all([this.database.financialTransaction.findMany({
      where: { operatingGroupId: context.operatingGroupId, status: { not: 'VOIDED' } }, orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      include: { category: { select: { id: true, name: true } }, source: { select: { id: true, name: true } }, destinationSource: { select: { id: true, name: true } }, allocations: { select: { amountMinor: true } }, evidence: { select: { matchedAmountMinor: true, role: true } } },
    }), this.listCategories(context)]);
    const categoryPaths = new Map(categories.map((category) => [category.id, category.path]));
    return transactions.map((transaction) => ({ ...transaction,
      category: transaction.category ? { ...transaction.category, path: categoryPaths.get(transaction.category.id) ?? transaction.category.name } : null,
      amountMinor: transaction.amountMinor.toString(), expectedRecoveryMinor: transaction.expectedRecoveryMinor.toString(), recoveredAmountMinor: transaction.recoveredAmountMinor.toString(), waivedAmountMinor: transaction.waivedAmountMinor.toString(),
      allocatedMinor: transaction.allocations.reduce((sum, item) => sum + item.amountMinor, BigInt(0)).toString(),
      evidenceMatchedMinor: transaction.evidence.filter((item) => item.role === 'PRIMARY').reduce((sum, item) => sum + item.matchedAmountMinor, BigInt(0)).toString(),
      allocations: undefined, evidence: undefined,
    }));
  }

  async deleteTransaction(transactionId: string, context: FinancialAuthorization) {
    this.requireOwner(context);
    return this.database.$transaction(async (tx) => {
      await this.lockFinancialRows(tx, [`transaction:${transactionId}`]);
      const transaction = await tx.financialTransaction.findFirst({
        where: { id: transactionId, operatingGroupId: context.operatingGroupId },
        select: {
          id: true, companyId: true, amountMinor: true, status: true, reconciliationStatus: true, reviewedAt: true,
          recoveredAmountMinor: true, waivedAmountMinor: true, lastRecoveryAt: true,
          _count: { select: { evidence: true, allocations: true, expectationMatches: true } },
          auditEvents: { select: { action: true } },
        },
      });
      if (!transaction) throw new FinancialNotFoundError();
      await this.rejectProviderOwnedTransaction(tx, transactionId);
      const onlyCreationAudit = transaction.auditEvents.every(({ action }) => action === 'TRANSACTION_CREATED');
      const safe = transaction.status === 'DRAFT'
        && ['UNREVIEWED', 'UNMATCHED', 'DUPLICATE_SUSPECTED', 'NEEDS_REVIEW'].includes(transaction.reconciliationStatus)
        && transaction.reviewedAt === null
        && transaction.recoveredAmountMinor === BigInt(0)
        && transaction.waivedAmountMinor === BigInt(0)
        && transaction.lastRecoveryAt === null
        && Object.values(transaction._count).every((count) => count === 0)
        && onlyCreationAudit;
      if (!safe) throw new FinancialConflictError('This transaction cannot be deleted because it has financial history. Void it instead.');
      await tx.financialAuditEvent.deleteMany({ where: { transactionId, action: 'TRANSACTION_CREATED' } });
      await tx.financialTransaction.delete({ where: { id: transactionId } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: transaction.companyId, actorUserId: context.userId, action: 'FINANCIAL_TRANSACTION_DELETED', metadata: { deletedTransactionId: transaction.id, amountMinor: transaction.amountMinor.toString(), status: transaction.status, reconciliationStatus: transaction.reconciliationStatus } } });
      return { deleted: true };
    });
  }

  async voidTransaction(transactionId: string, context: FinancialAuthorization) {
    this.requireOwner(context);
    return this.database.$transaction(async (tx) => {
      await this.lockFinancialRows(tx, [`transaction:${transactionId}`]);
      const transaction = await tx.financialTransaction.findFirst({ where: { id: transactionId, operatingGroupId: context.operatingGroupId } });
      if (!transaction) throw new FinancialNotFoundError();
      await this.rejectProviderOwnedTransaction(tx, transactionId);
      if (transaction.status === 'VOIDED') throw new FinancialConflictError('This transaction is already voided.');
      await tx.financialTransaction.update({ where: { id: transactionId }, data: { status: 'VOIDED' } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: transaction.companyId, transactionId, actorUserId: context.userId, action: 'TRANSACTION_VOIDED', before: { status: transaction.status }, after: { status: 'VOIDED' } } });
      return { status: 'VOIDED' };
    });
  }

  async listImportRecords(context: FinancialAuthorization) {
    const records = await this.database.financialImportRecord.findMany({
      where: { statement: { operatingGroupId: context.operatingGroupId } },
      orderBy: [{ createdAt: 'desc' }, { sourceRowIndex: 'asc' }],
      select: { id: true, sourceRowIndex: true, rawDescription: true, rawDate: true, rawAmount: true, rawReference: true, candidateDate: true, candidateAmountMinor: true, candidateDirection: true, status: true, statement: { select: { id: true, originalFilename: true, source: { select: { name: true } } } } },
    });
    return records.map((record) => ({ ...record, candidateAmountMinor: bigintJson(record.candidateAmountMinor) }));
  }

  async listExpectations(context: FinancialAuthorization) {
    const expectations = await this.database.financialExpectation.findMany({ where: { operatingGroupId: context.operatingGroupId }, orderBy: { expectedDateStart: 'desc' } });
    return expectations.map((expectation) => ({ ...expectation, expectedAmountMinor: expectation.expectedAmountMinor.toString(), matchedAmountMinor: expectation.matchedAmountMinor.toString() }));
  }

  async createExpectation(input: Record<string, unknown>, context: FinancialAuthorization) {
    const companyId = optionalText(input.companyId) ?? context.activeCompanyId;
    await this.validateDimensions({ companyId, sourceId: optionalText(input.sourceId), categoryId: null, customerId: optionalText(input.customerId), vendorId: optionalText(input.partyId), ownerId: null }, context);
    const loadId = optionalText(input.loadId);
    const truckId = optionalText(input.truckId);
    if (loadId && !await this.database.load.findFirst({ where: { id: loadId, companyId: { in: context.companyIds } }, select: { id: true } })) throw new FinancialValidationError('Load is outside this operating group.');
    if (truckId && !await this.database.truck.findFirst({ where: { id: truckId, companyId: { in: context.companyIds } }, select: { id: true } })) throw new FinancialValidationError('Truck is outside this operating group.');
    const expectedDateStart = financialDate(input.expectedDateStart, 'Expected start date');
    const expectedDateEnd = financialDate(input.expectedDateEnd ?? input.expectedDateStart, 'Expected end date');
    if (expectedDateEnd < expectedDateStart) throw new FinancialValidationError('Expected date window is invalid.');
    const expectedAmountMinor = parsePositiveMinorUnits(input.amount);
    return this.database.$transaction(async (tx) => {
      const expectation = await tx.financialExpectation.create({ data: {
        operatingGroupId: context.operatingGroupId, companyId, sourceId: optionalText(input.sourceId), customerId: optionalText(input.customerId), partyId: optionalText(input.partyId), loadId, truckId,
        expectedAmountMinor, currency: normalizeCurrency(input.currency ?? 'USD'), direction: enumValue(input.direction, ['INFLOW', 'OUTFLOW'] satisfies FinancialDirection[], 'Direction'), description: text(input.description, 'Description', 500), expectedDateStart, expectedDateEnd, reference: optionalText(input.reference), createdByUserId: context.userId,
      } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId, actorUserId: context.userId, action: 'EXPECTATION_CREATED', metadata: { expectationId: expectation.id, expectedAmountMinor: expectedAmountMinor.toString() } } });
      return { ...expectation, expectedAmountMinor: expectation.expectedAmountMinor.toString(), matchedAmountMinor: expectation.matchedAmountMinor.toString() };
    });
  }

  async matchExpectation(expectationId: string, input: Record<string, unknown>, context: FinancialAuthorization) {
    const transactionId = text(input.transactionId, 'Transaction ID');
    const matchedAmountMinor = parsePositiveMinorUnits(input.amount);
    return this.database.$transaction(async (tx) => {
      await this.lockFinancialRows(tx, [`expectation:${expectationId}`, `transaction:${transactionId}`]);
      const [expectation, transaction] = await Promise.all([
        tx.financialExpectation.findFirst({ where: { id: expectationId, operatingGroupId: context.operatingGroupId }, select: { expectedAmountMinor: true, matchedAmountMinor: true, direction: true, currency: true } }),
        tx.financialTransaction.findFirst({ where: { id: transactionId, operatingGroupId: context.operatingGroupId }, select: { amountMinor: true, direction: true, currency: true } }),
      ]);
      if (!expectation || !transaction) throw new FinancialNotFoundError();
      await this.rejectProviderOwnedTransaction(tx, transactionId);
      if (expectation.direction !== transaction.direction) throw new FinancialValidationError('Expected and actual directions must match.');
      if (expectation.currency !== transaction.currency) throw new FinancialValidationError('Expected and actual currencies must match.');
      if (expectation.matchedAmountMinor + matchedAmountMinor > expectation.expectedAmountMinor) throw new FinancialValidationError('Match exceeds the expected amount.');
      const actualMatched = await tx.financialExpectationMatch.aggregate({ where: { transactionId }, _sum: { matchedAmountMinor: true } });
      if ((actualMatched._sum.matchedAmountMinor ?? BigInt(0)) + matchedAmountMinor > transaction.amountMinor) throw new FinancialValidationError('Match exceeds the actual transaction amount.');
      const match = await tx.financialExpectationMatch.create({ data: { expectationId, transactionId, matchedAmountMinor } });
      const total = expectation.matchedAmountMinor + matchedAmountMinor;
      await tx.financialExpectation.update({ where: { id: expectationId }, data: { matchedAmountMinor: total, status: total === expectation.expectedAmountMinor ? 'MATCHED' : 'PARTIALLY_MATCHED' } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, transactionId, actorUserId: context.userId, action: 'EXPECTATION_MATCHED', metadata: { expectationId, matchedAmountMinor: matchedAmountMinor.toString() } } });
      return { ...match, matchedAmountMinor: match.matchedAmountMinor.toString() };
    });
  }

  async matchEvidence(transactionId: string, input: Record<string, unknown>, context: FinancialAuthorization) {
    const importRecordId = text(input.importRecordId, 'Import record ID');
    const matchedAmountMinor = parsePositiveMinorUnits(input.amount);
    const method = enumValue(input.method, ['EXACT', 'PARTIAL', 'SPLIT', 'MANUAL', 'SUGGESTED'] satisfies FinancialMatchMethod[], 'Match method');
    const role = enumValue(input.role ?? 'PRIMARY', ['PRIMARY', 'CORROBORATING'] as const, 'Evidence role');
    return this.database.$transaction(async (tx) => {
      await this.lockFinancialRows(tx, [`import-record:${importRecordId}`, `transaction:${transactionId}`]);
      const transaction = await tx.financialTransaction.findFirst({ where: { id: transactionId, operatingGroupId: context.operatingGroupId }, select: { id: true, amountMinor: true, currency: true, reconciliationStatus: true } });
      const record = await tx.financialImportRecord.findFirst({ where: { id: importRecordId, statement: { operatingGroupId: context.operatingGroupId } }, select: { id: true, candidateAmountMinor: true, statement: { select: { currency: true } } } });
      if (!transaction || !record) throw new FinancialNotFoundError();
      await this.rejectProviderOwnedTransaction(tx, transactionId);
      if (transaction.currency !== record.statement.currency) throw new FinancialValidationError('Evidence and transaction currencies must match.');
      const [transactionMatched, recordMatched] = await Promise.all([
        tx.financialTransactionEvidence.aggregate({ where: { transactionId, role: 'PRIMARY' }, _sum: { matchedAmountMinor: true } }),
        tx.financialTransactionEvidence.aggregate({ where: { importRecordId }, _sum: { matchedAmountMinor: true } }),
      ]);
      if (role === 'PRIMARY' && (transactionMatched._sum.matchedAmountMinor ?? BigInt(0)) + matchedAmountMinor > transaction.amountMinor) throw new FinancialValidationError('Match exceeds the transaction amount.');
      if (record.candidateAmountMinor && (recordMatched._sum.matchedAmountMinor ?? BigInt(0)) + matchedAmountMinor > record.candidateAmountMinor) throw new FinancialValidationError('Match exceeds the imported record amount.');
      const evidence = await tx.financialTransactionEvidence.create({ data: { transactionId, importRecordId, matchedAmountMinor, method, role, confidenceBasisPoints: typeof input.confidenceBasisPoints === 'number' ? input.confidenceBasisPoints : null, matchedByUserId: context.userId } });
      const total = (transactionMatched._sum.matchedAmountMinor ?? BigInt(0)) + (role === 'PRIMARY' ? matchedAmountMinor : BigInt(0));
      if (transaction.reconciliationStatus !== 'RECONCILED') {
        await tx.financialTransaction.update({ where: { id: transactionId }, data: { reconciliationStatus: total === transaction.amountMinor ? 'MATCHED' : 'PARTIALLY_MATCHED' } });
      }
      await tx.financialImportRecord.update({ where: { id: importRecordId }, data: { status: record.candidateAmountMinor && (recordMatched._sum.matchedAmountMinor ?? BigInt(0)) + matchedAmountMinor === record.candidateAmountMinor ? 'MATCHED' : 'PARTIALLY_MATCHED' } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, transactionId, actorUserId: context.userId, action: 'EVIDENCE_MATCHED', metadata: { importRecordId, matchedAmountMinor: matchedAmountMinor.toString(), method } } });
      return { ...evidence, matchedAmountMinor: evidence.matchedAmountMinor.toString() };
    });
  }

  async replaceAllocations(transactionId: string, rawAllocations: unknown, context: FinancialAuthorization, requireComplete = true) {
    if (!Array.isArray(rawAllocations) || rawAllocations.length === 0) throw new FinancialValidationError('At least one allocation is required.');
    return this.database.$transaction(async (tx) => {
      const transaction = await tx.financialTransaction.findFirst({ where: { id: transactionId, operatingGroupId: context.operatingGroupId }, select: { id: true, amountMinor: true, companyId: true, reconciliationStatus: true, direction: true } });
      if (!transaction) throw new FinancialNotFoundError();
      await this.rejectProviderOwnedTransaction(tx, transactionId);
      if (transaction.direction === 'TRANSFER') throw new FinancialValidationError('Transfers are assigned to source and destination accounts, not operational allocations.');
      if (transaction.reconciliationStatus === 'RECONCILED') throw new FinancialConflictError('Reconciled allocations require an explicit review workflow.');
      const allocations = await Promise.all(rawAllocations.map(async (raw) => {
        if (!raw || typeof raw !== 'object') throw new FinancialValidationError('Allocation is invalid.');
        const input = raw as Record<string, unknown>;
        const allocation = { amountMinor: parsePositiveMinorUnits(input.amount), categoryId: text(input.categoryId, 'Category ID'), companyId: optionalText(input.companyId) ?? transaction.companyId, truckId: optionalText(input.truckId), trailerId: optionalText(input.trailerId), driverId: optionalText(input.driverId), employeeId: optionalText(input.employeeId), loadId: optionalText(input.loadId), customerId: optionalText(input.customerId), partyId: optionalText(input.partyId), programId: optionalText(input.programId), businessType: optionalText(input.businessType), memo: optionalText(input.memo, 1000) };
        await this.validateAllocationDimensions(allocation, context, tx as unknown as PrismaClient);
        return allocation;
      }));
      const total = allocations.reduce((sum, allocation) => sum + allocation.amountMinor, BigInt(0));
      if (total > transaction.amountMinor) throw new FinancialValidationError('Allocations cannot exceed the transaction amount.');
      if (requireComplete && total !== transaction.amountMinor) throw new FinancialValidationError('Allocations must exactly equal the transaction amount.');
      await tx.financialAllocation.deleteMany({ where: { transactionId } });
      await tx.financialAllocation.createMany({ data: allocations.map((allocation) => ({ ...allocation, transactionId })) });
      const evidence = await tx.financialTransactionEvidence.aggregate({ where: { transactionId, role: 'PRIMARY' }, _sum: { matchedAmountMinor: true } });
      if ((evidence._sum.matchedAmountMinor ?? BigInt(0)) === transaction.amountMinor) {
        await tx.financialTransaction.update({ where: { id: transactionId }, data: total === transaction.amountMinor ? { reconciliationStatus: 'RECONCILED', dataStatus: 'VERIFIED', reviewedByUserId: context.userId, reviewedAt: new Date() } : { reconciliationStatus: 'NEEDS_REVIEW' } });
      }
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: transaction.companyId, transactionId, actorUserId: context.userId, action: 'ALLOCATIONS_REPLACED', metadata: { totalMinor: total.toString(), allocationCount: allocations.length } } });
      return { allocationCount: allocations.length, totalMinor: total.toString(), remainingMinor: (transaction.amountMinor - total).toString(), allocationStatus: total === transaction.amountMinor ? 'COMPLETE' : 'PARTIAL' };
    });
  }

  async overview(context: FinancialAuthorization) {
    const [transactions, statementStatuses, rawRecordsImported, missingExpectations] = await Promise.all([
      this.database.financialTransaction.findMany({ where: { operatingGroupId: context.operatingGroupId, status: { not: 'VOIDED' }, role: 'ECONOMIC' }, select: { amountMinor: true, direction: true, reconciliationStatus: true, categoryId: true, allocations: { select: { id: true } }, recoverableFromOwner: true, recoveryStatus: true } }),
      this.database.financialStatement.groupBy({ by: ['importStatus'], where: { operatingGroupId: context.operatingGroupId }, _count: { _all: true } }),
      this.database.financialImportRecord.count({ where: { statement: { operatingGroupId: context.operatingGroupId } } }),
      this.database.financialExpectation.count({ where: { operatingGroupId: context.operatingGroupId, status: { in: ['OPEN', 'PARTIALLY_MATCHED', 'MISSING'] } } }),
    ]);
    const inflowMinor = transactions.filter((item) => item.direction === 'INFLOW').reduce((sum, item) => sum + item.amountMinor, BigInt(0));
    const outflowMinor = transactions.filter((item) => item.direction === 'OUTFLOW').reduce((sum, item) => sum + item.amountMinor, BigInt(0));
    const reconciledMinor = transactions.filter((item) => item.direction !== 'TRANSFER' && item.reconciliationStatus === 'RECONCILED').reduce((sum, item) => sum + item.amountMinor, BigInt(0));
    const operatingTransactions = transactions.filter((item) => item.direction !== 'TRANSFER');
    const totalMinor = inflowMinor + outflowMinor;
    const unresolvedMinor = totalMinor - reconciledMinor;
    const exceptions = {
      unmatchedInflows: transactions.filter((item) => item.direction === 'INFLOW' && ['UNREVIEWED', 'UNMATCHED', 'NEEDS_REVIEW'].includes(item.reconciliationStatus)).length,
      unmatchedOutflows: transactions.filter((item) => item.direction === 'OUTFLOW' && ['UNREVIEWED', 'UNMATCHED', 'NEEDS_REVIEW'].includes(item.reconciliationStatus)).length,
      partialMatches: transactions.filter((item) => item.reconciliationStatus === 'PARTIALLY_MATCHED').length,
      possibleDuplicates: transactions.filter((item) => item.reconciliationStatus === 'DUPLICATE_SUSPECTED').length,
      uncategorizedExpenses: transactions.filter((item) => item.direction === 'OUTFLOW' && !item.categoryId).length,
      missingAssignments: transactions.filter((item) => item.direction === 'OUTFLOW' && item.allocations.length === 0).length,
      ownerRecovery: transactions.filter((item) => item.recoverableFromOwner && !['RECOVERED', 'WAIVED'].includes(item.recoveryStatus)).length,
      missingExpected: missingExpectations,
    };
    const countStatus = (statuses: string[]) => statementStatuses.filter((row) => statuses.includes(row.importStatus)).reduce((sum, row) => sum + row._count._all, 0);
    const fullyReconciledCount = operatingTransactions.filter((item) => item.reconciliationStatus === 'RECONCILED').length;
    const completenessBasisPoints = operatingTransactions.length === 0 ? null : Math.min(10000, Math.max(0, Math.floor((fullyReconciledCount * 10000) / operatingTransactions.length)));
    return {
      inflowMinor: inflowMinor.toString(), outflowMinor: outflowMinor.toString(), operatingNetMinor: (inflowMinor - outflowMinor).toString(), reconciledMinor: reconciledMinor.toString(), unresolvedMinor: unresolvedMinor.toString(),
      reconciliationBasisPoints: totalMinor === BigInt(0) ? null : Number((reconciledMinor * BigInt(10000)) / totalMinor), completenessBasisPoints,
      unresolvedTransactionCount: operatingTransactions.filter((item) => item.reconciliationStatus !== 'RECONCILED').length,
      statementsRegistered: countStatus(['UPLOADED', 'IMPORTING', 'IMPORTED', 'NEEDS_REVIEW', 'FAILED']),
      statementsImportedSuccessfully: countStatus(['IMPORTED']), statementsImportFailed: countStatus(['FAILED']), statementsPending: countStatus(['UPLOADED', 'IMPORTING', 'NEEDS_REVIEW']), rawRecordsImported,
      transactionsNeedingReview: operatingTransactions.filter((item) => item.reconciliationStatus !== 'RECONCILED').length,
      fullyReconciledCount, transferCount: transactions.filter((item) => item.direction === 'TRANSFER').length,
      exceptions: { ...exceptions, duplicateCandidates: exceptions.possibleDuplicates, uncategorizedTransactions: operatingTransactions.filter((item) => !item.categoryId).length, unassignedOperationalDimensions: operatingTransactions.filter((item) => item.allocations.length === 0).length, outstandingOwnerRecoveries: exceptions.ownerRecovery, partialReconciliations: exceptions.partialMatches },
    };
  }

  async updateOwnerRecovery(transactionId: string, input: Record<string, unknown>, context: FinancialAuthorization) {
    const action = enumValue(input.action, ['RECORD', 'WAIVE'] as const, 'Recovery action');
    return this.database.$transaction(async (tx) => {
      await this.lockFinancialRows(tx, [`transaction:${transactionId}`]);
      const transaction = await tx.financialTransaction.findFirst({ where: { id: transactionId, operatingGroupId: context.operatingGroupId }, select: { id: true, companyId: true, owner: { select: { companyId: true } }, recoverableFromOwner: true, expectedRecoveryMinor: true, recoveredAmountMinor: true, waivedAmountMinor: true, recoveryStatus: true } });
      if (!transaction) throw new FinancialNotFoundError();
      await this.rejectProviderOwnedTransaction(tx, transactionId);
      if (!transaction.recoverableFromOwner || transaction.expectedRecoveryMinor <= BigInt(0)) throw new FinancialValidationError('Transaction is not owner recoverable.');
      if (transaction.companyId && transaction.owner?.companyId && transaction.companyId !== transaction.owner.companyId) throw new FinancialValidationError('Owner recovery crosses company boundaries.');
      if (['RECOVERED', 'WAIVED'].includes(transaction.recoveryStatus)) throw new FinancialConflictError('Owner recovery is already closed.');
      const now = new Date();
      const recoveryNotes = optionalText(input.notes, 2000);
      let recoveredAmountMinor = transaction.recoveredAmountMinor;
      let waivedAmountMinor = transaction.waivedAmountMinor;
      let recoveryStatus: 'OPEN' | 'PARTIAL' | 'RECOVERED' | 'WAIVED';
      if (action === 'RECORD') {
        recoveredAmountMinor += parsePositiveMinorUnits(input.amount);
        if (recoveredAmountMinor + waivedAmountMinor > transaction.expectedRecoveryMinor) throw new FinancialValidationError('Recovery exceeds the recoverable amount.');
        recoveryStatus = recoveredAmountMinor === transaction.expectedRecoveryMinor ? 'RECOVERED' : 'PARTIAL';
      } else {
        waivedAmountMinor = transaction.expectedRecoveryMinor - recoveredAmountMinor;
        if (waivedAmountMinor <= BigInt(0)) throw new FinancialValidationError('No owner recovery balance remains to waive.');
        recoveryStatus = 'WAIVED';
      }
      const updated = await tx.financialTransaction.update({ where: { id: transactionId }, data: { recoveredAmountMinor, waivedAmountMinor, recoveryStatus, recoveryNotes, lastRecoveryAt: now, waivedAt: action === 'WAIVE' ? now : null, waivedByUserId: action === 'WAIVE' ? context.userId : null } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: transaction.companyId, transactionId, actorUserId: context.userId, action: action === 'WAIVE' ? 'OWNER_RECOVERY_WAIVED' : 'OWNER_RECOVERY_RECORDED', before: { recoveredAmountMinor: transaction.recoveredAmountMinor.toString(), waivedAmountMinor: transaction.waivedAmountMinor.toString(), recoveryStatus: transaction.recoveryStatus }, after: { recoveredAmountMinor: recoveredAmountMinor.toString(), waivedAmountMinor: waivedAmountMinor.toString(), recoveryStatus }, metadata: recoveryNotes ? { notes: recoveryNotes } : undefined } });
      return { recoveredAmountMinor: updated.recoveredAmountMinor.toString(), waivedAmountMinor: updated.waivedAmountMinor.toString(), outstandingAmountMinor: (updated.expectedRecoveryMinor - updated.recoveredAmountMinor - updated.waivedAmountMinor).toString(), recoveryStatus: updated.recoveryStatus };
    });
  }

  fingerprint(parts: Array<string | number | bigint | null | undefined>) {
    return createHash('sha256').update(parts.map((part) => String(part ?? '')).join('\u001f')).digest('hex');
  }

  private async lockFinancialRows(database: Prisma.TransactionClient, keys: string[]) {
    for (const key of [...new Set(keys)].sort()) {
      await database.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS lock_result`;
    }
  }

  private async rejectProviderOwnedTransaction(database: Prisma.TransactionClient, transactionId: string) {
    const providerOwned = await database.financialTransaction.findUnique({
      where: { id: transactionId },
      select: { pilotFuelingEvent: { select: { id: true } }, pilotInvoiceAdjustment: { select: { id: true } } },
    });
    if (providerOwned?.pilotFuelingEvent || providerOwned?.pilotInvoiceAdjustment) {
      throw new FinancialConflictError('This transaction belongs to a posted provider invoice and cannot be mutated independently.');
    }
  }

  private requireOwner(context: FinancialAuthorization) {
    if (context.role !== 'OWNER') throw new AuthorizationDeniedError();
  }

  private async validateDimensions(input: { companyId: string | null; sourceId: string | null; categoryId: string | null; customerId: string | null; vendorId: string | null; ownerId: string | null }, context: FinancialAuthorization) {
    if (input.companyId && !context.companyIds.includes(input.companyId)) throw new FinancialValidationError('Company is outside this operating group.');
    const checks: Array<Promise<unknown>> = [];
    if (input.sourceId) checks.push(this.database.financialSource.findFirstOrThrow({ where: { id: input.sourceId, operatingGroupId: context.operatingGroupId } }));
    if (input.categoryId) checks.push(this.database.financialCategory.findFirstOrThrow({ where: { id: input.categoryId, operatingGroupId: context.operatingGroupId, isActive: true } }));
    if (input.customerId) checks.push(this.database.customer.findFirstOrThrow({ where: { id: input.customerId, companyId: { in: context.companyIds } } }));
    for (const partyId of [input.vendorId, input.ownerId]) if (partyId) checks.push(this.database.financialParty.findFirstOrThrow({ where: { id: partyId, operatingGroupId: context.operatingGroupId } }));
    try { await Promise.all(checks); } catch { throw new FinancialValidationError('A financial dimension is outside this operating group.'); }
  }

  private async validateAllocationDimensions(input: Record<string, unknown>, context: FinancialAuthorization, database: PrismaClient = this.database) {
    const companyId = input.companyId as string | null;
    if (companyId && !context.companyIds.includes(companyId)) throw new FinancialValidationError('Allocation company is outside this operating group.');
    const categoryId = input.categoryId as string;
    const category = await database.financialCategory.findFirst({ where: { id: categoryId, operatingGroupId: context.operatingGroupId, isActive: true }, select: { id: true } });
    if (!category) throw new FinancialValidationError('Allocation category is outside this operating group.');
    const dimensions: Array<[string, () => Promise<unknown>]> = [
      ['truckId', () => database.truck.findFirst({ where: { id: input.truckId as string, companyId: { in: context.companyIds } }, select: { id: true } })],
      ['trailerId', () => database.trailer.findFirst({ where: { id: input.trailerId as string, companyId: { in: context.companyIds } }, select: { id: true } })],
      ['driverId', () => database.driver.findFirst({ where: { id: input.driverId as string, companyId: { in: context.companyIds } }, select: { id: true } })],
      ['employeeId', () => database.employee.findFirst({ where: { id: input.employeeId as string, companyId: { in: context.companyIds } }, select: { id: true } })],
      ['loadId', () => database.load.findFirst({ where: { id: input.loadId as string, companyId: { in: context.companyIds } }, select: { id: true } })],
      ['customerId', () => database.customer.findFirst({ where: { id: input.customerId as string, companyId: { in: context.companyIds } }, select: { id: true } })],
      ['partyId', () => database.financialParty.findFirst({ where: { id: input.partyId as string, operatingGroupId: context.operatingGroupId }, select: { id: true } })],
      ['programId', () => database.financialProgram.findFirst({ where: { id: input.programId as string, operatingGroupId: context.operatingGroupId, isActive: true }, select: { id: true } })],
    ];
    for (const [key, lookup] of dimensions) if (input[key] && !(await lookup())) throw new FinancialValidationError(`${key} is outside this operating group.`);
  }

  private async requireCategory(categoryId: string, context: FinancialAuthorization) {
    const category = await this.database.financialCategory.findFirst({ where: { id: categoryId, operatingGroupId: context.operatingGroupId } });
    if (!category) throw new FinancialValidationError('Category is outside this operating group.');
    return category;
  }

  private async categoryDescendantIds(categoryId: string, context: FinancialAuthorization) {
    const categories = await this.database.financialCategory.findMany({ where: { operatingGroupId: context.operatingGroupId }, select: { id: true, parentCategoryId: true } });
    const descendants = new Set<string>();
    let frontier = [categoryId];
    while (frontier.length) {
      const next = categories.filter((category) => category.parentCategoryId && frontier.includes(category.parentCategoryId) && !descendants.has(category.id)).map((category) => category.id);
      next.forEach((id) => descendants.add(id));
      frontier = next;
    }
    return descendants;
  }
}

export const financialControlService = new FinancialControlService();
