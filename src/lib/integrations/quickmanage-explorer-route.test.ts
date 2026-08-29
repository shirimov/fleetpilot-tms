import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { QuickManageError } from './quickmanage-client';
import { createQuickManageExplorerHandler } from './quickmanage-explorer-route';

const context = { companyId: 'company-a', role: 'OWNER', user: {} } as CompanyAuthorization;

test('explorer authorizes before contacting QuickManage and MEMBER denial is server-side', async () => {
  let contacted = false;
  const handler = createQuickManageExplorerHandler({ authorize: async () => { throw new AuthorizationDeniedError(); }, explore: async () => { contacted = true; } });
  const response = await handler(new Request('http://local/api/integrations/quickmanage/explorer?resource=trucks'));
  assert.equal(response.status, 403);
  assert.equal(contacted, false);
});

test('explorer route parses one allow-listed filter and returns no-store data', async () => {
  let input: unknown;
  const handler = createQuickManageExplorerHandler({ authorize: async () => context, explore: async (_context, parsed) => { input = parsed; return { items: [] }; } });
  const response = await handler(new Request('http://local/api/integrations/quickmanage/explorer?resource=users&field=email&operator=match_phrase&value=a%40example.test&page=0&pageSize=10'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.deepEqual(input, { resource: 'users', query: undefined, filters: [{ field: 'email', operator: 'match_phrase', value: 'a@example.test' }], page: 0, pageSize: 10, reportType: undefined, reportSubtype: undefined, id: undefined });
});

test('explorer sanitizes provider errors and never returns credential material', async () => {
  const handler = createQuickManageExplorerHandler({ authorize: async () => context, explore: async () => { throw new QuickManageError('API_REJECTED', 'QuickManage request failed with status 429. Bearer secret-token', 429); } });
  const response = await handler(new Request('http://local/api/integrations/quickmanage/explorer?resource=trucks'));
  const body = await response.text();
  assert.equal(response.status, 429);
  assert.doesNotMatch(body, /secret-token/);
});
