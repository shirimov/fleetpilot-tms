import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { FinancialAuthorization } from './financial-control-authorization';
import { BankLedgerNotFoundError, BankProviderUnavailableError } from './bank-ledger-errors';
import { BankLedgerService, bankLedgerService } from './bank-ledger-service';
import type { BankProviderAdapter } from './bank-ledger-types';
import { decryptBankAccessToken } from './bank-token-crypto';
import { PlaidBankProviderAdapter } from './plaid-bank-adapter';

const MAX_SYNC_PAGES = 20;
const activeSyncs = new Map<string, Promise<BankSyncResult>>();

type BalanceSyncResult =
  | { status: 'unsupported' }
  | { status: 'updated'; accountCount: number; refreshedAt: Date }
  | { status: 'failed'; code: string; message: string };

type BankSyncResult = {
  added: number;
  updated: number;
  removed: number;
  cursor: string | null;
  balance?: BalanceSyncResult;
};

function sanitizeProviderFailure(error: unknown) {
  const providerCode =
    error && typeof error === 'object' && 'response' in error
      ? (error as { response?: { data?: { error_code?: unknown } } }).response?.data?.error_code
      : undefined;
  const reauthenticationRequired = providerCode === 'ITEM_LOGIN_REQUIRED';
  const code =
    reauthenticationRequired
      ? 'LOGIN_REQUIRED'
      : error && typeof error === 'object' && 'response' in error
      ? 'PROVIDER_REQUEST_FAILED'
      : error instanceof BankProviderUnavailableError
        ? 'PROVIDER_NOT_CONFIGURED'
        : 'PROVIDER_SYNC_FAILED';
  return {
    code,
    message: reauthenticationRequired
      ? 'Bank login requires reauthentication.'
      : 'Bank transaction synchronization failed.',
    status: reauthenticationRequired ? 'REQUIRES_REAUTH' as const : 'ERROR' as const,
  };
}

function balanceFailure(error: unknown) {
  const failure = sanitizeProviderFailure(error);
  return {
    code: failure.code === 'LOGIN_REQUIRED' ? failure.code : 'BALANCE_REFRESH_FAILED',
    message: failure.code === 'LOGIN_REQUIRED'
      ? failure.message
      : 'Transactions may be current, but bank balances could not be refreshed.',
    status: failure.status,
  };
}

function balanceNumber(value: bigint | null) {
  return value === null ? null : Number(value) / 100;
}

