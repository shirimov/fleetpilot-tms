import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyTelegramWebhook } from './telegram-webhook';

test('fails closed when Telegram webhook ownership is unconfigured', () => {
  assert.equal(verifyTelegramWebhook('claimed', undefined), 'unconfigured');
});

test('rejects missing, incorrect, and length-mismatched webhook secrets', () => {
  assert.equal(verifyTelegramWebhook(null, 'trusted-secret'), 'invalid');
  assert.equal(verifyTelegramWebhook('wrong-secret', 'trusted-secret'), 'invalid');
  assert.equal(verifyTelegramWebhook('short', 'trusted-secret'), 'invalid');
});

test('accepts only the configured Telegram webhook secret', () => {
  assert.equal(
    verifyTelegramWebhook('trusted-secret', 'trusted-secret'),
    'verified',
  );
});
