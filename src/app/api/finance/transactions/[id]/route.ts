import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialControlService } from '@/lib/finance/financial-control-service';
import { financialRouteError } from '@/lib/finance/financial-control-route';

type Context = { params: Promise<{ id: string }> };
export async function DELETE(_request: Request, { params }: Context) { try { return NextResponse.json(await financialControlService.deleteTransaction((await params).id, await financialControlAuthorization.requireContext('OWNER'))); } catch (error) { return financialRouteError(error); } }
export async function PATCH(request: Request, { params }: Context) { try { const body = await request.json() as { action?: unknown }; if (body.action !== 'VOID') return NextResponse.json({ error: 'Action is invalid.' }, { status: 400 }); return NextResponse.json(await financialControlService.voidTransaction((await params).id, await financialControlAuthorization.requireContext('OWNER'))); } catch (error) { return financialRouteError(error); } }
