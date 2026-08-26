import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { createQuickManageIntegrationHandlers } from './quickmanage-route';

test('status and Test Connection expose no credentials or access token', async () => {
  let tests = 0;
  const handlers = createQuickManageIntegrationHandlers({
    requireAdministrator: async () => ({ role: 'OWNER' }),
    client: {
      isConfigured: () => true,
      testConnection: async () => {
        tests += 1;
        return { connected: true, expiresAt: '2026-08-26T01:00:00Z' };
      },
    },
  });
  assert.deepEqual(await (await handlers.GET()).json(), { configured: true });
  const body = await (await handlers.POST()).json();
  assert.deepEqual(body, { configured: true, connected: true });
  assert.equal(JSON.stringify(body).includes('must-not-leak'), false);
  assert.equal(tests, 1);
});

test('server authorization denies MEMBER-equivalent callers before provider access', async () => {
  let contacted = false;
  const handlers = createQuickManageIntegrationHandlers({
    requireAdministrator: async () => { throw new AuthorizationDeniedError(); },
    client: {
      isConfigured: () => true,
      testConnection: async () => { contacted = true; return { connected: true, expiresAt: '' }; },
    },
  });
  assert.equal((await handlers.POST()).status, 403);
  assert.equal(contacted, false);
});
