import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankLedgerRouteError } from '@/lib/finance/bank-ledger-route';
import { bankProviderConfiguration } from '@/lib/finance/bank-token-crypto';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

export async function GET() {
  try {
    await financialControlAuthorization.requireContext('ADMIN');
    return NextResponse.json(bankProviderConfiguration(), { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    return bankLedgerRouteError(error);
  }
}
