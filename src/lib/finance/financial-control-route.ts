import { NextResponse } from 'next/server';
import { AuthenticationRequiredError, AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { FinancialConflictError, FinancialNotFoundError, FinancialValidationError } from './financial-control-errors';

export function financialRouteError(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  if (error instanceof AuthorizationDeniedError) return NextResponse.json({ error: 'Access denied' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  if (error instanceof FinancialNotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  if (error instanceof FinancialConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
  if (error instanceof FinancialValidationError) return NextResponse.json({ error: error.message }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
  console.error('Financial control request failed', { errorName: 'UnknownError' });
  return NextResponse.json({ error: 'Financial request failed.' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
}
