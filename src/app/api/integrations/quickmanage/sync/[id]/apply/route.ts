import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { quickManageSyncErrorResponse } from '@/lib/integrations/quickmanage-sync-route-response';
import { quickManageSyncService } from '@/lib/integrations/quickmanage-sync-service';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizationService.requireModule('administration');
    return NextResponse.json(await quickManageSyncService.apply((await context.params).id, authorization));
  } catch (error) {
    return quickManageSyncErrorResponse(error);
  }
}
