import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { CountryCode, Products } from 'plaid';
import { authorizationService } from '@/lib/auth/authorization';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';
import { bankProviderConfiguration } from '@/lib/finance/bank-token-crypto';
import { BankProviderUnavailableError } from '@/lib/finance/bank-ledger-errors';

export async function POST() {
  try {
    if (!bankProviderConfiguration().plaidConfigured) {
      throw new BankProviderUnavailableError('Bank provider is not configured.');
    }
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: `${context.user.id}:${context.companyId}` },
      client_name: 'FleetPilot TMS',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    return NextResponse.json({ link_token: response.data.link_token });
  } catch (error: unknown) {
    return tenantRouteErrorResponse(error, 'Failed to create link token');
  }
}
