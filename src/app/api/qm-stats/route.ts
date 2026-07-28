import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import {
  tenantRouteErrorResponse,
} from '@/lib/security/tenant-route-response';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

export async function GET() {
  try {
    await authorizationService.requireActiveCompany();
    return NextResponse.json(
      {
        error:
          'QuickManage statistics are unavailable until company mapping is configured.',
      },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return tenantRouteErrorResponse(
      error,
      'QuickManage statistics could not be loaded.',
    );
  }
}
