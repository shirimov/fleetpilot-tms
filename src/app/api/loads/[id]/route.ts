import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await fleetAuthorizationService.requireLoad(id);
    const body = await request.json();
    const load = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.load.findFirst({
        where: { id, companyId: context.companyId },
        select: { id: true },
      });
      if (!existing) return null;
      const truck = await transaction.truck.findFirst({
        where: { id: body.truckId, companyId: context.companyId },
        select: { id: true },
      });
      if (!truck) return null;
      const driver = body.driverId
        ? await transaction.driver.findFirst({
            where: { id: body.driverId, companyId: context.companyId },
            select: { id: true },
          })
        : null;
      if (body.driverId && !driver) return null;

      return transaction.load.update({
        where: { id, companyId: context.companyId },
        data: {
          loadNumber: body.loadNumber,
          referenceNum: body.referenceNum || null,
          status: body.status || 'PENDING',
          origin: body.origin,
          destination: body.destination,
          pickupDate: body.pickupDate ? new Date(body.pickupDate) : null,
          deliveryDate: body.deliveryDate
            ? new Date(body.deliveryDate)
            : null,
          miles: body.miles ? parseFloat(body.miles) : null,
          rate: parseFloat(body.rate),
          fuelSurcharge: body.fuelSurcharge
            ? parseFloat(body.fuelSurcharge)
            : 0,
          truckId: truck.id,
          driverId: driver?.id ?? null,
        },
      });
    });
    if (!load) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(load);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to update load');
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await fleetAuthorizationService.requireLoad(id);
    const result = await prisma.load.deleteMany({
      where: { id, companyId: context.companyId },
    });
    if (!result.count) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to delete load');
  }
}
