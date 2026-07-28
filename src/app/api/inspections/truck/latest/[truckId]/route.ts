import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';

export async function GET(_: Request, { params }: { params: Promise<{ truckId: string }> }) {
  const { truckId } = await params;
  try {
    const context = await fleetAuthorizationService.requireTruck(truckId);
    const inspection = await prisma.truckInspection.findFirst({
      where: { truckId, truck: { companyId: context.companyId } },
      orderBy: { inspectedAt: 'desc' },
    });
    if (!inspection) return NextResponse.json(null);
    return NextResponse.json(inspection);
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to fetch');
  }
}
