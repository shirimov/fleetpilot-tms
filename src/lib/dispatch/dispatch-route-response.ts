import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';
import {
  DispatchConflictError,
  DispatchResourceNotFoundError,
  DispatchValidationError,
} from './dispatch-errors';

export function dispatchRouteErrorResponse(error: unknown): NextResponse {
  return (
    authorizationErrorResponse(error) ??
    (error instanceof DispatchResourceNotFoundError
      ? NextResponse.json(
          { error: 'Not found' },
          { status: 404, headers: PRIVATE_NO_STORE_HEADERS },
        )
      : null) ??
    (error instanceof DispatchValidationError
      ? NextResponse.json(
          { error: error.message },
          { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
        )
      : null) ??
    (error instanceof DispatchConflictError
      ? NextResponse.json(
          { error: error.message },
          { status: 409, headers: PRIVATE_NO_STORE_HEADERS },
        )
      : null) ??
    NextResponse.json(
      { error: 'Dispatch request failed.' },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    )
  );
}

