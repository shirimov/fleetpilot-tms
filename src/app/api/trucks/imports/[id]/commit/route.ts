import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';
import { truckImportService } from '@/lib/fleet/truck-import-service';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await fleetAuthorizationService.requireCompany('ADMIN');
    return NextResponse.json(await truckImportService.commit((await params).id, context));
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to commit truck import');
  }
}
