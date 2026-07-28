import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('authenticated API responses use network-only service-worker handling', async () => {
  const config = await readFile('next.config.ts', 'utf8');
  assert.match(config, /urlPattern:\s*\/\\\/api\\\/\//);
  assert.match(config, /handler:\s*["']NetworkOnly["']/);
});
