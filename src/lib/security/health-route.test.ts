import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET } from '@/app/api/health/route';

test('health endpoint is non-cacheable and reports the application commit', async () => {
  const previousCommit = process.env.APP_COMMIT_SHA;
  process.env.APP_COMMIT_SHA = 'test-commit';
  try {
    const response = await GET();
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(body.status, 'ok');
    assert.equal(body.database, 'ok');
    assert.equal(body.commit, 'test-commit');
  } finally {
    if (previousCommit === undefined) delete process.env.APP_COMMIT_SHA;
    else process.env.APP_COMMIT_SHA = previousCommit;
  }
});
