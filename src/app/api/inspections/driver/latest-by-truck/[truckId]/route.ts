import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';

// Returns the most recent driver orientation for the driver currently assigned to this truck
export async function GET(_: Request, { params }: { params: Promise<{ truckId: string }> }) {
  const { truckId } = await params;
  try {
    const context = await fleetAuthorizationService.requireTruck(truckId);
    const driver = await prisma.driver.findFirst({
      where: {
        truckId,
        truck: { is: { companyId: context.companyId } },
      },
    });
    if (!driver) return NextResponse.json(null);

    const orientation = await prisma.driverOrientation.findFirst({
      where: {
        driverId: driver.id,
        driver: { truck: { is: { companyId: context.companyId } } },
      },
      orderBy: { completedAt: 'desc' },
      include: { driver: { select: { firstName: true, lastName: true } } },
    });
    if (!orientation) return NextResponse.json(null);
    return NextResponse.json(orientation);
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to fetch');
  }
}
