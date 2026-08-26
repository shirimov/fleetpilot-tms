import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QuickManageClient,
  QuickManageError,
  sanitizeQuickManageError,
} from './quickmanage-client';

const config = {
  clientId: 'synthetic-client-id',
  clientSecret: 'synthetic-client-secret',
  apiBaseUrl: 'https://quickmanage.example.test',
};
const token = 'eyJsynthetic.header.synthetic';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function success(expire = '2026-08-26T01:00:00.000Z') {
  return response({ 'error-fields': null, message: '', data: { access_token: token, expire } });
}

test('authenticates with the documented body and reuses a safely unexpired token', async () => {
  let calls = 0;
  const client = new QuickManageClient(async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://quickmanage.example.test/auth/token');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>)['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    return success();
  }, () => config, () => Date.parse('2026-08-26T00:00:00.000Z'));

  assert.equal((await client.getAccessToken()).accessToken, token);
  assert.equal((await client.getAccessToken()).accessToken, token);
  assert.equal(calls, 1);
});

test('re-authenticates when the cached token enters the expiry safety margin', async () => {
  let now = Date.parse('2026-08-26T00:00:00.000Z');
  let calls = 0;
  const client = new QuickManageClient(async () => {
    calls += 1;
    return success(new Date(now + 60_000).toISOString());
  }, () => config, () => now);

  await client.getAccessToken();
  now += 31_000;
  await client.getAccessToken();
  assert.equal(calls, 2);
});

test('fails closed for missing configuration and documented 401 failures', async () => {
  const missing = new QuickManageClient(async () => success(), () => null);
  await assert.rejects(missing.getAccessToken(), (error: unknown) =>
    error instanceof QuickManageError && error.code === 'NOT_CONFIGURED');

  for (const message of ['missing credentials', 'invalid credentials', 'inactive client']) {
    const client = new QuickManageClient(
      async () => response({ message, data: null }, 401),
      () => config,
    );
    await assert.rejects(client.getAccessToken(), (error: unknown) =>
      error instanceof QuickManageError
      && error.code === 'AUTH_REJECTED'
      && !error.message.includes(message));
  }
});

test('rejects malformed, incomplete, invalid-expiry, and expired responses', async () => {
  const cases: Array<[Response, string]> = [
    [new Response('{', { status: 200 }), 'MALFORMED_RESPONSE'],
    [response({ data: { expire: '2026-08-26T01:00:00Z' } }), 'MALFORMED_RESPONSE'],
    [response({ data: { access_token: token } }), 'MALFORMED_RESPONSE'],
    [response({ data: { access_token: token, expire: 'not-a-date' } }), 'MALFORMED_RESPONSE'],
    [success('2026-08-25T23:59:59Z'), 'EXPIRED_TOKEN'],
  ];
  for (const [providerResponse, code] of cases) {
    const client = new QuickManageClient(
      async () => providerResponse,
      () => config,
      () => Date.parse('2026-08-26T00:00:00Z'),
    );
    await assert.rejects(client.getAccessToken(), (error: unknown) =>
      error instanceof QuickManageError && error.code === code);
  }
});

test('uses a bounded timeout and sanitizes timeout/network failures', async () => {
  let timeoutMs = 0;
  const timeoutError = new DOMException('provider secret detail', 'TimeoutError');
  const client = new QuickManageClient(
    async () => { throw timeoutError; },
    () => config,
    () => Date.now(),
    (milliseconds) => {
      timeoutMs = milliseconds;
      return new AbortController().signal;
    },
  );
  await assert.rejects(client.getAccessToken(), (error: unknown) =>
    error instanceof QuickManageError && error.code === 'TIMEOUT');
  assert.equal(timeoutMs, 10_000);
});

test('redacts client secrets, bearer values, and JWT-shaped access tokens', () => {
  const unsafe = new QuickManageError(
    'NETWORK_ERROR',
    `client_secret=${config.clientSecret} Authorization: Bearer ${token}`,
  );
  const safe = sanitizeQuickManageError(unsafe, [config.clientSecret]);
  assert.doesNotMatch(safe, /synthetic-client-secret/);
  assert.doesNotMatch(safe, /eyJsynthetic/);
  assert.match(safe, /redacted/);
});
