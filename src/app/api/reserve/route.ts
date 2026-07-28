import { authorizationService } from '@/lib/auth/authorization';
import {
  tenantOwnershipUnavailableResponse,
  tenantRouteErrorResponse,
} from '@/lib/security/tenant-route-response';

export async function GET() {
  try {
    await authorizationService.requireActiveCompany('ADMIN');
    return tenantOwnershipUnavailableResponse();
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to fetch reserve');
  }
}

export async function POST() {
  try {
    await authorizationService.requireActiveCompany('ADMIN');
    return tenantOwnershipUnavailableResponse();
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to create reserve');
  }
}
