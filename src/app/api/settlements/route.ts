import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';

export async function GET() {
  try {
    const context = await authorizationService.requireActiveCompany();
    const settlements = await prisma.settlement.findMany({
      where: { truck: { companyId: context.companyId } },
      include: {
        truck: true,
        driver: true,
        load: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(settlements);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to fetch settlements');
  }
}

export async function POST(req: Request) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const body = await req.json();

    const settlement = await prisma.$transaction(async (transaction) => {
      const truck = await transaction.truck.findFirst({
        where: { id: body.truckId, companyId: context.companyId },
        select: { id: true },
      });
      if (!truck) return null;

      const driver = body.driverId
        ? await transaction.driver.findFirst({
            where: {
              id: body.driverId,
              truck: { is: { companyId: context.companyId } },
            },
            select: { id: true },
          })
        : null;
      if (body.driverId && !driver) return null;

      let driverPay = parseFloat(body.driverPay) || 0;
      let grossRevenue = parseFloat(body.grossRevenue) || 0;
      const load = body.loadId
        ? await transaction.load.findFirst({
            where: { id: body.loadId, companyId: context.companyId },
            include: { driver: true },
          })
        : null;
      if (body.loadId && !load) return null;
      if (load) {
        grossRevenue = load.rate + (load.fuelSurcharge || 0);
      if (load.driver) {
        if (load.driver.payType === 'PERCENTAGE') {
            driverPay = grossRevenue * (load.driver.payRate / 100);
        } else if (load.driver.payType === 'PER_MILE') {
            driverPay = (load.miles || 0) * load.driver.payRate;
        } else {
            driverPay = load.driver.payRate;
          }
        }
      }

      const fuelDeduction = parseFloat(body.fuelDeduction) || 0;
      const otherDeductions = parseFloat(body.otherDeductions) || 0;
      const netPay = driverPay - fuelDeduction - otherDeductions;

      return transaction.settlement.create({
        data: {
          weekEnding: new Date(body.weekEnding),
          truckId: truck.id,
          driverId: driver?.id ?? null,
          loadId: load?.id ?? null,
          grossRevenue,
          driverPay,
          fuelDeduction,
          otherDeductions,
          netPay,
          notes: body.notes || null,
        },
        include: { truck: true, driver: true, load: true },
      });
    });

    if (!settlement) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(settlement);
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to create settlement');
  }
}
