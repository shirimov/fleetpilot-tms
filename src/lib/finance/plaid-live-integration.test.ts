import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Products } from 'plaid';
import { plaidLinkTokenRequest } from './plaid-link';
import { verifyPlaidWebhook } from './plaid-webhook';
import { BankLedgerValidationError } from './bank-ledger-errors';

async function signedWebhook(rawBody: string, issuedAt = Math.floor(Date.now() / 1000)) {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const publicJwk = await exportJWK(publicKey);
  Object.assign(publicJwk, { alg: 'ES256', kid: 'plaid-test-key', use: 'sig' });
  const token = await new SignJWT({
    request_body_sha256: createHash('sha256').update(rawBody).digest('hex'),
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'plaid-test-key' })
    .setIssuedAt(issuedAt)
    .sign(privateKey);
  return { token, publicJwk };
}

test('initial Link request is Transactions-only and binds the trusted user/company context', () => {
  const request = plaidLinkTokenRequest({
    userId: 'user-1',
    companyId: 'company-1',
    webhook: 'https://alpha.example.test/api/integrations/plaid/webhook',
    redirectUri: 'https://alpha.example.test/accounting/banking',
  });
  assert.deepEqual(request.products, [Products.Transactions]);
  assert.equal(request.user?.client_user_id, 'user-1:company-1');
  assert.equal(request.webhook, 'https://alpha.example.test/api/integrations/plaid/webhook');
  assert.equal(request.redirect_uri, 'https://alpha.example.test/accounting/banking');
  assert.equal('access_token' in request, false);
});

test('update-mode Link request uses the stored token and enables no new products', () => {
  const request = plaidLinkTokenRequest({
    userId: 'user-1',
    companyId: 'company-1',
    accessToken: 'test-access-token-not-real',
  });
  assert.equal(request.access_token, 'test-access-token-not-real');
  assert.equal(request.products, undefined);
});

test('Plaid webhook verification accepts an authentic recent body hash', async () => {
  const body = JSON.stringify({
    webhook_type: 'TRANSACTIONS',
    webhook_code: 'SYNC_UPDATES_AVAILABLE',
    item_id: 'item-test',
  });
  const { token, publicJwk } = await signedWebhook(body);
  const result = await verifyPlaidWebhook(body, token, async () => publicJwk);
  assert.equal(result.bodyHash, createHash('sha256').update(body).digest('hex'));
  assert.equal(result.eventHash.length, 64);
});

test('Plaid webhook verification rejects body tampering and stale signatures', async () => {
  const body = JSON.stringify({ item_id: 'item-test' });
  const recent = await signedWebhook(body);
  await assert.rejects(
    verifyPlaidWebhook(`${body} `, recent.token, async () => recent.publicJwk),
    BankLedgerValidationError,
  );
  const stale = await signedWebhook(body, Math.floor(Date.now() / 1000) - 301);
  await assert.rejects(
    verifyPlaidWebhook(body, stale.token, async () => stale.publicJwk),
    BankLedgerValidationError,
  );
});