export class BankSyncService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly ledger: BankLedgerService = bankLedgerService,
    private readonly adapters: Map<string, BankProviderAdapter> = new Map([
      ['PLAID', new PlaidBankProviderAdapter()],
    ]),
  ) {}

  async syncNow(context: FinancialAuthorization, bankAccountId: string) {
    const authorized = await this.database.bankAccount.count({
      where: {
        id: bankAccountId,
        companyId: { in: context.companyIds },
        status: { in: ['ACTIVE', 'ERROR'] },
      },
    });
    if (!authorized) throw new BankLedgerNotFoundError();
    const existing = activeSyncs.get(bankAccountId);
    if (existing) return existing;
    const pending = this.performSync(context, bankAccountId);
    activeSyncs.set(bankAccountId, pending);
    try {
      return await pending;
    } finally {
      if (activeSyncs.get(bankAccountId) === pending) activeSyncs.delete(bankAccountId);
    }
  }

  private async performSync(context: FinancialAuthorization, bankAccountId: string): Promise<BankSyncResult> {
    const connection = await this.database.bankAccount.findFirst({
      where: {
        id: bankAccountId,
        companyId: { in: context.companyIds },
        status: { in: ['ACTIVE', 'ERROR'] },
      },
      select: {
        id: true,
        provider: true,
        companyId: true,
        institutionName: true,
        accessTokenCiphertext: true,
        syncCursor: true,
      },
    });
    if (!connection) throw new BankLedgerNotFoundError();
    const adapter = this.adapters.get(connection.provider);
    if (!adapter || !connection.accessTokenCiphertext) {
      throw new BankProviderUnavailableError();
    }
    const accessToken = decryptBankAccessToken(connection.accessTokenCiphertext);
    await this.database.bankAccount.update({
      where: { id: connection.id },
      data: { lastSyncAttemptAt: new Date() },
    });
    let balance: BalanceSyncResult = { status: 'unsupported' };
    if (adapter.syncAccounts) {
      try {
        const accounts = await adapter.syncAccounts({ accessToken });
        const refreshedAt = new Date();
        const externalAccountIds = accounts.map(({ externalAccountId }) => externalAccountId);
        await this.database.$transaction(async (database) => {
          for (const account of accounts) {
            await database.bankSubAccount.upsert({
              where: {
                bankAccountId_externalAccountId: {
                  bankAccountId: connection.id,
                  externalAccountId: account.externalAccountId,
                },
              },
              create: {
                bankAccountId: connection.id,
                externalAccountId: account.externalAccountId,
                plaidAccountId: connection.provider === 'PLAID' ? account.externalAccountId : null,
                institutionName: connection.institutionName,
                name: account.name,
                officialName: account.officialName ?? null,
                type: account.type,
                subtype: account.subtype ?? null,
                mask: account.mask ?? null,
                currency: account.currency,
                currentBalance: balanceNumber(account.currentBalanceMinor),
                availableBalance: balanceNumber(account.availableBalanceMinor),
                currentBalanceMinor: account.currentBalanceMinor,
                availableBalanceMinor: account.availableBalanceMinor,
                isActive: true,
                lastSyncedAt: refreshedAt,
              },
              update: {
                name: account.name,
                officialName: account.officialName ?? null,
                type: account.type,
                subtype: account.subtype ?? null,
                mask: account.mask ?? null,
                currency: account.currency,
                currentBalance: balanceNumber(account.currentBalanceMinor),
                availableBalance: balanceNumber(account.availableBalanceMinor),
                currentBalanceMinor: account.currentBalanceMinor,
                availableBalanceMinor: account.availableBalanceMinor,
                isActive: true,
                lastSyncedAt: refreshedAt,
              },
            });
          }
          await database.bankSubAccount.updateMany({
            where: {
              bankAccountId: connection.id,
              ...(externalAccountIds.length
                ? { externalAccountId: { notIn: externalAccountIds } }
                : {}),
            },
            data: { isActive: false },
          });
          await database.financialAuditEvent.create({
            data: {
              operatingGroupId: context.operatingGroupId,
              companyId: connection.companyId,
              actorUserId: context.userId,
              action: 'BANK_BALANCE_REFRESHED',
              metadata: { bankAccountId: connection.id, accountCount: accounts.length },
            },
          });
        });
        balance = { status: 'updated', accountCount: accounts.length, refreshedAt };
      } catch (error) {
        const failure = balanceFailure(error);
        balance = { status: 'failed', code: failure.code, message: failure.message };
        await this.database.financialAuditEvent.create({
          data: {
            operatingGroupId: context.operatingGroupId,
            companyId: connection.companyId,
            actorUserId: context.userId,
            action: 'BANK_BALANCE_REFRESH_FAILED',
            metadata: { bankAccountId: connection.id, code: failure.code },
          },
        });
      }
    }
    let cursor = connection.syncCursor;
    let added = 0;
    let updated = 0;
    let removed = 0;
    try {
      for (let pageNumber = 0; pageNumber < MAX_SYNC_PAGES; pageNumber += 1) {
        const page = await adapter.syncTransactions({ accessToken, cursor });
        const ingested = await this.ledger.ingestTransactions(
          context,
          connection.id,
          [...page.added, ...page.modified],
        );
        const removedResult = await this.ledger.markRemoved(
          context,
          connection.id,
          page.removedExternalIds,
        );
        added += ingested.created;
        updated += ingested.updated;
        removed += removedResult.removed;
        cursor = page.nextCursor;
        if (!page.hasMore) {
          await this.database.bankAccount.update({
            where: { id: connection.id },
            data: {
              syncCursor: cursor,
              lastSync: new Date(),
              status: balance.status === 'failed' && balance.code === 'LOGIN_REQUIRED'
                ? 'REQUIRES_REAUTH'
                : 'ACTIVE',
              ...(balance.status === 'failed'
                ? {
                    lastSyncErrorCode: balance.code,
                    lastSyncErrorMessage: balance.message,
                  }
                : {
                    lastSyncErrorCode: null,
                    lastSyncErrorMessage: null,
                  }),
            },
          });
          return balance.status === 'unsupported'
            ? { added, updated, removed, cursor }
            : { added, updated, removed, cursor, balance };
        }
      }
      throw new Error('Provider pagination exceeded the bounded sync limit.');
    } catch (error) {
      const failure = sanitizeProviderFailure(error);
      await this.database.bankAccount.update({
        where: { id: connection.id },
        data: {
          status: failure.status,
          lastSyncErrorCode: failure.code,
          lastSyncErrorMessage: failure.message,
        },
      });
      throw new BankProviderUnavailableError(failure.message);
    }
  }

  async syncWebhookEvent(eventId: string) {
    const event = await this.database.bankProviderWebhookEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        status: true,
        bankAccount: {
          select: {
            id: true,
            companyId: true,
            createdByUserId: true,
            company: {
              select: {
                operatingGroupLink: {
                  select: {
                    operatingGroupId: true,
                    operatingGroup: {
                      select: {
                        companies: { select: { companyId: true } },
                        memberships: { select: { userId: true, role: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!event || event.status !== 'QUEUED') return;
    const connection = event.bankAccount;
    const group = connection.company?.operatingGroupLink;
    const actor = group?.operatingGroup.memberships.find(
      (membership) => membership.userId === connection.createdByUserId,
    );
    if (!connection.companyId || !group || !actor || actor.role === 'MEMBER') {
      await this.database.bankProviderWebhookEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED' },
      });
      return;
    }
    const claimed = await this.database.bankProviderWebhookEvent.updateMany({
      where: { id: event.id, status: 'QUEUED' },
      data: { status: 'PROCESSING' },
    });
    if (!claimed.count) return;
    try {
      await this.syncNow({
        userId: actor.userId,
        activeCompanyId: connection.companyId,
        operatingGroupId: group.operatingGroupId,
        role: actor.role,
        companyIds: group.operatingGroup.companies.map(({ companyId }) => companyId),
      }, connection.id);
      await this.database.bankProviderWebhookEvent.update({
        where: { id: event.id },
        data: { status: 'COMPLETED' },
      });
    } catch {
      await this.database.bankProviderWebhookEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED' },
      });
    }
  }
}

export const bankSyncService = new BankSyncService();
