import type {
  BankClassificationScope,
  BankReconciliationStatus,
  BankTransactionReviewStatus,
} from '@prisma/client';
import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { BankLedgerValidationError } from '@/lib/finance/bank-ledger-errors';
import { bankLedgerRouteError } from '@/lib/finance/bank-ledger-route';
import { bankLedgerService } from '@/lib/finance/bank-ledger-service';
import { parsePositiveMinorUnits } from '@/lib/finance/money';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

type RouteContext = { params: Promise<{ id: string }> };
const scopes = new Set<BankClassificationScope>(['COMPANY_LEVEL', 'ENTITY_ALLOCATED']);
const reviewStatuses = new Set<BankTransactionReviewStatus>([
  'UNREVIEWED', 'SUGGESTED', 'REVIEWED', 'NEEDS_REVIEW', 'IGNORED',
]);
const reconciliationStatuses = new Set<BankReconciliationStatus>([
  'NOT_APPLICABLE', 'UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED', 'DISCREPANCY',
]);

function optionalId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const body = await request.json() as Record<string, unknown>;
    if (!scopes.has(body.scope as BankClassificationScope)) {
      throw new BankLedgerValidationError('Classification scope is invalid.');
    }
    if (!reviewStatuses.has(body.reviewStatus as BankTransactionReviewStatus)) {
      throw new BankLedgerValidationError('Review status is invalid.');
    }
    if (
      body.reconciliationStatus !== undefined &&
      !reconciliationStatuses.has(body.reconciliationStatus as BankReconciliationStatus)
    ) {
      throw new BankLedgerValidationError('Reconciliation status is invalid.');
    }
    if (!Array.isArray(body.allocations)) {
      throw new BankLedgerValidationError('Allocations must be a list.');
    }
    const allocations = body.allocations.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BankLedgerValidationError('Allocation is invalid.');
      }
      const allocation = value as Record<string, unknown>;
      const categoryId = optionalId(allocation.categoryId);
      if (!categoryId) throw new BankLedgerValidationError('Allocation category is required.');
      return {
        amountMinor: parsePositiveMinorUnits(allocation.amount),
        categoryId,
        truckId: optionalId(allocation.truckId),
        trailerId: optionalId(allocation.trailerId),
        driverId: optionalId(allocation.driverId),
        partyId: optionalId(allocation.partyId),
        memo: optionalId(allocation.memo),
      };
    });
    return NextResponse.json(
      await bankLedgerService.classifyTransaction(context, (await params).id, {
        categoryId: optionalId(body.categoryId),
        scope: body.scope as BankClassificationScope,
        reviewStatus: body.reviewStatus as BankTransactionReviewStatus,
        reconciliationStatus: body.reconciliationStatus as BankReconciliationStatus | undefined,
        notes: optionalId(body.notes),
        allocations,
      }),
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return bankLedgerRouteError(error);
  }
}
