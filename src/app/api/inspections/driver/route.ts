import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';

export async function GET() {
  try {
    const context = await fleetAuthorizationService.requireCompany();
    const orientations = await prisma.driverOrientation.findMany({
      where: {
        driver: { truck: { is: { companyId: context.companyId } } },
      },
      include: { driver: { select: { firstName: true, lastName: true } } },
      orderBy: { completedAt: 'desc' },
      take: 100,
    });
    return NextResponse.json(orientations);
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to fetch orientations');
  }
}

export async function POST(request: Request) {
  try {
    await fleetAuthorizationService.requireCompany();
    const body = await request.json();
    const { driverId, completedBy, checklist, signature, notes } = body;
    if (!driverId || !completedBy || !checklist || !signature) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    await fleetAuthorizationService.requireDriver(driverId);
    const orientation = await prisma.driverOrientation.create({
      data: { driverId, completedBy, checklist, signature, notes },
      include: { driver: { select: { firstName: true, lastName: true } } },
    });
    return NextResponse.json(orientation, { status: 201 });
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to create orientation');
  }
}
