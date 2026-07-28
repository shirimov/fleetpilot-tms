import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await fleetAuthorizationService.requireDriver(id);
    await fleetAuthorizationService.requireCompany('ADMIN');
    const body = await request.json();
    if (body.truckId) {
      await fleetAuthorizationService.requireTruck(body.truckId, 'ADMIN');
    }
    const driver = await prisma.driver.update({
      where: { id, companyId: context.companyId },
      data: {
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
    return fleetRouteErrorResponse(error, 'Failed to update driver');
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await fleetAuthorizationService.requireDriver(id);
    await fleetAuthorizationService.requireCompany('ADMIN');
    await prisma.driver.delete({
      where: { id, companyId: context.companyId },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to delete driver');
  }
}
