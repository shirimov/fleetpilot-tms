import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialControlService } from '@/lib/finance/financial-control-service';
import { financialRouteError } from '@/lib/finance/financial-control-route';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(await financialControlService.listBankMatchCandidates((await params).id, await financialControlAuthorization.requireContext()));
  } catch (error) {
    return financialRouteError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await financialControlService.matchExpectationToBank((await params).id, await request.json(), await financialControlAuthorization.requireContext()), { status: 201 });
  } catch (error) {
    return financialRouteError(error);
  }
}
