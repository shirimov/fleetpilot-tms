import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { pilotImportService } from '@/lib/finance/pilot-import-service';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await financialControlAuthorization.requireContext();
    return NextResponse.json(await pilotImportService.reparseInvoice((await params).id, context));
  } catch (error) {
    return financialRouteError(error);
  }
}
