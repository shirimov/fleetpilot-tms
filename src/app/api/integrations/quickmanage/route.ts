import { authorizationService } from '@/lib/auth/authorization';
import { quickManageClient } from '@/lib/integrations/quickmanage-client';
import { createQuickManageIntegrationHandlers } from '@/lib/integrations/quickmanage-route';
import { prisma } from '@/lib/prisma';

const handlers = createQuickManageIntegrationHandlers({
  requireAdministrator: () => authorizationService.requireModule('administration'),
  client: quickManageClient,
  getIdentityStatus: async () => {
    const context = await authorizationService.requireModule('administration');
    const [company, mapping] = await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: context.companyId }, select: { name: true } }),
      prisma.externalProviderAccountMapping.findFirst({
        where: { companyId: context.companyId, provider: 'QUICKMANAGE', isEnabled: true },
        select: { externalDisplayName: true, identityStatus: true, isEnabled: true },
      }),
    ]);
    return {
      connectedAccountName: null,
      mappedCompanyName: company.name,
      identityStatus: mapping?.identityStatus ?? 'UNVERIFIED',
      applyEnabled: Boolean(mapping?.isEnabled && mapping.identityStatus === 'VERIFIED'),
      identityMessage: 'The official QuickManage API does not expose a trustworthy carrier/account identity. Apply remains blocked until identity can be verified.',
    };
  },
});

export const GET = handlers.GET;
export const POST = handlers.POST;
