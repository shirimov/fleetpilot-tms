import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import {
  GENERIC_MESSAGE,
  handleEmailSignInRequest,
} from './email-auth-route';
import { EmailDeliveryError } from './email-auth';

test('provider failure remains generic and does not log the Resend API key', async () => {
  const apiKey = 're_test_must_not_appear';
  process.env.EMAIL_AUTH_ENABLED = 'true';
  process.env.EMAIL_AUTH_RESEND_API_KEY = apiKey;
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => {
    logged.push(values);
  };
  let attempts = 0;

  try {
    const response = await handleEmailSignInRequest(
      new NextRequest('https://alpha.example.test/api/auth/email/request', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-real-ip': '192.0.2.20',
        },
        body: JSON.stringify({ email: 'member@example.test' }),
      }),
      {
        async request() {
          attempts += 1;
          throw new EmailDeliveryError();
        },
      },
      0,
    );

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { message: GENERIC_MESSAGE });
    assert.equal(attempts, 1);
    assert.equal(JSON.stringify(logged).includes(apiKey), false);
    assert.equal(JSON.stringify(logged).includes('AbortError'), false);
  } finally {
    console.error = originalConsoleError;
  }
});
