import { authorizationService } from '@/lib/auth/authorization';
import { quickManageExplorerService } from '@/lib/integrations/quickmanage-explorer';
import { createQuickManageExplorerHandler } from '@/lib/integrations/quickmanage-explorer-route';

export const dynamic = 'force-dynamic';

export const GET = createQuickManageExplorerHandler({
  authorize: () => authorizationService.requireModule('administration'),
  explore: (context, input) => quickManageExplorerService.explore(context, input),
});
