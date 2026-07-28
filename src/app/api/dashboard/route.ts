import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { dashboardService } from '@/lib/dashboard/dashboard-service';

export async function GET() {
  try {
    const context = await authorizationService.requireActiveCompany();
    return NextResponse.json(
      await dashboardService.getSnapshot(context.companyId),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: 'Dashboard could not be loaded.' },
        { status: 500 },
      )
    );
  }
}
