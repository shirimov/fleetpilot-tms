import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { financialControlService } from '@/lib/finance/financial-control-service';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialRouteError } from '@/lib/finance/financial-control-route';

export async function GET() {
  try {
    const active = await authorizationService.requireActiveCompany('ADMIN');
    const link = await financialControlService.getGroup(active);
    const role = link ? (await financialControlAuthorization.requireContext()).role : active.role;
    return NextResponse.json({ group: link?.operatingGroup ?? null, role });
  } catch (error) { return financialRouteError(error); }
}
export async function POST(request: Request) {
  try {
    const active = await authorizationService.requireActiveCompany('ADMIN');
    const body = await request.json() as { name?: unknown };
    return NextResponse.json(await financialControlService.createGroup(body.name, active), { status: 201 });
  } catch (error) { return financialRouteError(error); }
}
