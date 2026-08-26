import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';
import { truckLifecycleService } from '@/lib/fleet/truck-lifecycle-service';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await fleetAuthorizationService.requireTruck(id, 'ADMIN');
    const body = await request.json();
    const status = body.action === 'DEACTIVATE' ? 'INACTIVE' : body.action === 'REACTIVATE' ? 'ACTIVE' : null;
    if (!status) return NextResponse.json({ error: 'Action must be DEACTIVATE or REACTIVATE.' }, { status: 400 });
    return NextResponse.json(await truckLifecycleService.changeStatus(id, status, context));
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to change Truck lifecycle');
  }
}
