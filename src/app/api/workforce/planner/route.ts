import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { capacityService } from '@/lib/workforce/capacity-service';
import { workforceRouteErrorResponse } from '@/lib/workforce/workforce-route-response';

export async function GET(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const rawDate = new URL(request.url).searchParams.get('date');
    const date = rawDate ? new Date(rawDate) : new Date();
    if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'date is invalid.' }, { status: 400 });
    return NextResponse.json({ employees: await capacityService.dailyPlanner(context.companyId, date) });
  } catch (error) { return workforceRouteErrorResponse(error); }
}
