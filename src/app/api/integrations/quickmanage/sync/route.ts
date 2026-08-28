import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { quickManageSyncErrorResponse } from '@/lib/integrations/quickmanage-sync-route-response';
import { quickManageSyncService } from '@/lib/integrations/quickmanage-sync-service';

export async function POST() {
  try {
    const context = await authorizationService.requireModule('administration');
    return NextResponse.json(await quickManageSyncService.preview(context));
  } catch (error) {
    return quickManageSyncErrorResponse(error);
  }
}
