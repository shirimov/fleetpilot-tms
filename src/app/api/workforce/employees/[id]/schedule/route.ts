import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { workforceProfileService, type ScheduleDayInput } from '@/lib/workforce/workforce-profile-service';
import { workforceRouteErrorResponse } from '@/lib/workforce/workforce-route-response';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const { id } = await params;
    const body = await request.json() as { days?: ScheduleDayInput[] };
    const schedule = await workforceProfileService.replaceSchedule(context, id, Array.isArray(body.days) ? body.days : []);
    return NextResponse.json({ schedule });
  } catch (error) {
    return workforceRouteErrorResponse(error);
  }
}
