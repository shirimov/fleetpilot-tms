import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { truckOwnerHistoryService } from '@/lib/fleet/truck-owner-history';

// Read-only: no party creation, archive capture, or expanded financial writes.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const { id } = await params;
    return NextResponse.json(await truckOwnerHistoryService.options(id, context), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = financialRouteError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
