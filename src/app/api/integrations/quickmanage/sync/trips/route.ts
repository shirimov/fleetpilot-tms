import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { quickManageSyncErrorResponse } from '@/lib/integrations/quickmanage-sync-route-response';
import { quickManageTripSyncService } from '@/lib/integrations/quickmanage-trip-sync-service';

export async function POST() {
  try {
    const context = await authorizationService.requireModule('administration');
    return NextResponse.json(await quickManageTripSyncService.preview(context));
  } catch (error) { return quickManageSyncErrorResponse(error); }
}
