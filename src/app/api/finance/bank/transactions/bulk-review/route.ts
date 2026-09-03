import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankLedgerRouteError } from '@/lib/finance/bank-ledger-route';
import { BankLedgerValidationError } from '@/lib/finance/bank-ledger-errors';
import { bankLedgerService } from '@/lib/finance/bank-ledger-service';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

export async function POST(request: Request) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const body = await request.json() as Record<string, unknown>;
    if (!Array.isArray(body.transactionIds) || !body.transactionIds.every((id) => typeof id === 'string')) throw new BankLedgerValidationError('Transaction IDs are invalid.');
    if (typeof body.categoryId !== 'string' || !body.categoryId.trim()) throw new BankLedgerValidationError('Category is required.');
    return NextResponse.json(await bankLedgerService.bulkReviewTransactions(context, { transactionIds: body.transactionIds, categoryId: body.categoryId.trim(), notes: typeof body.notes === 'string' ? body.notes : null }), { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) { return bankLedgerRouteError(error); }
}
