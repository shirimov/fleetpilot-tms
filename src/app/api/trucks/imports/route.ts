import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';
import { truckImportService } from '@/lib/fleet/truck-import-service';

export async function POST(request: Request) {
  try {
    const context = await fleetAuthorizationService.requireCompany('ADMIN');
    const file = (await request.formData()).get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Truck file is required.' }, { status: 400 });
    return NextResponse.json(await truckImportService.preview(file, context));
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to preview truck import');
  }
}
