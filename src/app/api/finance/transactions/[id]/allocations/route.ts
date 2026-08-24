import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialControlService } from '@/lib/finance/financial-control-service';
import { financialRouteError } from '@/lib/finance/financial-control-route';
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, { params }: Context) { try { const body = await request.json() as { allocations?: unknown }; return NextResponse.json(await financialControlService.replaceAllocations((await params).id, body.allocations, await financialControlAuthorization.requireContext())); } catch (error) { return financialRouteError(error); } }
