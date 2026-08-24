import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialControlService } from '@/lib/finance/financial-control-service';
import { financialRouteError } from '@/lib/finance/financial-control-route';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await financialControlService.updateCategory((await params).id, await request.json(), await financialControlAuthorization.requireContext()));
  } catch (error) {
    return financialRouteError(error);
  }
}
