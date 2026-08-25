import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { pilotImportService } from '@/lib/finance/pilot-import-service';

export async function POST(request: Request, { params }: { params: Promise<{ id: string; issueId: string }> }) {
  try {
    const { id, issueId } = await params;
    return NextResponse.json(await pilotImportService.resolveIssue(id, issueId, await request.json(), await financialControlAuthorization.requireContext()));
  } catch (error) { return financialRouteError(error); }
}
