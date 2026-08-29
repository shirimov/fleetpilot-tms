import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { quickManageSyncErrorResponse } from '@/lib/integrations/quickmanage-sync-route-response';
import { quickManageTripSyncService } from '@/lib/integrations/quickmanage-trip-sync-service';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authorizationService.requireModule('administration');
    return NextResponse.json(await quickManageTripSyncService.apply((await params).id, context));
  } catch (error) { return quickManageSyncErrorResponse(error); }
}
