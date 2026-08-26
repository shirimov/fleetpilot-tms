import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { FleetResourceNotFoundError } from './fleet-authorization';
import { TruckImportValidationError } from './truck-import-service';
import { TruckLifecycleError } from './truck-lifecycle-service';

export function fleetRouteErrorResponse(
  error: unknown,
  fallback: string,
): NextResponse {
  const authorizationResponse = authorizationErrorResponse(error);
  if (authorizationResponse) return authorizationResponse;
  if (error instanceof FleetResourceNotFoundError) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (error instanceof TruckImportValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof TruckLifecycleError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
