import { NextResponse } from 'next/server';
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
} from './auth-errors';

export function authorizationErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AuthenticationRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof AuthorizationDeniedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  return null;
}
