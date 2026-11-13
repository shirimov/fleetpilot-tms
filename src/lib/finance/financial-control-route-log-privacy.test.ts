import test from 'node:test';
import assert from 'node:assert/strict';
import { NextResponse } from 'next/server';
import { financialRouteError } from './financial-control-route';

test('private-log-500: synthetic unknown Error name getters are never inspected or logged', async () => {
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    // Synthetic fixtures only: returning a private marker, then throwing.
    for (const throws of [false, true]) {
      let getterReads = 0;
      const error = new Error('Synthetic private error message');
      Object.defineProperty(error, 'name', {
        configurable: true,
        get() {
          getterReads += 1;
          if (throws) throw new Error('Synthetic name getter failure');
          return 'Synthetic-private-name-marker';
        },
      });
      let response: NextResponse | undefined;
      const logStart = logs.length;
      assert.doesNotThrow(() => { response = financialRouteError(error); });
      assert.equal(getterReads, 0);
      assert.deepEqual(logs.slice(logStart), [
        ['Financial control request failed', { errorName: 'UnknownError' }],
      ]);
      assert.ok(response instanceof Response);
      assert.ok(response instanceof NextResponse);
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
      assert.deepEqual(await response.json(), { error: 'Financial request failed.' });
    }
  } finally {
    console.error = originalConsoleError;
  }
});
