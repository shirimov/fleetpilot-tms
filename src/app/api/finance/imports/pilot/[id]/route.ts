import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { pilotImportService } from '@/lib/finance/pilot-import-service';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await pilotImportService.getInvoice((await params).id, await financialControlAuthorization.requireContext())); }
  catch (error) { return financialRouteError(error); }
}
