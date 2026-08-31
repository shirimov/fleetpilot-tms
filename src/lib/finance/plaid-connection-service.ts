import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { FinancialAuthorization } from './financial-control-authorization';
import { BankLedgerValidationError } from './bank-ledger-errors';
import { encryptBankAccessToken } from './bank-token-crypto';

export type PlaidAccountSnapshot = {
  accountId: string;
  name: string;
  officialName?: string | null;
  type: string;
  subtype?: string | null;
  mask?: string | null;
  currentBalance?: number | null;
  availableBalance?: number | null;
  currency?: string | null;
};

function balanceMinor(value: number | null | undefined) {
  return value == null ? null : BigInt(Math.round(value * 100));
}

export class PlaidConnectionService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async createConnection(context: FinancialAuthorization, input: {
    itemId: string;
    accessToken: string;
    institutionId?: string | null;
    institutionName: string;
    consentedProducts?: string[];
    consentExpirationTime?: string | null;
    accounts: PlaidAccountSnapshot[];
  }) {
    const existing = await this.database.bankAccount.findFirst({
      where: { provider: 'PLAID', externalConnectionId: input.itemId },
      select: { id: true },
    });
    if (existing) throw new BankLedgerValidationError('This bank connection already exists.');
    return this.database.$transaction(async (database) => {
      const created = await database.bankAccount.create({
        data: {
          companyId: context.activeCompanyId,
          createdByUserId: context.userId,
          provider: 'PLAID',
          externalConnectionId: input.itemId,
          plaidItemId: input.itemId,
          plaidAccessToken: null,
          accessTokenCiphertext: encryptBankAccessToken(input.accessToken),
          institutionId: input.institutionId,
          institutionName: input.institutionName,
          consentMetadata: {
            consentedProducts: input.consentedProducts ?? [],
            consentExpirationTime: input.consentExpirationTime ?? null,
          },
          accounts: {
            create: input.accounts.map((account) => ({
              externalAccountId: account.accountId,
              plaidAccountId: account.accountId,
              institutionName: input.institutionName,
              name: account.name,
              officialName: account.officialName ?? null,
              type: account.type,
              subtype: account.subtype ?? null,
              mask: account.mask ?? null,
              currentBalance: account.currentBalance ?? null,
              availableBalance: account.availableBalance ?? null,
              currentBalanceMinor: balanceMinor(account.currentBalance),
              availableBalanceMinor: balanceMinor(account.availableBalance),
              currency: account.currency ?? 'USD',
              lastSyncedAt: new Date(),
            })),
          },
        },
        select: { id: true, companyId: true, provider: true, institutionName: true },
      });
      await database.financialAuditEvent.create({
        data: {
          operatingGroupId: context.operatingGroupId,
          companyId: context.activeCompanyId,
          actorUserId: context.userId,
          action: 'BANK_CONNECTION_CREATED',
          metadata: {
            bankAccountId: created.id,
            provider: 'PLAID',
            institutionId: input.institutionId,
            accountCount: input.accounts.length,
          },
        },
      });
      return created;
    });
  }
}

export const plaidConnectionService = new PlaidConnectionService();
