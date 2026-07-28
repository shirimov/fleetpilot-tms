import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';

export async function GET() {
  try {
    const context = await authorizationService.requireActiveCompany();
    const loads = await prisma.load.findMany({
      where: { companyId: context.companyId },
      include: { truck: true, driver: true, company: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(loads);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to fetch loads');
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const body = await request.json();
    const load = await prisma.$transaction(async (transaction) => {
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

      return transaction.load.create({
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
          companyId: context.companyId,
        },
      });
    });
    if (!load) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(load);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to create load');
  }
}
