import { NextResponse } from 'next/server';
import { AuthenticationRequiredError, AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { QuickManageError, sanitizeQuickManageError } from './quickmanage-client';
import { QUICKMANAGE_EXPLORER_RESOURCES, type QuickManageExplorerInput } from './quickmanage-explorer';

type Dependencies = {
  authorize: () => Promise<CompanyAuthorization>;
  explore: (context: CompanyAuthorization, input: QuickManageExplorerInput) => Promise<unknown>;
};

function parseInput(request: Request): QuickManageExplorerInput {
  const params = new URL(request.url).searchParams;
  const resource = params.get('resource') ?? '';
  if (!QUICKMANAGE_EXPLORER_RESOURCES.includes(resource as QuickManageExplorerInput['resource'])) {
    throw new QuickManageError('MALFORMED_RESPONSE', 'Unsupported QuickManage explorer resource.');
  }
  const field = params.get('field');
  const operator = params.get('operator');
  const value = params.get('value');
  return {
    resource: resource as QuickManageExplorerInput['resource'],
    query: params.get('query') ?? undefined,
    filters: field && operator && value ? [{ field, operator, value }] : [],
    page: params.has('page') ? Number(params.get('page')) : undefined,
    pageSize: params.has('pageSize') ? Number(params.get('pageSize')) : undefined,
    reportType: params.get('reportType') ?? undefined,
    reportSubtype: params.get('reportSubtype') ?? undefined,
    id: params.get('id') ?? undefined,
  };
}

export function createQuickManageExplorerHandler(dependencies: Dependencies) {
  return async function GET(request: Request) {
    try {
      const context = await dependencies.authorize();
      return NextResponse.json(await dependencies.explore(context, parseInput(request)), {
        headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
      if (error instanceof AuthorizationDeniedError) return NextResponse.json({ error: error.message }, { status: 403 });
      if (error instanceof QuickManageError) {
        const status = error.code === 'NOT_CONFIGURED' ? 503 : error.code === 'MALFORMED_RESPONSE' ? 400 : error.status === 429 ? 429 : 502;
        return NextResponse.json({ error: sanitizeQuickManageError(error) }, { status });
      }
      return NextResponse.json({ error: 'QuickManage explorer request failed.' }, { status: 502 });
    }
  };
}
