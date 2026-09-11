import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

test('MinIO setup preserves existing settings and credentials and is repeatable', async () => {
  const { configureMinio } = await import('./setup-minio.mjs');
  const root = await mkdtemp(join(tmpdir(), 'hadesd-minio-'));
  try {
    await writeFile(join(root, '.env'), 'STORAGE_MODE=local\nDB_PASSWORD=existing-test-value\nAWS_ACCESS_KEY_ID=\n');
    await configureMinio(root);
    const first = await readFile(join(root, '.env'), 'utf8');
    const env = parseEnv(first);
    assert.equal(env.STORAGE_MODE, 'local');
    assert.equal(env.DB_PASSWORD, 'existing-test-value');
    assert.equal(env.S3_PATH_STYLE, 'true');
    assert.equal(env.S3_BUCKET, 'hadesd-media');
    assert.notEqual(env.MINIO_ROOT_USER, env.AWS_ACCESS_KEY_ID);
    assert.notEqual(env.MINIO_ROOT_PASSWORD, env.AWS_SECRET_ACCESS_KEY);
    assert.ok(env.AWS_SECRET_ACCESS_KEY.length >= 32);
    await configureMinio(root);
    assert.equal(await readFile(join(root, '.env'), 'utf8'), first);
  } finally { await rm(root, { recursive: true, force: true }); }
});
