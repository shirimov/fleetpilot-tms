import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';
import { isValidVin, normalizeUnitNumber, normalizeVin, TruckImportValidationError } from '@/lib/fleet/truck-import-service';

export async function GET(request: Request) {
  try {
    const context = await fleetAuthorizationService.requireCompany();
    const url = new URL(request.url);
    const view = url.searchParams.get('view') ?? 'active';
    const query = url.searchParams.get('q')?.trim();
    if (!['active', 'inactive', 'all'].includes(view)) throw new TruckImportValidationError('Truck view is invalid.');
    const trucks = await prisma.truck.findMany({
      where: {
        companyId: context.companyId,
        ...(view === 'active' ? { status: { not: 'INACTIVE' as const } } : view === 'inactive' ? { status: 'INACTIVE' as const } : {}),
        ...(query ? { OR: [
          { unitNumber: { contains: query, mode: 'insensitive' as const } },
          { vin: { contains: query, mode: 'insensitive' as const } },
          { make: { contains: query, mode: 'insensitive' as const } },
          { model: { contains: query, mode: 'insensitive' as const } },
        ] } : {}),
      },
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
