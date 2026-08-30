import { NextResponse } from 'next/server';
import { AuthenticationRequiredError, AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { QuickManageError, sanitizeQuickManageError } from './quickmanage-client';
import { QuickManageSyncValidationError } from './quickmanage-sync-service';

export function quickManageSyncErrorResponse(error: unknown) {
  if (error instanceof AuthenticationRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof AuthorizationDeniedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof QuickManageSyncValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof QuickManageError) {
    return NextResponse.json({ error: sanitizeQuickManageError(error) }, { status: error.code === 'NOT_CONFIGURED' ? 503 : 502 });
  }
  return NextResponse.json({ error: 'QuickManage fleet synchronization failed.' }, { status: 500 });
}
