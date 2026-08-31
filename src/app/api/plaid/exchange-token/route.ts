import { NextRequest, NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankProviderConfiguration } from '@/lib/finance/bank-token-crypto';
import { BankLedgerValidationError, BankProviderUnavailableError } from '@/lib/finance/bank-ledger-errors';
import { bankSyncService } from '@/lib/finance/bank-sync-service';
import { plaidConnectionService } from '@/lib/finance/plaid-connection-service';

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

    const exchangeResponse = await plaidClient.itemPublicTokenExchange({ public_token });
    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

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

    const accountsResponse = await plaidClient.accountsGet({ access_token: accessToken });
    const accounts = accountsResponse.data.accounts;

    const bankAccount = await plaidConnectionService.createConnection(context, {
      itemId,
      accessToken,
      institutionId,
      institutionName,
      consentedProducts: itemResponse.data.item.consented_products ?? [],
      consentExpirationTime: itemResponse.data.item.consent_expiration_time ?? null,
      accounts: accounts.map((account) => ({
        accountId: account.account_id,
        name: account.name,
        officialName: account.official_name,
        type: account.type,
        subtype: account.subtype,
        mask: account.mask,
        currentBalance: account.balances.current,
        availableBalance: account.balances.available,
        currency: account.balances.iso_currency_code,
      })),
    });

    let initialSync = { success: true };
    try {
      await bankSyncService.syncNow(context, bankAccount.id);
    } catch {
      initialSync = { success: false };
    }
    return NextResponse.json({ success: true, bankAccount, initialSync });
  } catch (error: unknown) {
    return tenantRouteErrorResponse(error, 'Failed to connect bank');
  }
}
