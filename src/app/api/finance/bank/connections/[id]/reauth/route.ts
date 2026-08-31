import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { prisma } from '@/lib/prisma';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankLedgerRouteError } from '@/lib/finance/bank-ledger-route';
import { BankLedgerNotFoundError } from '@/lib/finance/bank-ledger-errors';
import { decryptBankAccessToken } from '@/lib/finance/bank-token-crypto';
import { bankSyncService } from '@/lib/finance/bank-sync-service';

function balanceMinor(value: number | null | undefined) {
  return value == null ? null : BigInt(Math.round(value * 100));
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const { id } = await params;
    const connection = await prisma.bankAccount.findFirst({
      where: {
        id,
        companyId: context.activeCompanyId,
        provider: 'PLAID',
        status: { notIn: ['DISABLED', 'REVOKED'] },
      },
      select: { id: true, companyId: true, status: true, accessTokenCiphertext: true },
    });
    if (!connection?.accessTokenCiphertext) throw new BankLedgerNotFoundError();
    const accessToken = decryptBankAccessToken(connection.accessTokenCiphertext);
    const accountsResponse = await plaidClient.accountsGet({ access_token: accessToken });
    await prisma.$transaction(async (database) => {
      for (const account of accountsResponse.data.accounts) {
        await database.bankSubAccount.upsert({
          where: {
            bankAccountId_externalAccountId: {
              bankAccountId: connection.id,
              externalAccountId: account.account_id,
            },
          },
          create: {
            bankAccountId: connection.id,
            externalAccountId: account.account_id,
            plaidAccountId: account.account_id,
            name: account.name,
            officialName: account.official_name ?? null,
            type: account.type,
            subtype: account.subtype ?? null,
            mask: account.mask ?? null,
            currency: account.balances.iso_currency_code ?? 'USD',
            currentBalance: account.balances.current ?? null,
            availableBalance: account.balances.available ?? null,
            currentBalanceMinor: balanceMinor(account.balances.current),
            availableBalanceMinor: balanceMinor(account.balances.available),
            lastSyncedAt: new Date(),
          },
          update: {
            name: account.name,
            officialName: account.official_name ?? null,
            type: account.type,
            subtype: account.subtype ?? null,
            mask: account.mask ?? null,
            currency: account.balances.iso_currency_code ?? 'USD',
            currentBalance: account.balances.current ?? null,
            availableBalance: account.balances.available ?? null,
            currentBalanceMinor: balanceMinor(account.balances.current),
            availableBalanceMinor: balanceMinor(account.balances.available),
            isActive: true,
            lastSyncedAt: new Date(),
          },
        });
      }
      await database.bankAccount.update({
        where: { id: connection.id },
        data: {
          status: 'ACTIVE',
          lastSyncErrorCode: null,
          lastSyncErrorMessage: null,
        },
      });
      await database.financialAuditEvent.create({
        data: {
          operatingGroupId: context.operatingGroupId,
          companyId: connection.companyId,
          actorUserId: context.userId,
          action: 'BANK_CONNECTION_REAUTHENTICATED',
          before: { status: connection.status },
          after: { status: 'ACTIVE' },
          metadata: { bankAccountId: connection.id },
        },
      });
    });
    let synchronized = true;
    try {
      await bankSyncService.syncNow(context, connection.id);
    } catch {
      synchronized = false;
    }
    return NextResponse.json({ success: true, synchronized });
  } catch (error) {
    return bankLedgerRouteError(error);
  }
}
