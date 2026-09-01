import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';
import { isValidVin, normalizeUnitNumber, normalizeVin, TruckImportValidationError } from '@/lib/fleet/truck-import-service';
import { equipmentScopeService } from '@/lib/fleet/equipment-scope';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = await equipmentScopeService.resolve(url.searchParams.get('company'));
    const view = url.searchParams.get('view') ?? 'active';
    const query = url.searchParams.get('q')?.trim().slice(0, 100);
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('pageSize') ?? '100', 10) || 100));
    if (!['active', 'inactive', 'all'].includes(view)) throw new TruckImportValidationError('Truck view is invalid.');
    const where = {
        companyId: { in: scope.companyIds },
        ...(view === 'active' ? { status: { not: 'INACTIVE' as const } } : view === 'inactive' ? { status: 'INACTIVE' as const } : {}),
        ...(query ? { OR: [
          { unitNumber: { contains: query, mode: 'insensitive' as const } },
          { vin: { contains: query, mode: 'insensitive' as const } },
          { make: { contains: query, mode: 'insensitive' as const } },
          { model: { contains: query, mode: 'insensitive' as const } },
        ] } : {}),
      };
    const [total, trucks] = await prisma.$transaction([
      prisma.truck.count({ where }),
      prisma.truck.findMany({
      where,
      include: { company: true },
      orderBy: [{ unitNumber: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    ]);
    if (url.searchParams.get('format') !== 'page') return NextResponse.json(trucks);
    const manageByCompany = new Map(scope.companies.map(({ id, canManage }) => [id, canManage]));
    return NextResponse.json({
      items: trucks.map((truck) => ({ ...truck, canManage: manageByCompany.get(truck.companyId) ?? false })),
      companies: scope.companies,
      activeCompanyId: scope.activeCompanyId,
      selectedCompany: scope.selectedCompany,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
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
