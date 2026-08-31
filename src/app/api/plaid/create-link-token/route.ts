import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankProviderConfiguration, bankProviderHttpsUrl, decryptBankAccessToken } from '@/lib/finance/bank-token-crypto';
import { BankLedgerNotFoundError, BankProviderUnavailableError } from '@/lib/finance/bank-ledger-errors';
import { bankLedgerRouteError } from '@/lib/finance/bank-ledger-route';
import { prisma } from '@/lib/prisma';
import { plaidLinkTokenRequest } from '@/lib/finance/plaid-link';

export async function POST(request: Request) {
  try {
    const providerConfiguration = bankProviderConfiguration();
    if (!providerConfiguration.plaidConfigured) {
      throw new BankProviderUnavailableError('Bank provider is not configured.');
    }
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const body = await request.json().catch(() => ({})) as { connectionId?: unknown };
    const connectionId = typeof body.connectionId === 'string' ? body.connectionId : null;
    const connection = connectionId
      ? await prisma.bankAccount.findFirst({
          where: {
            id: connectionId,
            companyId: context.activeCompanyId,
            provider: 'PLAID',
            status: { notIn: ['DISABLED', 'REVOKED'] },
          },
          select: { accessTokenCiphertext: true },
        })
      : null;
    if (connectionId && !connection?.accessTokenCiphertext) throw new BankLedgerNotFoundError();
    const webhook = bankProviderHttpsUrl('PLAID_WEBHOOK_URL');
    const redirectUri = bankProviderHttpsUrl('PLAID_REDIRECT_URI');
    const response = await plaidClient.linkTokenCreate(plaidLinkTokenRequest({
      userId: context.userId,
      companyId: context.activeCompanyId,
      ...(connection ? { accessToken: decryptBankAccessToken(connection.accessTokenCiphertext!) } : {}),
      ...(webhook ? { webhook } : {}),
      ...(redirectUri ? { redirectUri } : {}),
    }));
    return NextResponse.json({
      link_token: response.data.link_token,
      mode: connection ? 'update' : 'connect',
    });
  } catch (error: unknown) {
    return bankLedgerRouteError(error);
  }
}
