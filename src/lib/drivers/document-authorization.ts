import { driverAuthorizationService } from "./driver-authorization";
import { AuthorizationDeniedError } from "@/lib/auth/auth-errors";
import { requireOwnedDriver } from "./document-service";
export async function requireDriverDocuments(id: string, edit = false) {
  const context = await driverAuthorizationService.requireRead();
  if (!context.access.canReadDocuments || (edit && !context.access.canEdit))
    throw new AuthorizationDeniedError();
  await requireOwnedDriver(id, context.companyId);
  return context;
}
