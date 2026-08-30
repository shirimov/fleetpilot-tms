import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { quickManageSyncErrorResponse } from '@/lib/integrations/quickmanage-sync-route-response';
import { quickManageSyncService } from '@/lib/integrations/quickmanage-sync-service';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizationService.requireModule('administration');
    const body = await request.json().catch(() => null) as { resourceType?: unknown } | null;
    return NextResponse.json(await quickManageSyncService.apply((await context.params).id, body?.resourceType, authorization));
  } catch (error) {
    return quickManageSyncErrorResponse(error);
  }
}
