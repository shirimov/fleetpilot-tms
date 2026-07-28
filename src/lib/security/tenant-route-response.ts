import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { FinancialResourceNotFoundError } from '@/lib/finance/financial-authorization';

export function tenantRouteErrorResponse(
  error: unknown,
  fallback: string,
): NextResponse {
  return (
    authorizationErrorResponse(error) ??
    (error instanceof FinancialResourceNotFoundError
      ? NextResponse.json({ error: 'Not found' }, { status: 404 })
      : null) ??
    NextResponse.json({ error: fallback }, { status: 500 })
  );
}

export function tenantOwnershipUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: 'This resource is unavailable until company ownership is set.' },
    { status: 503 },
  );
}
