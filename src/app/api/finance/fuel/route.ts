import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { fuelReadService } from '@/lib/finance/fuel-read-service';
import { financialRouteError } from '@/lib/finance/financial-control-route';
export async function GET(request: Request) {
  try { return NextResponse.json(await fuelReadService.overview(await financialControlAuthorization.requireContext(), new URL(request.url).searchParams.get('page'))); }
  catch (error) { return financialRouteError(error); }
}
