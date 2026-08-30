import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';
import {
  BankLedgerNotFoundError,
  BankLedgerValidationError,
  BankProviderUnavailableError,
} from './bank-ledger-errors';
import { FinancialValidationError } from './financial-control-errors';

export function bankLedgerRouteError(error: unknown) {
  return (
    authorizationErrorResponse(error) ??
    (error instanceof BankLedgerNotFoundError
      ? NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE_NO_STORE_HEADERS })
      : null) ??
    (error instanceof BankLedgerValidationError
      ? NextResponse.json({ error: error.message }, { status: 400, headers: PRIVATE_NO_STORE_HEADERS })
      : null) ??
    (error instanceof FinancialValidationError
      ? NextResponse.json({ error: error.message }, { status: 400, headers: PRIVATE_NO_STORE_HEADERS })
      : null) ??
    (error instanceof BankProviderUnavailableError
      ? NextResponse.json({ error: error.message }, { status: 503, headers: PRIVATE_NO_STORE_HEADERS })
      : null) ??
    NextResponse.json(
      { error: 'Bank ledger request failed.' },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    )
  );
}
