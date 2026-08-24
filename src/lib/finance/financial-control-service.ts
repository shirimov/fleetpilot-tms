import { createHash } from 'node:crypto';
import type {
  FinancialCategoryType,
  FinancialDirection,
  FinancialMatchMethod,
  FinancialSourceType,
  FinancialStatementType,
  PrismaClient,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
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

function date(value: unknown, label: string) {
  const parsed = typeof value === 'string' ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new FinancialValidationError(`${label} is invalid.`);
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
      select: { id: true, name: true, type: true, institution: true, provider: true, currency: true, lastFour: true, isActive: true, company: { select: { id: true, name: true } }, _count: { select: { statements: true } } },
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
    return this.database.financialCategory.findMany({ where: { operatingGroupId: context.operatingGroupId }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  }

  async createCategory(input: Record<string, unknown>, context: FinancialAuthorization) {
    return this.database.financialCategory.create({ data: {
      operatingGroupId: context.operatingGroupId,
      name: text(input.name, 'Category name'),
      type: enumValue(input.type, ['INCOME', 'DIRECT_EXPENSE', 'EQUIPMENT_FINANCING', 'OVERHEAD', 'OTHER'] satisfies FinancialCategoryType[], 'Category type'),
    } });
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
    const transactionDate = date(input.transactionDate, 'Transaction date');
    const direction = enumValue(input.direction, ['INFLOW', 'OUTFLOW'] satisfies FinancialDirection[], 'Direction');
    const description = text(input.description, 'Description', 500);
    const reference = optionalText(input.reference);
    const fingerprintSha256 = this.fingerprint([transactionDate.toISOString().slice(0, 10), amountMinor, direction, description.toLowerCase(), reference]);
    await this.validateDimensions({ companyId, sourceId: optionalText(input.sourceId), categoryId: optionalText(input.categoryId), customerId: optionalText(input.customerId), vendorId: optionalText(input.vendorId), ownerId: optionalText(input.ownerId) }, context);
    const duplicate = await this.database.financialTransaction.findFirst({ where: { operatingGroupId: context.operatingGroupId, fingerprintSha256, status: { not: 'VOIDED' } }, select: { id: true } });
    return this.database.$transaction(async (tx) => {
      const transaction = await tx.financialTransaction.create({ data: {
        operatingGroupId: context.operatingGroupId, companyId,
        sourceId: optionalText(input.sourceId), transactionDate,
        amountMinor, currency: normalizeCurrency(input.currency ?? 'USD'),
        direction, description, categoryId: optionalText(input.categoryId),
        customerId: optionalText(input.customerId), vendorId: optionalText(input.vendorId), ownerId: optionalText(input.ownerId),
        reference, memo: optionalText(input.memo, 2000), createdByUserId: context.userId, fingerprintSha256,
        reconciliationStatus: duplicate ? 'DUPLICATE_SUSPECTED' : 'UNREVIEWED',
        recoverableFromOwner: input.recoverableFromOwner === true,
        expectedRecoveryMinor: input.recoverableFromOwner === true ? parsePositiveMinorUnits(input.expectedRecoveryAmount ?? input.amount) : BigInt(0),
        recoveryStatus: input.recoverableFromOwner === true ? 'EXPECTED' : 'NOT_APPLICABLE',
      } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId, transactionId: transaction.id, actorUserId: context.userId, action: 'TRANSACTION_CREATED', after: { amountMinor: amountMinor.toString() } } });
      return { ...transaction, amountMinor: transaction.amountMinor.toString(), expectedRecoveryMinor: transaction.expectedRecoveryMinor.toString(), recoveredAmountMinor: transaction.recoveredAmountMinor.toString() };
    });
  }

  async listTransactions(context: FinancialAuthorization) {
    const transactions = await this.database.financialTransaction.findMany({
      where: { operatingGroupId: context.operatingGroupId, status: { not: 'VOIDED' } }, orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      include: { category: { select: { id: true, name: true } }, source: { select: { id: true, name: true } }, allocations: { select: { amountMinor: true } }, evidence: { select: { matchedAmountMinor: true } } },
    });
    return transactions.map((transaction) => ({ ...transaction,
      amountMinor: transaction.amountMinor.toString(), expectedRecoveryMinor: transaction.expectedRecoveryMinor.toString(), recoveredAmountMinor: transaction.recoveredAmountMinor.toString(),
      allocatedMinor: transaction.allocations.reduce((sum, item) => sum + item.amountMinor, BigInt(0)).toString(),
      evidenceMatchedMinor: transaction.evidence.reduce((sum, item) => sum + item.matchedAmountMinor, BigInt(0)).toString(),
      allocations: undefined, evidence: undefined,
    }));
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
    const expectedDateStart = date(input.expectedDateStart, 'Expected start date');
    const expectedDateEnd = date(input.expectedDateEnd ?? input.expectedDateStart, 'Expected end date');
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
      const [expectation, transaction] = await Promise.all([
        tx.financialExpectation.findFirst({ where: { id: expectationId, operatingGroupId: context.operatingGroupId }, select: { expectedAmountMinor: true, matchedAmountMinor: true, direction: true } }),
        tx.financialTransaction.findFirst({ where: { id: transactionId, operatingGroupId: context.operatingGroupId }, select: { amountMinor: true, direction: true } }),
      ]);
      if (!expectation || !transaction) throw new FinancialNotFoundError();
      if (expectation.direction !== transaction.direction) throw new FinancialValidationError('Expected and actual directions must match.');
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
      const transaction = await tx.financialTransaction.findFirst({ where: { id: transactionId, operatingGroupId: context.operatingGroupId }, select: { id: true, amountMinor: true } });
      const record = await tx.financialImportRecord.findFirst({ where: { id: importRecordId, statement: { operatingGroupId: context.operatingGroupId } }, select: { id: true, candidateAmountMinor: true } });
      if (!transaction || !record) throw new FinancialNotFoundError();
      const [transactionMatched, recordMatched] = await Promise.all([
        tx.financialTransactionEvidence.aggregate({ where: { transactionId, role: 'PRIMARY' }, _sum: { matchedAmountMinor: true } }),
        tx.financialTransactionEvidence.aggregate({ where: { importRecordId }, _sum: { matchedAmountMinor: true } }),
      ]);
      if (role === 'PRIMARY' && (transactionMatched._sum.matchedAmountMinor ?? BigInt(0)) + matchedAmountMinor > transaction.amountMinor) throw new FinancialValidationError('Match exceeds the transaction amount.');
      if (record.candidateAmountMinor && (recordMatched._sum.matchedAmountMinor ?? BigInt(0)) + matchedAmountMinor > record.candidateAmountMinor) throw new FinancialValidationError('Match exceeds the imported record amount.');
      const evidence = await tx.financialTransactionEvidence.create({ data: { transactionId, importRecordId, matchedAmountMinor, method, role, confidenceBasisPoints: typeof input.confidenceBasisPoints === 'number' ? input.confidenceBasisPoints : null, matchedByUserId: context.userId } });
      const total = (transactionMatched._sum.matchedAmountMinor ?? BigInt(0)) + (role === 'PRIMARY' ? matchedAmountMinor : BigInt(0));
      await tx.financialTransaction.update({ where: { id: transactionId }, data: { reconciliationStatus: total === transaction.amountMinor ? 'MATCHED' : 'PARTIALLY_MATCHED' } });
      await tx.financialImportRecord.update({ where: { id: importRecordId }, data: { status: record.candidateAmountMinor && (recordMatched._sum.matchedAmountMinor ?? BigInt(0)) + matchedAmountMinor === record.candidateAmountMinor ? 'MATCHED' : 'PARTIALLY_MATCHED' } });
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: context.activeCompanyId, transactionId, actorUserId: context.userId, action: 'EVIDENCE_MATCHED', metadata: { importRecordId, matchedAmountMinor: matchedAmountMinor.toString(), method } } });
      return { ...evidence, matchedAmountMinor: evidence.matchedAmountMinor.toString() };
    });
  }

  async replaceAllocations(transactionId: string, rawAllocations: unknown, context: FinancialAuthorization) {
    if (!Array.isArray(rawAllocations) || rawAllocations.length === 0) throw new FinancialValidationError('At least one allocation is required.');
    return this.database.$transaction(async (tx) => {
      const transaction = await tx.financialTransaction.findFirst({ where: { id: transactionId, operatingGroupId: context.operatingGroupId }, select: { id: true, amountMinor: true, companyId: true, reconciliationStatus: true } });
      if (!transaction) throw new FinancialNotFoundError();
      if (transaction.reconciliationStatus === 'RECONCILED') throw new FinancialConflictError('Reconciled allocations require an explicit review workflow.');
      const allocations = await Promise.all(rawAllocations.map(async (raw) => {
        if (!raw || typeof raw !== 'object') throw new FinancialValidationError('Allocation is invalid.');
        const input = raw as Record<string, unknown>;
        const allocation = { amountMinor: parsePositiveMinorUnits(input.amount), categoryId: text(input.categoryId, 'Category ID'), companyId: optionalText(input.companyId) ?? transaction.companyId, truckId: optionalText(input.truckId), trailerId: optionalText(input.trailerId), driverId: optionalText(input.driverId), employeeId: optionalText(input.employeeId), loadId: optionalText(input.loadId), customerId: optionalText(input.customerId), partyId: optionalText(input.partyId), businessType: optionalText(input.businessType), memo: optionalText(input.memo, 1000) };
        await this.validateAllocationDimensions(allocation, context, tx as unknown as PrismaClient);
        return allocation;
      }));
      const total = allocations.reduce((sum, allocation) => sum + allocation.amountMinor, BigInt(0));
      if (total !== transaction.amountMinor) throw new FinancialValidationError('Allocations must exactly equal the transaction amount.');
      await tx.financialAllocation.deleteMany({ where: { transactionId } });
      await tx.financialAllocation.createMany({ data: allocations.map((allocation) => ({ ...allocation, transactionId })) });
      const evidence = await tx.financialTransactionEvidence.aggregate({ where: { transactionId, role: 'PRIMARY' }, _sum: { matchedAmountMinor: true } });
      if ((evidence._sum.matchedAmountMinor ?? BigInt(0)) === transaction.amountMinor) {
        await tx.financialTransaction.update({ where: { id: transactionId }, data: { reconciliationStatus: 'RECONCILED', dataStatus: 'VERIFIED', reviewedByUserId: context.userId, reviewedAt: new Date() } });
      }
      await tx.financialAuditEvent.create({ data: { operatingGroupId: context.operatingGroupId, companyId: transaction.companyId, transactionId, actorUserId: context.userId, action: 'ALLOCATIONS_REPLACED', metadata: { totalMinor: total.toString(), allocationCount: allocations.length } } });
      return { allocationCount: allocations.length, totalMinor: total.toString() };
    });
  }

  async overview(context: FinancialAuthorization) {
    const [transactions, statements, missingExpectations] = await Promise.all([
      this.database.financialTransaction.findMany({ where: { operatingGroupId: context.operatingGroupId, status: { not: 'VOIDED' } }, select: { amountMinor: true, direction: true, reconciliationStatus: true, categoryId: true, allocations: { select: { id: true } }, recoverableFromOwner: true, recoveryStatus: true } }),
      this.database.financialStatement.count({ where: { operatingGroupId: context.operatingGroupId } }),
      this.database.financialExpectation.count({ where: { operatingGroupId: context.operatingGroupId, status: { in: ['OPEN', 'PARTIALLY_MATCHED', 'MISSING'] } } }),
    ]);
    const inflowMinor = transactions.filter((item) => item.direction === 'INFLOW').reduce((sum, item) => sum + item.amountMinor, BigInt(0));
    const outflowMinor = transactions.filter((item) => item.direction === 'OUTFLOW').reduce((sum, item) => sum + item.amountMinor, BigInt(0));
    const reconciledMinor = transactions.filter((item) => item.reconciliationStatus === 'RECONCILED').reduce((sum, item) => sum + item.amountMinor, BigInt(0));
    const totalMinor = inflowMinor + outflowMinor;
    const unresolvedMinor = totalMinor - reconciledMinor;
    const exceptions = {
      unmatchedInflows: transactions.filter((item) => item.direction === 'INFLOW' && ['UNREVIEWED', 'UNMATCHED', 'NEEDS_REVIEW'].includes(item.reconciliationStatus)).length,
      unmatchedOutflows: transactions.filter((item) => item.direction === 'OUTFLOW' && ['UNREVIEWED', 'UNMATCHED', 'NEEDS_REVIEW'].includes(item.reconciliationStatus)).length,
      partialMatches: transactions.filter((item) => item.reconciliationStatus === 'PARTIALLY_MATCHED').length,
      possibleDuplicates: transactions.filter((item) => item.reconciliationStatus === 'DUPLICATE_SUSPECTED').length,
      uncategorizedExpenses: transactions.filter((item) => item.direction === 'OUTFLOW' && !item.categoryId).length,
      missingAssignments: transactions.filter((item) => item.direction === 'OUTFLOW' && item.allocations.length === 0).length,
      ownerRecovery: transactions.filter((item) => item.recoverableFromOwner && item.recoveryStatus !== 'RECOVERED').length,
      missingExpected: missingExpectations,
    };
    return { inflowMinor: inflowMinor.toString(), outflowMinor: outflowMinor.toString(), reconciledMinor: reconciledMinor.toString(), unresolvedMinor: unresolvedMinor.toString(), reconciliationBasisPoints: totalMinor === BigInt(0) ? null : Number((reconciledMinor * BigInt(10000)) / totalMinor), unresolvedTransactionCount: transactions.filter((item) => item.reconciliationStatus !== 'RECONCILED').length, statementsImported: statements, exceptions };
  }

  fingerprint(parts: Array<string | number | bigint | null | undefined>) {
    return createHash('sha256').update(parts.map((part) => String(part ?? '')).join('\u001f')).digest('hex');
  }

  private async validateDimensions(input: { companyId: string | null; sourceId: string | null; categoryId: string | null; customerId: string | null; vendorId: string | null; ownerId: string | null }, context: FinancialAuthorization) {
    if (input.companyId && !context.companyIds.includes(input.companyId)) throw new FinancialValidationError('Company is outside this operating group.');
    const checks: Array<Promise<unknown>> = [];
    if (input.sourceId) checks.push(this.database.financialSource.findFirstOrThrow({ where: { id: input.sourceId, operatingGroupId: context.operatingGroupId } }));
    if (input.categoryId) checks.push(this.database.financialCategory.findFirstOrThrow({ where: { id: input.categoryId, operatingGroupId: context.operatingGroupId } }));
    if (input.customerId) checks.push(this.database.customer.findFirstOrThrow({ where: { id: input.customerId, companyId: { in: context.companyIds } } }));
    for (const partyId of [input.vendorId, input.ownerId]) if (partyId) checks.push(this.database.financialParty.findFirstOrThrow({ where: { id: partyId, operatingGroupId: context.operatingGroupId } }));
    try { await Promise.all(checks); } catch { throw new FinancialValidationError('A financial dimension is outside this operating group.'); }
  }

  private async validateAllocationDimensions(input: Record<string, unknown>, context: FinancialAuthorization, database: PrismaClient = this.database) {
    const companyId = input.companyId as string | null;
    if (companyId && !context.companyIds.includes(companyId)) throw new FinancialValidationError('Allocation company is outside this operating group.');
    const categoryId = input.categoryId as string;
    const category = await database.financialCategory.findFirst({ where: { id: categoryId, operatingGroupId: context.operatingGroupId }, select: { id: true } });
    if (!category) throw new FinancialValidationError('Allocation category is outside this operating group.');
    const dimensions: Array<[string, () => Promise<unknown>]> = [
      ['truckId', () => database.truck.findFirst({ where: { id: input.truckId as string, companyId: { in: context.companyIds } }, select: { id: true } })],
      ['trailerId', () => database.trailer.findFirst({ where: { id: input.trailerId as string, companyId: { in: context.companyIds } }, select: { id: true } })],
      ['driverId', () => database.driver.findFirst({ where: { id: input.driverId as string, companyId: { in: context.companyIds } }, select: { id: true } })],
      ['employeeId', () => database.employee.findFirst({ where: { id: input.employeeId as string, companyId: { in: context.companyIds } }, select: { id: true } })],
      ['loadId', () => database.load.findFirst({ where: { id: input.loadId as string, companyId: { in: context.companyIds } }, select: { id: true } })],
      ['customerId', () => database.customer.findFirst({ where: { id: input.customerId as string, companyId: { in: context.companyIds } }, select: { id: true } })],
      ['partyId', () => database.financialParty.findFirst({ where: { id: input.partyId as string, operatingGroupId: context.operatingGroupId }, select: { id: true } })],
    ];
    for (const [key, lookup] of dimensions) if (input[key] && !(await lookup())) throw new FinancialValidationError(`${key} is outside this operating group.`);
  }
}

export const financialControlService = new FinancialControlService();
