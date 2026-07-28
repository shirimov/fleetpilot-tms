import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { FleetResourceNotFoundError } from './fleet-authorization';

export function fleetRouteErrorResponse(
  error: unknown,
  fallback: string,
): NextResponse {
  const authorizationResponse = authorizationErrorResponse(error);
  if (authorizationResponse) return authorizationResponse;
  if (error instanceof FleetResourceNotFoundError) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
