import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { truckOwnerHistoryService } from '@/lib/fleet/truck-owner-history';

const reply = (body: unknown) => NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
const failure = (error: unknown) => error instanceof SyntaxError
  ? NextResponse.json({ error: 'Invalid JSON.' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } })
  : financialRouteError(error);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const { id } = await params;
    return reply(await truckOwnerHistoryService.history(id, context));
  } catch (error) { return failure(error); }
}

// Full reviewed timeline replacement, not a blind append or inferred transfer.
// Old revisions/periods remain durable; expectedRevisionId prevents lost updates.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await financialControlAuthorization.requireContext('OWNER');
    const { id } = await params;
    return reply(await truckOwnerHistoryService.replace(id, await request.json(), context));
  } catch (error) { return failure(error); }
}
