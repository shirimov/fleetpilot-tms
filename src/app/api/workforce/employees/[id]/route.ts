import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { workforceProfileService } from '@/lib/workforce/workforce-profile-service';
import { capacityService } from '@/lib/workforce/capacity-service';
import { workforceRouteErrorResponse } from '@/lib/workforce/workforce-route-response';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const { id } = await params;
    const [profile, capacity] = await Promise.all([
      workforceProfileService.getProfile(context, id),
      capacityService.forEmployeeDay(context.companyId, id),
    ]);
    return NextResponse.json({ profile, capacity }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return workforceRouteErrorResponse(error);
  }
}
