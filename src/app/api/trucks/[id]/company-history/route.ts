import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';
import { TruckHistoryError, truckCompanyHistoryService } from '@/lib/fleet/truck-company-history';

function failure(error: unknown) {
  if (error instanceof TruckHistoryError || error instanceof SyntaxError) return NextResponse.json({ error: error.message }, { status: 400 });
  return fleetRouteErrorResponse(error, 'Company history could not be updated. Reload and check for conflicting identity or periods.');
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorizationService.requireUser();
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    if (query.has('date')) return NextResponse.json(await truckCompanyHistoryService.resolveTruckOperatingCompanyAt(id, query.get('date')!, user.id));
    if (query.has('from') && query.has('toExclusive')) return NextResponse.json(await truckCompanyHistoryService.resolveRange(id, query.get('from')!, query.get('toExclusive')!, user.id));
    return NextResponse.json(await truckCompanyHistoryService.history(id, user.id));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorizationService.requireUser();
    const { id } = await params;
    const input = await request.json();
    if (!input || typeof input !== 'object') throw new TruckHistoryError('History change is required.');
    return NextResponse.json(await truckCompanyHistoryService.change(id, input, user.id));
  } catch (error) { return failure(error); }
}
