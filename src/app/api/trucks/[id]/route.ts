import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';
import { isValidVin, normalizeUnitNumber, normalizeVin, TruckImportValidationError } from '@/lib/fleet/truck-import-service';
import { truckLifecycleService } from '@/lib/fleet/truck-lifecycle-service';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await fleetAuthorizationService.requireTruck(id, 'ADMIN');
    const body = await req.json();
    const unitNumber = String(body.unitNumber ?? '').trim();
    const vin = String(body.vin ?? '').trim();
    if (!unitNumber) throw new TruckImportValidationError('Unit number is required.');
    if (vin && !isValidVin(normalizeVin(vin))) throw new TruckImportValidationError('VIN is invalid.');
    const truck = await prisma.truck.update({
      where: { id, companyId: context.companyId },
      data: {
        unitNumber,
        unitNumberNormalized: normalizeUnitNumber(unitNumber),
        vin: vin || null,
        vinNormalized: vin ? normalizeVin(vin) : null,
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
    const context = await fleetAuthorizationService.requireTruck(id, 'OWNER');
    return NextResponse.json(await truckLifecycleService.deleteUnused(id, context));
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to delete truck');
  }
}
