import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';

export async function GET() {
  try {
    const context = await fleetAuthorizationService.requireCompany();
    const inspections = await prisma.truckInspection.findMany({
      where: { truck: { companyId: context.companyId } },
      include: { truck: { select: { unitNumber: true, make: true, model: true } } },
      orderBy: { inspectedAt: 'desc' },
      take: 100,
    });
    return NextResponse.json(inspections);
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to fetch inspections');
  }
}

export async function POST(request: Request) {
  try {
    await fleetAuthorizationService.requireCompany();
    const body = await request.json();
    const { truckId, inspectedBy, currentMileage, phase1, phase2, phase3, notes, passed } = body;
    if (!truckId || !inspectedBy || !phase1 || !phase2 || !phase3) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    await fleetAuthorizationService.requireTruck(truckId);
    const inspection = await prisma.truckInspection.create({
      data: { truckId, inspectedBy, currentMileage: currentMileage ?? null, phase1, phase2, phase3, notes, passed: passed ?? true },
      include: { truck: { select: { unitNumber: true } } },
    });
    return NextResponse.json(inspection, { status: 201 });
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to create inspection');
  }
}
