import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { quickManageMixedStagingService } from '@/lib/integrations/quickmanage-mixed-staging-service';
import { quickManageSyncErrorResponse } from '@/lib/integrations/quickmanage-sync-route-response';

export async function GET() {
  try {
    const context = await authorizationService.requireModule('administration');
    return NextResponse.json(await quickManageMixedStagingService.discoveredCarriers(context));
  } catch (error) { return quickManageSyncErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await authorizationService.requireModule('administration');
    const body = await request.json().catch(() => null) as { carrierId?:string; carrierName?:string; companyId?:string; notes?:string } | null;
    if (!body?.carrierId || !body.carrierName || !body.companyId) return NextResponse.json({error:'Carrier and FleetPilot company are required.'},{status:400});
    return NextResponse.json(await quickManageMixedStagingService.saveMapping({carrierId:body.carrierId,carrierName:body.carrierName,companyId:body.companyId,notes:body.notes},context));
  } catch (error) { return quickManageSyncErrorResponse(error); }
}
