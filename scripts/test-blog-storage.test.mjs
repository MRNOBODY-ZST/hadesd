import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('blog integration smoke refuses execution without the isolated test guard', () => {
  const result = spawnSync(process.execPath, ['scripts/test-blog-storage.mjs'], {
    env: { ...process.env, HADESD_ISOLATED_TEST: '', API_ORIGIN: 'http://backend:8080' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HADESD_ISOLATED_TEST=true/);
  assert.doesNotMatch(result.stderr, /fetch failed|ECONNREFUSED|ENOTFOUND/);
});

test('blog integration smoke refuses a public API host even when guard is set', () => {
  const result = spawnSync(process.execPath, ['scripts/test-blog-storage.mjs'], {
    env: { ...process.env, HADESD_ISOLATED_TEST: 'true', API_ORIGIN: 'https://example.com' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /public hosts are refused/);
  assert.doesNotMatch(result.stderr, /fetch failed|ECONNREFUSED|ENOTFOUND/);
});
