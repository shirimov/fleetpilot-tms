import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';
import { isValidVin, normalizeUnitNumber, normalizeVin, TruckImportValidationError } from '@/lib/fleet/truck-import-service';

export async function GET() {
  try {
    const context = await fleetAuthorizationService.requireCompany();
    const trucks = await prisma.truck.findMany({
      where: { companyId: context.companyId },
      include: { company: true },
      orderBy: { unitNumber: 'asc' },
    });
    return NextResponse.json(trucks);
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to fetch trucks');
  }
}

export async function POST(req: Request) {
  try {
    const context = await fleetAuthorizationService.requireCompany('ADMIN');
    const body = await req.json();
    const unitNumber = String(body.unitNumber ?? '').trim();
    const vin = String(body.vin ?? '').trim();
    if (!unitNumber) throw new TruckImportValidationError('Unit number is required.');
    if (vin && !isValidVin(normalizeVin(vin))) throw new TruckImportValidationError('VIN is invalid.');
    const truck = await prisma.truck.create({
      data: {
        unitNumber,
        unitNumberNormalized: normalizeUnitNumber(unitNumber),
        vin: vin || null,
        vinNormalized: vin ? normalizeVin(vin) : null,
        year: body.year ? parseInt(body.year) : null,
        make: body.make || null,
        model: body.model || null,
        status: body.status || 'ACTIVE',
        companyId: context.companyId,
        cabType: body.cabType || 'SLEEPER',
        isOwnerOp: body.cabType === 'OWNER_OP',
        ownerName: body.ownerName || null,
      },
    });
    return NextResponse.json(truck);
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to create truck');
  }
}
