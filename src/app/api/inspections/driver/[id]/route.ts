import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context =
      await fleetAuthorizationService.requireDriverOrientation(id);
    const orientation = await prisma.driverOrientation.findFirst({
      where: {
        id,
        driver: { truck: { is: { companyId: context.companyId } } },
      },
      include: { driver: { select: { firstName: true, lastName: true, phone: true } } },
    });
    if (!orientation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(orientation);
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to fetch orientation');
  }
}
