import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { FinancialAuthorization } from './financial-control-authorization';
import { BankLedgerNotFoundError, BankProviderUnavailableError } from './bank-ledger-errors';
import { BankLedgerService, bankLedgerService } from './bank-ledger-service';
import type { BankProviderAdapter } from './bank-ledger-types';
import { decryptBankAccessToken } from './bank-token-crypto';
import { PlaidBankProviderAdapter } from './plaid-bank-adapter';

const MAX_SYNC_PAGES = 20;

function sanitizeProviderFailure(error: unknown) {
  const code =
    error && typeof error === 'object' && 'response' in error
      ? 'PROVIDER_REQUEST_FAILED'
      : error instanceof BankProviderUnavailableError
        ? 'PROVIDER_NOT_CONFIGURED'
        : 'PROVIDER_SYNC_FAILED';
  return { code, message: 'Bank transaction synchronization failed.' };
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
    const connection = await this.database.bankAccount.findFirst({
      where: {
        id: bankAccountId,
        companyId: { in: context.companyIds },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        provider: true,
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
              lastSyncErrorCode: null,
              lastSyncErrorMessage: null,
              status: 'ACTIVE',
            },
          });
          return { added, updated, removed, cursor };
        }
      }
      throw new Error('Provider pagination exceeded the bounded sync limit.');
    } catch (error) {
      const failure = sanitizeProviderFailure(error);
      await this.database.bankAccount.update({
        where: { id: connection.id },
        data: {
          status: 'ERROR',
          lastSyncErrorCode: failure.code,
          lastSyncErrorMessage: failure.message,
        },
      });
      throw new BankProviderUnavailableError(failure.message);
    }
  }
}

export const bankSyncService = new BankSyncService();
