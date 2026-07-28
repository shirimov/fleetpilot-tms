import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await fleetAuthorizationService.requireTruckInspection(id);
    const inspection = await prisma.truckInspection.findFirst({
      where: { id, truck: { companyId: context.companyId } },
      include: { truck: { select: { unitNumber: true, make: true, model: true, year: true, cabType: true } } },
    });
    if (!inspection) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(inspection);
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to fetch inspection');
  }
}
