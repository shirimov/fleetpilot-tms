import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';

export async function GET() {
  try {
    const context = await fleetAuthorizationService.requireCompany();
    const drivers = await prisma.driver.findMany({
      where: { companyId: context.companyId },
      include: { truck: true },
      orderBy: { lastName: 'asc' },
    });
    return NextResponse.json(drivers);
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to fetch drivers');
  }
}

export async function POST(request: Request) {
  try {
    const context = await fleetAuthorizationService.requireCompany('ADMIN');
    const body = await request.json();
    if (body.truckId) {
      await fleetAuthorizationService.requireTruck(body.truckId, 'ADMIN');
    }
    const driver = await prisma.driver.create({
      data: {
        companyId: context.companyId,
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone || null,
        email: body.email || null,
        licenseNum: body.licenseNum || null,
        payType: body.payType,
        payRate: parseFloat(body.payRate),
        truckId: body.truckId || null,
      },
    });
    return NextResponse.json(driver);
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to create driver');
  }
}
