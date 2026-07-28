import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { tenantRouteErrorResponse } from '@/lib/security/tenant-route-response';

export async function GET() {
  try {
    await authorizationService.requireActiveCompany();
    return NextResponse.json(
      {
        error:
          'QuickManage statistics are unavailable until company mapping is configured.',
      },
      { status: 503 },
    );
  } catch (error) {
    return tenantRouteErrorResponse(
      error,
      'QuickManage statistics could not be loaded.',
    );
  }
}
