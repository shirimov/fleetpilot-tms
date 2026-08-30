import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankLedgerRouteError } from '@/lib/finance/bank-ledger-route';
import { bankSyncService } from '@/lib/finance/bank-sync-service';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    return NextResponse.json(
      await bankSyncService.syncNow(context, (await params).id),
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return bankLedgerRouteError(error);
  }
}
