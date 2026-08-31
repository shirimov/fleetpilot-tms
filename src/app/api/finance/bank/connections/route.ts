import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankLedgerRouteError } from '@/lib/finance/bank-ledger-route';
import { bankLedgerService } from '@/lib/finance/bank-ledger-service';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

export async function GET(request: Request) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const companyId = new URL(request.url).searchParams.get('companyId') ?? context.activeCompanyId;
    return NextResponse.json(
      await bankLedgerService.listConnections(context, companyId),
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return bankLedgerRouteError(error);
  }
}
