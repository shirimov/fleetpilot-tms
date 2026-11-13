import test from 'node:test';
import assert from 'node:assert/strict';
import { NextResponse } from 'next/server';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { financialRouteError } from './financial-control-route';

test('private-403: authorization error response prohibits caching', async () => {
  const response = financialRouteError(new AuthorizationDeniedError());
  assert.ok(response instanceof Response);
  assert.ok(response instanceof NextResponse);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Access denied' });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});
