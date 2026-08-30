import { NextResponse } from 'next/server';
import { AuthorizationDeniedError, AuthenticationRequiredError } from '@/lib/auth/auth-errors';
import {
  QuickManageError,
  sanitizeQuickManageError,
} from './quickmanage-client';

type TestConnectionResult = { connected: true; expiresAt: string };

type Dependencies = {
  requireAdministrator: () => Promise<unknown>;
  getIdentityStatus?: () => Promise<Record<string, unknown>>;
  client: {
    isConfigured: () => boolean;
    testConnection: () => Promise<TestConnectionResult>;
  };
};

export function createQuickManageIntegrationHandlers(dependencies: Dependencies) {
  async function authorize() {
    await dependencies.requireAdministrator();
  }

  return {
    GET: async () => {
      try {
        await authorize();
        return NextResponse.json({
          configured: dependencies.client.isConfigured(),
          ...(dependencies.getIdentityStatus ? await dependencies.getIdentityStatus() : {}),
        });
      } catch (error) {
        return integrationErrorResponse(error);
      }
    },
    POST: async () => {
      try {
        await authorize();
        const result = await dependencies.client.testConnection();
        return NextResponse.json({ configured: true, connected: result.connected });
      } catch (error) {
        return integrationErrorResponse(error);
      }
    },
  };
}

function integrationErrorResponse(error: unknown) {
  if (error instanceof AuthenticationRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof AuthorizationDeniedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof QuickManageError) {
    const status = error.code === 'NOT_CONFIGURED' ? 503 : 502;
    return NextResponse.json({ error: sanitizeQuickManageError(error) }, { status });
  }
  return NextResponse.json({ error: 'QuickManage connection failed.' }, { status: 502 });
}
