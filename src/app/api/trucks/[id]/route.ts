import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await fleetAuthorizationService.requireTruck(id, 'ADMIN');
    const body = await req.json();
    const truck = await prisma.truck.update({
      where: { id, companyId: context.companyId },
      data: {
        unitNumber: body.unitNumber,
        vin: body.vin || null,
        year: body.year ? parseInt(body.year) : null,
        make: body.make || null,
        model: body.model || null,
        status: body.status || 'ACTIVE',
        cabType: body.cabType || 'SLEEPER',
        isOwnerOp: body.cabType === 'OWNER_OP',
        ownerName: body.ownerName || null,
      },
    });
    return NextResponse.json(truck);
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to update truck');
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await fleetAuthorizationService.requireTruck(id, 'ADMIN');
    await prisma.truck.delete({
      where: { id, companyId: context.companyId },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to delete truck');
  }
}
