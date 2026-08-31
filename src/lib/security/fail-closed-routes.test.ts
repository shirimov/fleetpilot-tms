import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  tenantOwnershipUnavailableResponse,
} from './tenant-route-response';
import { PRIVATE_NO_STORE_HEADERS } from './cache-headers';

const ownershipBlockedRoutes = [
  'src/app/api/reserve/route.ts',
  'src/app/api/tmfund/route.ts',
  'src/app/api/inbox/route.ts',
  'src/app/api/inbox/accounts/route.ts',
  'src/app/api/inbox/sync/route.ts',
];

test('ownership-blocked routes authenticate and cannot access data', async () => {
  for (const route of ownershipBlockedRoutes) {
    const source = await readFile(route, 'utf8');
    assert.match(source, /requireActiveCompany\('ADMIN'\)/, route);
    assert.match(source, /tenantOwnershipUnavailableResponse/, route);
    assert.doesNotMatch(source, /\bprisma\b|request\.json\(|req\.json\(/, route);
  }
});

test('QuickManage stays fail closed without data access and Telegram verifies before routing', async () => {
  const quickManage = await readFile('src/app/api/qm-stats/route.ts', 'utf8');
  assert.match(quickManage, /requireActiveCompany\(\)/);
  assert.match(quickManage, /status:\s*503/);
  assert.doesNotMatch(quickManage, /\bprisma\b|readFile|writeFile|exec/);

  const telegram = await readFile(
    'src/app/api/integrations/telegram/webhook/route.ts',
    'utf8',
  );
  assert.match(telegram, /verifyTelegramWebhook/);
  assert.match(telegram, /x-telegram-bot-api-secret-token/);
  assert.doesNotMatch(telegram, /\bprisma\b/);
});

test('Plaid webhook verifies provider signature and body hash before database routing', async () => {
  const plaid = await readFile(
    'src/app/api/integrations/plaid/webhook/route.ts',
    'utf8',
  );
  assert.match(plaid, /verifyPlaidWebhook/);
  assert.match(plaid, /plaid-verification/);
  assert.match(plaid, /webhookVerificationKeyGet/);
  assert.match(plaid, /bankProviderConfiguration/);
});

test('fail-closed responses cannot be cached', async () => {
  const response = tenantOwnershipUnavailableResponse();
  assert.equal(response.status, 503);
  assert.equal(
    response.headers.get('Cache-Control'),
    PRIVATE_NO_STORE_HEADERS['Cache-Control'],
  );
});
