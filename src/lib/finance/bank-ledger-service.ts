import { createHash } from 'node:crypto';
import type {
  BankClassificationScope,
  BankReconciliationStatus,
  BankTransactionReviewStatus,
  FinancialDirection,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { FinancialAuthorization } from './financial-control-authorization';
import {
  BankLedgerNotFoundError,
  BankLedgerValidationError,
} from './bank-ledger-errors';
import type { BankAllocationInput, BankProviderTransaction } from './bank-ledger-types';

type TransactionClient = Prisma.TransactionClient;

type ClassificationInput = {
  categoryId: string | null;
  scope: BankClassificationScope;
  reviewStatus: BankTransactionReviewStatus;
  reconciliationStatus?: BankReconciliationStatus;
  notes?: string | null;
  allocations: BankAllocationInput[];
};

type TransactionFilters = {
  companyId?: string;
  bankAccountId?: string;
  subAccountId?: string;
  reviewStatus?: BankTransactionReviewStatus;
  direction?: FinancialDirection;
  categoryId?: string;
  truckId?: string;
  trailerId?: string;
  driverId?: string;
  partyId?: string;
  from?: Date;
  to?: Date;
  minimumAmountMinor?: bigint;
  maximumAmountMinor?: bigint;
  query?: string;
};

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sourceHash(source: BankProviderTransaction) {
  return createHash('sha256')
    .update(JSON.stringify({
      ...source,
      amountMinor: source.amountMinor.toString(),
      authorizedDate: source.authorizedDate?.toISOString().slice(0, 10) ?? null,
      postedDate: source.postedDate?.toISOString().slice(0, 10) ?? null,
    }))
    .digest('hex');
}

function sourceDate(source: BankProviderTransaction) {
  return source.postedDate ?? source.authorizedDate ?? new Date();
}

function sourceData(
  source: BankProviderTransaction,
  connection: { id: string; companyId: string | null },
  subAccountId: string,
) {
  const amountMinor = source.amountMinor < BigInt(0) ? -source.amountMinor : source.amountMinor;
  return {
    bankAccountId: connection.id,
    subAccountId,
    companyId: connection.companyId,
    providerTransactionId: source.externalId,
    providerPendingTransactionId: source.pendingExternalId ?? null,
    plaidTransactionId: null,
    date: sourceDate(source),
    authorizedDate: source.authorizedDate ?? null,
    postedDate: source.postedDate ?? null,
    amount: Number(amountMinor) / 100,
    amountMinor,
    providerAmountText: source.providerAmountText,
    currency: source.currency,
    direction: source.direction,
    name: source.originalDescription,
    originalDescription: source.originalDescription,
    merchantName: source.merchantName ?? null,
    providerCategory: jsonValue(source.providerCategory),
    pending: source.pending,
    lifecycle: source.pending ? 'PENDING' as const : 'POSTED' as const,
    checkNumber: source.checkNumber ?? null,
    referenceNumber: source.referenceNumber ?? null,
    location: jsonValue(source.location),
    sourceMetadata: jsonValue(source.sourceMetadata),
    sourceHashSha256: sourceHash(source),
    lastSeenAt: new Date(),
  };
}

export class BankLedgerService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async listConnections(context: FinancialAuthorization, companyId = context.activeCompanyId) {
    this.requireAllowedCompany(context, companyId);
    const rows = await this.database.bankAccount.findMany({
      where: { companyId },
      select: {
        id: true,
        companyId: true,
        provider: true,
        institutionId: true,
        institutionName: true,
        status: true,
        lastSync: true,
        lastSyncAttemptAt: true,
        lastSyncErrorCode: true,
        lastSyncErrorMessage: true,
        accounts: {
          select: {
            id: true,
            institutionName: true,
            name: true,
            officialName: true,
            type: true,
            subtype: true,
            mask: true,
            currency: true,
            currentBalanceMinor: true,
            availableBalanceMinor: true,
            isActive: true,
            lastSyncedAt: true,
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        },
        _count: { select: { transactions: true } },
      },
      orderBy: [{ institutionName: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => ({
      ...row,
      accounts: row.accounts.map((account) => ({
        ...account,
        currentBalanceMinor: account.currentBalanceMinor?.toString() ?? null,
        availableBalanceMinor: account.availableBalanceMinor?.toString() ?? null,
      })),
    }));
  }

  async listTransactions(context: FinancialAuthorization, filters: TransactionFilters = {}) {
    const companyId = filters.companyId ?? context.activeCompanyId;
    this.requireAllowedCompany(context, companyId);
    const rows = await this.database.bankTransaction.findMany({
      where: {
        companyId,
        ...(filters.bankAccountId ? { bankAccountId: filters.bankAccountId } : {}),
        ...(filters.subAccountId ? { subAccountId: filters.subAccountId } : {}),
        ...(filters.direction ? { direction: filters.direction } : {}),
        ...(filters.minimumAmountMinor !== undefined || filters.maximumAmountMinor !== undefined
          ? {
              amountMinor: {
                ...(filters.minimumAmountMinor !== undefined ? { gte: filters.minimumAmountMinor } : {}),
                ...(filters.maximumAmountMinor !== undefined ? { lte: filters.maximumAmountMinor } : {}),
              },
            }
          : {}),
        ...(filters.from || filters.to
          ? { date: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
          : {}),
        ...(filters.query
          ? {
              OR: [
                { originalDescription: { contains: filters.query, mode: 'insensitive' } },
                { merchantName: { contains: filters.query, mode: 'insensitive' } },
                { referenceNumber: { contains: filters.query, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(filters.reviewStatus ? { classification: { reviewStatus: filters.reviewStatus } } : {}),
        ...(filters.categoryId ? { classification: { categoryId: filters.categoryId } } : {}),
        ...(filters.truckId ? { allocations: { some: { truckId: filters.truckId } } } : {}),
        ...(filters.trailerId ? { allocations: { some: { trailerId: filters.trailerId } } } : {}),
        ...(filters.driverId ? { allocations: { some: { driverId: filters.driverId } } } : {}),
        ...(filters.partyId ? { allocations: { some: { partyId: filters.partyId } } } : {}),
      },
      include: {
        bankAccount: { select: { institutionName: true, provider: true } },
        subAccount: { select: { name: true, mask: true, type: true, subtype: true } },
        classification: { include: { category: { select: { id: true, name: true } } } },
        allocations: {
          include: {
            category: { select: { id: true, name: true } },
            truck: { select: { id: true, unitNumber: true } },
            trailer: { select: { id: true, unitNumber: true } },
            driver: { select: { id: true, firstName: true, lastName: true } },
            party: { select: { id: true, name: true, type: true } },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    return rows.map((row) => ({
      ...row,
      amountMinor: row.amountMinor?.toString() ?? null,
      allocations: row.allocations.map((allocation) => ({
        ...allocation,
        amountMinor: allocation.amountMinor.toString(),
      })),
    }));
  }

  async getClassificationOptions(context: FinancialAuthorization, companyId = context.activeCompanyId) {
    this.requireAllowedCompany(context, companyId);
    const [companies, categories, trucks, trailers, drivers, parties, accounts] = await Promise.all([
      this.database.company.findMany({
        where: { id: { in: context.companyIds } },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.database.financialCategory.findMany({
        where: { operatingGroupId: context.operatingGroupId, isActive: true },
        select: { id: true, name: true, type: true, parentCategoryId: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.database.truck.findMany({
        where: { companyId, status: { not: 'INACTIVE' } },
        select: { id: true, unitNumber: true },
        orderBy: { unitNumber: 'asc' },
      }),
      this.database.trailer.findMany({
        where: { companyId, status: { not: 'INACTIVE' } },
        select: { id: true, unitNumber: true },
        orderBy: { unitNumber: 'asc' },
      }),
      this.database.driver.findMany({
        where: { companyId },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.database.financialParty.findMany({
        where: {
          operatingGroupId: context.operatingGroupId,
          isActive: true,
          OR: [{ companyId }, { companyId: null }],
        },
        select: { id: true, name: true, type: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.database.bankSubAccount.findMany({
        where: { bankAccount: { companyId }, isActive: true },
        select: { id: true, name: true, mask: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return { activeCompanyId: context.activeCompanyId, companies, categories, trucks, trailers, drivers, parties, accounts };
  }

  async ingestTransactions(
    context: FinancialAuthorization,
    bankAccountId: string,
    sources: BankProviderTransaction[],
  ) {
    return this.database.$transaction(async (transaction) => {
      const connection = await transaction.bankAccount.findFirst({
        where: {
          id: bankAccountId,
          companyId: { in: context.companyIds },
          status: { in: ['ACTIVE', 'ERROR'] },
        },
        select: {
          id: true,
          companyId: true,
          accounts: { select: { id: true, externalAccountId: true, plaidAccountId: true } },
        },
      });
      if (!connection?.companyId) throw new BankLedgerNotFoundError();
      const accountMap = new Map<string, string>();
      for (const account of connection.accounts) {
        if (account.externalAccountId) accountMap.set(account.externalAccountId, account.id);
        if (account.plaidAccountId) accountMap.set(account.plaidAccountId, account.id);
      }
      let created = 0;
      let updated = 0;
      for (const source of sources) {
        this.validateSource(source);
        const subAccountId = accountMap.get(source.externalAccountId);
        if (!subAccountId) throw new BankLedgerValidationError('Bank transaction references an unknown account.');
        const currentIdentity = await transaction.bankTransactionExternalId.findUnique({
          where: { bankAccountId_externalId: { bankAccountId, externalId: source.externalId } },
          select: { bankTransactionId: true },
        });
        const pendingIdentity = !currentIdentity && source.pendingExternalId
          ? await transaction.bankTransactionExternalId.findUnique({
              where: { bankAccountId_externalId: { bankAccountId, externalId: source.pendingExternalId } },
              select: { bankTransactionId: true },
            })
          : null;
        const existingId = currentIdentity?.bankTransactionId ?? pendingIdentity?.bankTransactionId;
        if (existingId) {
          const before = await transaction.bankTransaction.findUniqueOrThrow({
            where: { id: existingId },
            select: { lifecycle: true, providerTransactionId: true, sourceHashSha256: true },
          });
          await transaction.bankTransaction.update({
            where: { id: existingId },
            data: sourceData(source, connection, subAccountId),
          });
          await transaction.bankTransactionExternalId.updateMany({
            where: { bankTransactionId: existingId },
            data: { isCurrent: false, lastSeenAt: new Date() },
          });
          await transaction.bankTransactionExternalId.upsert({
            where: { bankAccountId_externalId: { bankAccountId, externalId: source.externalId } },
            create: { bankAccountId, bankTransactionId: existingId, externalId: source.externalId },
            update: { isCurrent: true, lastSeenAt: new Date() },
          });
          if (
            before.lifecycle !== (source.pending ? 'PENDING' : 'POSTED') ||
            before.providerTransactionId !== source.externalId ||
            before.sourceHashSha256 !== sourceHash(source)
          ) {
            await this.auditSourceChange(transaction, context, connection.companyId, existingId, before, source);
          }
          updated += 1;
          continue;
        }
        const createdTransaction = await transaction.bankTransaction.create({
          data: {
            ...sourceData(source, connection, subAccountId),
            classification: {
              create: source.providerCategory
                ? {
                    reviewStatus: 'SUGGESTED',
                    suggestionReason: 'Provider supplied a category for review.',
                  }
                : {},
            },
            externalIds: {
              create: { bankAccountId, externalId: source.externalId },
            },
          },
          select: { id: true },
        });
        await transaction.financialAuditEvent.create({
          data: {
            operatingGroupId: context.operatingGroupId,
            companyId: connection.companyId,
            bankTransactionId: createdTransaction.id,
            actorUserId: context.userId,
            action: 'BANK_TRANSACTION_INGESTED',
            metadata: { providerTransactionIdHash: createHash('sha256').update(source.externalId).digest('hex') },
          },
        });
        created += 1;
      }
      return { created, updated, total: sources.length };
    }, { isolationLevel: 'Serializable' });
  }

  async markRemoved(
    context: FinancialAuthorization,
    bankAccountId: string,
    externalIds: string[],
  ) {
    return this.database.$transaction(async (transaction) => {
      const connection = await transaction.bankAccount.findFirst({
        where: { id: bankAccountId, companyId: { in: context.companyIds } },
        select: { id: true, companyId: true },
      });
      if (!connection?.companyId) throw new BankLedgerNotFoundError();
      let removed = 0;
      for (const externalId of externalIds) {
        const identity = await transaction.bankTransactionExternalId.findUnique({
          where: { bankAccountId_externalId: { bankAccountId, externalId } },
          select: { bankTransactionId: true, isCurrent: true },
        });
        // Providers can return a pending ID as removed in the same update that
        // adds its posted replacement. That historical identity is retained but
        // must not mark the newly-posted canonical row as removed.
        if (!identity?.isCurrent) continue;
        await transaction.bankTransaction.update({
          where: { id: identity.bankTransactionId },
          data: { lifecycle: 'REMOVED', removedAt: new Date(), lastSeenAt: new Date() },
        });
        await transaction.financialAuditEvent.create({
          data: {
            operatingGroupId: context.operatingGroupId,
            companyId: connection.companyId,
            bankTransactionId: identity.bankTransactionId,
            actorUserId: context.userId,
            action: 'BANK_TRANSACTION_REMOVED_BY_PROVIDER',
          },
        });
        removed += 1;
      }
      return { removed };
    }, { isolationLevel: 'Serializable' });
  }

  async classifyTransaction(
    context: FinancialAuthorization,
    bankTransactionId: string,
    input: ClassificationInput,
  ) {
    return this.database.$transaction(async (transaction) => {
      const bankTransaction = await transaction.bankTransaction.findFirst({
        where: { id: bankTransactionId, companyId: { in: context.companyIds } },
        include: { classification: true, allocations: true },
      });
      if (!bankTransaction?.companyId || bankTransaction.amountMinor === null) {
        throw new BankLedgerNotFoundError();
      }
      if (input.categoryId) {
        const category = await transaction.financialCategory.findFirst({
          where: { id: input.categoryId, operatingGroupId: context.operatingGroupId, isActive: true },
          select: { id: true },
        });
        if (!category) throw new BankLedgerValidationError('Category is invalid.');
      }
      await this.validateAllocations(transaction, context, bankTransaction.companyId, input.allocations);
      const allocationTotal = input.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, BigInt(0));
      if (allocationTotal > bankTransaction.amountMinor) {
        throw new BankLedgerValidationError('Allocations cannot exceed the bank transaction amount.');
      }
      if (input.scope === 'COMPANY_LEVEL' && input.allocations.length) {
        throw new BankLedgerValidationError('Company-level classification cannot include entity allocations.');
      }
      if (input.scope === 'ENTITY_ALLOCATED' && !input.allocations.length) {
        throw new BankLedgerValidationError('Entity-allocated classification requires at least one allocation.');
      }
      if (input.reviewStatus === 'REVIEWED') {
        if (!input.categoryId) throw new BankLedgerValidationError('Reviewed transactions require a category.');
        if (input.scope === 'ENTITY_ALLOCATED' && allocationTotal !== bankTransaction.amountMinor) {
          throw new BankLedgerValidationError('Reviewed entity allocations must equal the transaction amount.');
        }
      }
      const before = {
        classification: bankTransaction.classification,
        allocations: bankTransaction.allocations.map((allocation) => ({
          ...allocation,
          amountMinor: allocation.amountMinor.toString(),
        })),
      };
      await transaction.bankTransactionAllocation.deleteMany({ where: { bankTransactionId } });
      if (input.allocations.length) {
        await transaction.bankTransactionAllocation.createMany({
          data: input.allocations.map((allocation) => ({
            bankTransactionId,
            amountMinor: allocation.amountMinor,
            categoryId: allocation.categoryId,
            companyId: bankTransaction.companyId!,
            truckId: allocation.truckId ?? null,
            trailerId: allocation.trailerId ?? null,
            driverId: allocation.driverId ?? null,
            partyId: allocation.partyId ?? null,
            memo: allocation.memo?.trim() || null,
          })),
        });
      }
      const reviewed = ['REVIEWED', 'IGNORED'].includes(input.reviewStatus);
      const classification = await transaction.bankTransactionClassification.upsert({
        where: { bankTransactionId },
        create: {
          bankTransactionId,
          categoryId: input.categoryId,
          scope: input.scope,
          reviewStatus: input.reviewStatus,
          reconciliationStatus: input.reconciliationStatus ?? 'UNMATCHED',
          notes: input.notes?.trim() || null,
          reviewedByUserId: reviewed ? context.userId : null,
          reviewedAt: reviewed ? new Date() : null,
        },
        update: {
          categoryId: input.categoryId,
          scope: input.scope,
          reviewStatus: input.reviewStatus,
          reconciliationStatus: input.reconciliationStatus ?? 'UNMATCHED',
          notes: input.notes?.trim() || null,
          reviewedByUserId: reviewed ? context.userId : null,
          reviewedAt: reviewed ? new Date() : null,
        },
      });
      await transaction.financialAuditEvent.create({
        data: {
          operatingGroupId: context.operatingGroupId,
          companyId: bankTransaction.companyId,
          bankTransactionId,
          actorUserId: context.userId,
          action: 'BANK_TRANSACTION_CLASSIFICATION_CHANGED',
          before: jsonValue(before),
          after: jsonValue({
            classification,
            allocations: input.allocations.map((allocation) => ({
              ...allocation,
              amountMinor: allocation.amountMinor.toString(),
            })),
          }),
        },
      });
      return classification;
    }, { isolationLevel: 'Serializable' });
  }

  private requireAllowedCompany(context: FinancialAuthorization, companyId: string) {
    if (!context.companyIds.includes(companyId)) throw new BankLedgerNotFoundError();
  }

  private validateSource(source: BankProviderTransaction) {
    if (!source.externalId.trim() || !source.externalAccountId.trim()) {
      throw new BankLedgerValidationError('Provider transaction and account IDs are required.');
    }
    if (!['INFLOW', 'OUTFLOW', 'TRANSFER'].includes(source.direction)) {
      throw new BankLedgerValidationError('Bank transaction direction is invalid.');
    }
    if (!source.originalDescription.trim()) {
      throw new BankLedgerValidationError('Original bank description is required.');
    }
  }

  private async validateAllocations(
    transaction: TransactionClient,
    context: FinancialAuthorization,
    companyId: string,
    allocations: BankAllocationInput[],
  ) {
    for (const allocation of allocations) {
      if (allocation.amountMinor <= BigInt(0)) {
        throw new BankLedgerValidationError('Allocation amounts must be positive.');
      }
      const category = await transaction.financialCategory.findFirst({
        where: { id: allocation.categoryId, operatingGroupId: context.operatingGroupId, isActive: true },
        select: { id: true },
      });
      if (!category) throw new BankLedgerValidationError('Allocation category is invalid.');
      const checks = [
        allocation.truckId
          ? transaction.truck.findFirst({ where: { id: allocation.truckId, companyId }, select: { id: true } })
          : null,
        allocation.trailerId
          ? transaction.trailer.findFirst({ where: { id: allocation.trailerId, companyId }, select: { id: true } })
          : null,
        allocation.driverId
          ? transaction.driver.findFirst({ where: { id: allocation.driverId, companyId }, select: { id: true } })
          : null,
        allocation.partyId
          ? transaction.financialParty.findFirst({
              where: {
                id: allocation.partyId,
                operatingGroupId: context.operatingGroupId,
                OR: [{ companyId }, { companyId: null }],
              },
              select: { id: true },
            })
          : null,
      ];
      const results = await Promise.all(checks.map((check) => check ?? Promise.resolve({ id: 'unused' })));
      if (results.some((result) => !result)) {
        throw new BankLedgerValidationError('An entity assignment is invalid for this company.');
      }
    }
  }

  private async auditSourceChange(
    transaction: TransactionClient,
    context: FinancialAuthorization,
    companyId: string,
    bankTransactionId: string,
    before: { lifecycle: string; providerTransactionId: string | null; sourceHashSha256: string | null },
    source: BankProviderTransaction,
  ) {
    await transaction.financialAuditEvent.create({
      data: {
        operatingGroupId: context.operatingGroupId,
        companyId,
        bankTransactionId,
        actorUserId: context.userId,
        action: before.lifecycle === 'PENDING' && !source.pending
          ? 'BANK_TRANSACTION_PENDING_POSTED'
          : 'BANK_TRANSACTION_SOURCE_REFRESHED',
        before: jsonValue({ lifecycle: before.lifecycle, sourceHashSha256: before.sourceHashSha256 }),
        after: jsonValue({
          lifecycle: source.pending ? 'PENDING' : 'POSTED',
          sourceHashSha256: sourceHash(source),
        }),
      },
    });
  }
}

export const bankLedgerService = new BankLedgerService();
