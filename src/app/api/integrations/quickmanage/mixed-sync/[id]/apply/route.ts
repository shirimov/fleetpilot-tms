import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { quickManageMixedStagingService } from '@/lib/integrations/quickmanage-mixed-staging-service';
import { quickManageSyncErrorResponse } from '@/lib/integrations/quickmanage-sync-route-response';

export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const context=await authorizationService.requireModule('administration');
    return NextResponse.json(await quickManageMixedStagingService.apply((await params).id,context));
  } catch(error){ return quickManageSyncErrorResponse(error); }
}
