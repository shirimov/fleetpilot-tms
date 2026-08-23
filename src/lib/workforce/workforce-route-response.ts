import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { WorkforceResourceNotFoundError } from './workforce-authorization';
import { WorkforceValidationError } from './workforce-profile-service';

export function workforceRouteErrorResponse(error: unknown) {
  const auth = authorizationErrorResponse(error);
  if (auth) return auth;
  if (error instanceof WorkforceResourceNotFoundError) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (error instanceof WorkforceValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ error: 'Workforce request failed.' }, { status: 500 });
}
