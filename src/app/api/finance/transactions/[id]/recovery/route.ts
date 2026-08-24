import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialControlService } from '@/lib/finance/financial-control-service';
import { financialRouteError } from '@/lib/finance/financial-control-route';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await financialControlService.updateOwnerRecovery(
        (await params).id,
        await request.json(),
        await financialControlAuthorization.requireContext(),
      ),
    );
  } catch (error) {
    return financialRouteError(error);
  }
}
