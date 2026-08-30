import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { quickManageSyncErrorResponse } from '@/lib/integrations/quickmanage-sync-route-response';
import { quickManageSyncService } from '@/lib/integrations/quickmanage-sync-service';

export async function POST(request: Request) {
  try {
    const context = await authorizationService.requireModule('administration');
    const body = await request.json().catch(() => null) as { resourceType?: unknown } | null;
    return NextResponse.json(await quickManageSyncService.preview(body?.resourceType, context));
  } catch (error) {
    return quickManageSyncErrorResponse(error);
  }
}
