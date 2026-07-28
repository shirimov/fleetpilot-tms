import { authorizationService } from '@/lib/auth/authorization';
import {
  tenantOwnershipUnavailableResponse,
  tenantRouteErrorResponse,
} from '@/lib/security/tenant-route-response';

async function unavailableInboxResponse() {
  await authorizationService.requireActiveCompany('ADMIN');
  return tenantOwnershipUnavailableResponse();
}

export async function GET() {
  try {
    return await unavailableInboxResponse();
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to fetch inbox accounts');
  }
}

export async function POST() {
  try {
    return await unavailableInboxResponse();
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to create inbox account');
  }
}

export async function DELETE() {
  try {
    return await unavailableInboxResponse();
  } catch (error) {
    return tenantRouteErrorResponse(error, 'Failed to delete inbox account');
  }
}
