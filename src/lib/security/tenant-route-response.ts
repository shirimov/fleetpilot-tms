import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { FinancialResourceNotFoundError } from '@/lib/finance/financial-authorization';
import { WorkforceResourceNotFoundError } from '@/lib/workforce/workforce-authorization';
import { PRIVATE_NO_STORE_HEADERS } from './cache-headers';

export function tenantRouteErrorResponse(
  error: unknown,
  fallback: string,
): NextResponse {
  return (
    authorizationErrorResponse(error) ??
    (error instanceof FinancialResourceNotFoundError ||
    error instanceof WorkforceResourceNotFoundError
      ? NextResponse.json(
          { error: 'Not found' },
          { status: 404, headers: PRIVATE_NO_STORE_HEADERS },
        )
      : null) ??
    NextResponse.json(
      { error: fallback },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    )
  );
}

export function tenantOwnershipUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: 'This resource is unavailable until company ownership is set.' },
    { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
  );
}
