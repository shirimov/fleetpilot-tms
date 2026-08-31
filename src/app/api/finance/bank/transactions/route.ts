import type {
  BankTransactionReviewStatus,
  FinancialDirection,
} from '@prisma/client';
import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankLedgerRouteError } from '@/lib/finance/bank-ledger-route';
import { bankLedgerService } from '@/lib/finance/bank-ledger-service';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';
import { parsePositiveMinorUnits } from '@/lib/finance/money';
import { resolveBankTransactionPeriod } from '@/lib/finance/bank-transaction-period';

const reviewStatuses = new Set<BankTransactionReviewStatus>([
  'UNREVIEWED', 'SUGGESTED', 'REVIEWED', 'NEEDS_REVIEW', 'IGNORED',
]);
const directions = new Set<FinancialDirection>(['INFLOW', 'OUTFLOW', 'TRANSFER']);

function amount(value: string | null) {
  return value ? parsePositiveMinorUnits(value) : undefined;
}

export async function GET(request: Request) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const params = new URL(request.url).searchParams;
    const reviewStatus = params.get('reviewStatus') as BankTransactionReviewStatus | null;
    const direction = params.get('direction') as FinancialDirection | null;
    const period = resolveBankTransactionPeriod({
      period: params.get('period'),
      from: params.get('from'),
      to: params.get('to'),
    });
    return NextResponse.json(
      await bankLedgerService.listTransactions(context, {
        companyId: params.get('companyId') ?? undefined,
        bankAccountId: params.get('bankAccountId') ?? undefined,
        subAccountId: params.get('subAccountId') ?? undefined,
        reviewStatus: reviewStatus && reviewStatuses.has(reviewStatus) ? reviewStatus : undefined,
        direction: direction && directions.has(direction) ? direction : undefined,
        categoryId: params.get('categoryId') ?? undefined,
        truckId: params.get('truckId') ?? undefined,
        trailerId: params.get('trailerId') ?? undefined,
        driverId: params.get('driverId') ?? undefined,
        partyId: params.get('partyId') ?? undefined,
        from: period.from,
        to: period.to,
        minimumAmountMinor: amount(params.get('minimumAmount')),
        maximumAmountMinor: amount(params.get('maximumAmount')),
        query: params.get('q')?.trim().slice(0, 200) || undefined,
        uncategorized: params.get('uncategorized') === 'true',
      }),
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return bankLedgerRouteError(error);
  }
}
