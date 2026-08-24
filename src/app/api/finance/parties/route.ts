import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialControlService } from '@/lib/finance/financial-control-service';
import { financialRouteError } from '@/lib/finance/financial-control-route';

export async function POST(request: Request) {
  try { return NextResponse.json(await financialControlService.createParty(await request.json(), await financialControlAuthorization.requireContext()), { status: 201 }); }
  catch (error) { return financialRouteError(error); }
}
