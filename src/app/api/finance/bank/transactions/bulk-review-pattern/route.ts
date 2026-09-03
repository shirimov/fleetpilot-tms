import type { FinancialDirection } from '@prisma/client';
import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankLedgerRouteError } from '@/lib/finance/bank-ledger-route';
import { BankLedgerValidationError } from '@/lib/finance/bank-ledger-errors';
import { bankLedgerService } from '@/lib/finance/bank-ledger-service';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

export async function POST(request: Request) { try { const context = await financialControlAuthorization.requireContext('ADMIN'); const body = await request.json() as Record<string, unknown>; if (typeof body.merchantNormalized !== 'string' || !body.merchantNormalized.trim() || typeof body.categoryId !== 'string' || !body.categoryId.trim()) throw new BankLedgerValidationError('Pattern and category are required.'); const direction = body.direction === null ? null : body.direction as FinancialDirection; if (direction !== null && !['INFLOW','OUTFLOW','TRANSFER'].includes(direction)) throw new BankLedgerValidationError('Direction is invalid.'); return NextResponse.json(await bankLedgerService.bulkReviewPattern(context, { companyId: typeof body.companyId === 'string' ? body.companyId : context.activeCompanyId, merchantNormalized: body.merchantNormalized, direction, categoryId: body.categoryId }), { headers: PRIVATE_NO_STORE_HEADERS }); } catch (error) { return bankLedgerRouteError(error); } }
