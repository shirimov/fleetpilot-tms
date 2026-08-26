import { authorizationService } from '@/lib/auth/authorization';
import { quickManageClient } from '@/lib/integrations/quickmanage-client';
import { createQuickManageIntegrationHandlers } from '@/lib/integrations/quickmanage-route';

const handlers = createQuickManageIntegrationHandlers({
  requireAdministrator: () => authorizationService.requireModule('administration'),
  client: quickManageClient,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
