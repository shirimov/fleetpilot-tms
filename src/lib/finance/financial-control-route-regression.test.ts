import test from 'node:test';
import assert from 'node:assert/strict';
import { NextResponse } from 'next/server';
import { AuthenticationRequiredError } from '@/lib/auth/auth-errors';
import { FinancialConflictError, FinancialNotFoundError, FinancialValidationError } from './financial-control-errors';
import { financialRouteError } from './financial-control-route';

async function check(error: unknown, status: number, message: string) {
  const response = financialRouteError(error);
  assert.ok(response instanceof Response);
  assert.ok(response instanceof NextResponse);
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: message });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
}

test('private-401: authentication required retains default body', async () => {
  await check(new AuthenticationRequiredError(), 401, 'Authentication is required.');
  await check(new AuthenticationRequiredError('Synthetic authentication reason'), 401, 'Synthetic authentication reason');
});

test('private-404: missing financial resource retains redacted body', async () => {
  const error = new FinancialNotFoundError();
  error.message = 'Synthetic internal resource detail';
  await check(error, 404, 'Not found');
});

test('private-409: financial conflict retains intended message', async () => {
  await check(new FinancialConflictError('Synthetic revision conflict'), 409, 'Synthetic revision conflict');
});

test('private-400: financial validation retains intended message', async () => {
  await check(new FinancialValidationError('Synthetic invalid revision'), 400, 'Synthetic invalid revision');
});

test('private-500: unknown Error null and numeric inputs remain redacted', async () => {
  await check(new Error('Synthetic secret must not appear in response'), 500, 'Financial request failed.');
  await check(null, 500, 'Financial request failed.');
  await check(17, 500, 'Financial request failed.');
});
