import { NextRequest, NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { prisma } from '@/lib/prisma';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankProviderConfiguration, encryptBankAccessToken } from '@/lib/finance/bank-token-crypto';
import { BankLedgerValidationError, BankProviderUnavailableError } from '@/lib/finance/bank-ledger-errors';
import { bankSyncService } from '@/lib/finance/bank-sync-service';

function balanceMinor(value: number | null | undefined) {
  return value == null ? null : BigInt(Math.round(value * 100));
}

export async function POST(req: NextRequest) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    if (!bankProviderConfiguration().plaidConfigured) {
      throw new BankProviderUnavailableError('Bank provider is not configured.');
    }
    const { public_token } = await req.json();
    if (typeof public_token !== 'string' || !public_token.trim()) {
      throw new BankLedgerValidationError('A valid provider token is required.');
    }

    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({ public_token });
    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    // Get institution info
    const itemResponse = await plaidClient.itemGet({ access_token: accessToken });
    const institutionId = itemResponse.data.item.institution_id;
    let institutionName = 'Unknown Bank';

    if (institutionId) {
      const instResponse = await plaidClient.institutionsGetById({
        institution_id: institutionId,
        country_codes: ['US' as never],
      });
      institutionName = instResponse.data.institution.name;
    }

    // Get accounts
    const accountsResponse = await plaidClient.accountsGet({ access_token: accessToken });
    const accounts = accountsResponse.data.accounts;

    // Save to DB
    const bankAccount = await prisma.bankAccount.create({
      data: {
        companyId: context.activeCompanyId,
        provider: 'PLAID',
        externalConnectionId: itemId,
        plaidItemId: itemId,
        plaidAccessToken: null,
        accessTokenCiphertext: encryptBankAccessToken(accessToken),
        institutionId,
        institutionName,
        accounts: {
          create: accounts.map(acc => ({
            externalAccountId: acc.account_id,
            plaidAccountId: acc.account_id,
            name: acc.name,
            officialName: acc.official_name || null,
            type: acc.type,
            subtype: acc.subtype || null,
            mask: acc.mask || null,
            currentBalance: acc.balances.current || 0,
            availableBalance: acc.balances.available || 0,
            currentBalanceMinor: balanceMinor(acc.balances.current),
            availableBalanceMinor: balanceMinor(acc.balances.available),
            currency: acc.balances.iso_currency_code || 'USD',
          })),
        },
      },
      include: { accounts: true },
    });

    await bankSyncService.syncNow(context, bankAccount.id);

    const safeBankAccount = await prisma.bankAccount.findUniqueOrThrow({
      where: { id: bankAccount.id },
      select: {
        id: true,
        companyId: true,
        provider: true,
        institutionId: true,
        institutionName: true,
        lastSync: true,
        createdAt: true,
        updatedAt: true,
        accounts: {
          select: {
            id: true,
            name: true,
            officialName: true,
            type: true,
            subtype: true,
            mask: true,
            currentBalance: true,
            availableBalance: true,
          },
        },
      },
    });
    return NextResponse.json({ success: true, bankAccount: safeBankAccount });
  } catch (error: unknown) {
    return tenantRouteErrorResponse(error, 'Failed to connect bank');
  }
}
