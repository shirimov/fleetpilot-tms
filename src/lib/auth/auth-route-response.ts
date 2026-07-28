import { NextResponse } from 'next/server';
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
} from './auth-errors';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

export function authorizationErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AuthenticationRequiredError) {
    return NextResponse.json(
      { error: error.message },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  if (error instanceof AuthorizationDeniedError) {
    return NextResponse.json(
      { error: error.message },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return null;
}
