import assert from 'node:assert/strict';
import { after } from 'node:test';
import test from 'node:test';
import {
  TelegramApiError,
  TelegramBotService,
  sanitizeTelegramError,
} from './telegram-client';

const originalEnv = {
  TELEGRAM_ENABLED: process.env.TELEGRAM_ENABLED,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
};

process.env.TELEGRAM_ENABLED = 'true';
process.env.TELEGRAM_BOT_TOKEN = '123456:secret-test-token';
process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram-webhook-secret';
process.env.TELEGRAM_BOT_USERNAME = 'fleetpilot_test_bot';

after(() => {
  process.env.TELEGRAM_ENABLED = originalEnv.TELEGRAM_ENABLED;
  process.env.TELEGRAM_BOT_TOKEN = originalEnv.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = originalEnv.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_BOT_USERNAME = originalEnv.TELEGRAM_BOT_USERNAME;
});

test('sendMessage uses the Telegram Bot API URL and payload shape', async () => {
  let receivedUrl = '';
  let receivedBody = '';
  const service = new TelegramBotService(async (input, init) => {
    receivedUrl = String(input);
    receivedBody = String(init?.body);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 55 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const result = await service.sendMessage({
    chatId: BigInt(777),
    text: 'Hello from FleetPilot',
    replyMarkup: {
      inline_keyboard: [[{ text: 'Open Task', url: 'https://alpha.example.test/tasks' }]],
    },
  });

  assert.equal(result.messageId, BigInt(55));
  assert.match(receivedUrl, /\/sendMessage$/);
  assert.match(receivedBody, /"chat_id":"777"/);
  assert.match(receivedBody, /Hello from FleetPilot/);
  assert.match(receivedBody, /Open Task/);
});

test('429 responses are transient and surface retry_after semantics', async () => {
  let calls = 0;
  const service = new TelegramBotService(async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        ok: false,
        description: 'Too Many Requests',
        parameters: { retry_after: 1 },
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  });

  await assert.rejects(
    service.sendMessage({ chatId: BigInt(1), text: 'retry me' }),
    (error: unknown) => {
      assert(error instanceof TelegramApiError);
      assert.equal(error.options.transient, true);
      assert.equal(error.options.retryAfterSeconds, 1);
      return true;
    },
  );
  assert.equal(calls, 3);
});

test('5xx responses retry with a bounded attempt count', async () => {
  let calls = 0;
  const service = new TelegramBotService(async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ ok: false, description: 'temporary failure' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  });

  await assert.rejects(service.sendMessage({ chatId: BigInt(2), text: 'retry 5xx' }), /temporary failure/);
  assert.equal(calls, 3);
});

test('permanent 4xx responses are not retried indefinitely', async () => {
  let calls = 0;
  const service = new TelegramBotService(async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ ok: false, description: 'chat not found' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  });

  await assert.rejects(
    service.sendMessage({ chatId: BigInt(3), text: 'bad chat' }),
    /chat not found/,
  );
  assert.equal(calls, 1);
});

test('timeouts are treated as transient failures and bot tokens are redacted from error text', async () => {
  const service = new TelegramBotService(async () => {
    throw new DOMException('aborted', 'AbortError');
  });

  await assert.rejects(
    service.sendMessage({ chatId: BigInt(4), text: 'timeout please' }),
    /timeout/i,
  );

  const sanitized = sanitizeTelegramError(
    new Error('Request to https://api.telegram.org/bot123456:secret-test-token/sendMessage failed'),
  );
  assert.doesNotMatch(sanitized, /secret-test-token/);
  assert.match(sanitized, /\[redacted\]/);
});
