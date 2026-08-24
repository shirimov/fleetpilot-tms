import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialControlService } from '@/lib/finance/financial-control-service';
import { financialRouteError } from '@/lib/finance/financial-control-route';
export async function GET() { try { return NextResponse.json(await financialControlService.overview(await financialControlAuthorization.requireContext())); } catch (error) { return financialRouteError(error); } }
