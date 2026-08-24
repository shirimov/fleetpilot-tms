import { NextResponse } from 'next/server';
import { AuthenticationRequiredError, AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { FinancialConflictError, FinancialNotFoundError, FinancialValidationError } from './financial-control-errors';

export function financialRouteError(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof AuthorizationDeniedError) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  if (error instanceof FinancialNotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (error instanceof FinancialConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof FinancialValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error('Financial control request failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
  return NextResponse.json({ error: 'Financial request failed.' }, { status: 500 });
}
