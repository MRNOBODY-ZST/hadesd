import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, stat, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

// Each case runs the real CLI in a fresh directory, never the repository's .env.
async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), 'blog-setup-'));
  const root = join(sandbox, 'checkout');
  await mkdir(root);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return root;
}
function setup(root, ...args) {
  return spawnSync(process.execPath, ['--', join(import.meta.dirname, 'setup.mjs'), '--root', root, ...args], { encoding: 'utf8' });
}

test('docker initialization uses the chosen origin, account, port and isolated project', async t => {
  const root = await fixture(t);
  const result = setup(root, '--mode', 'docker', '--site-origin', 'https://notes.example.test/', '--admin-user', 'alice', '--port', '18090', '--project-name', 'alice-blog');
  assert.equal(result.status, 0, result.stderr);
  const env = parseEnv(await readFile(join(root, '.env.docker'), 'utf8'));
  assert.equal(env.SITE_ORIGIN, 'https://notes.example.test');
  assert.equal(env.SESSION_SECURE, 'true');
  assert.equal(env.ADMIN_BOOTSTRAP_USERNAME, 'alice');
  assert.equal(env.LOCAL_PORT, '18090');
  assert.equal(env.COMPOSE_PROJECT_NAME, 'alice-blog');
  assert.equal(env.APP_UID, String(process.getuid()));
  assert.equal(env.APP_GID, String(process.getgid()));
  assert.equal(env.RELEASE_ROOT, join(root, '.local/docker/published'));
  assert.equal(env.MEDIA_ROOT, join(root, '.local/docker/media'));
  assert.equal((await stat(env.RELEASE_ROOT)).mode & 0o777, 0o755);
  const password = await readFile(env.ADMIN_BOOTSTRAP_PASSWORD_FILE, 'utf8');
  assert.match(password, /^[a-f0-9]{64}\n$/);
  assert.ok(!result.stdout.includes(password.trim()));
  assert.equal((await stat(env.ADMIN_BOOTSTRAP_PASSWORD_FILE)).mode & 0o777, 0o600);
  assert.equal((await stat(join(root, '.env.docker'))).mode & 0o777, 0o600);
});

test('setup is repeatable and preserves existing configuration and credentials byte for byte', async t => {
  const root = await fixture(t);
  let result = setup(root, '--mode', 'docker');
  assert.equal(result.status, 0, result.stderr);
  const before = await readFile(join(root, '.env.docker'), 'utf8');
  const env = parseEnv(before);
  const password = await readFile(env.ADMIN_BOOTSTRAP_PASSWORD_FILE, 'utf8');
  result = setup(root, '--mode', 'docker', '--admin-user', 'changed', '--site-origin', 'https://changed.test');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(root, '.env.docker'), 'utf8'), before);
  assert.equal(await readFile(env.ADMIN_BOOTSTRAP_PASSWORD_FILE, 'utf8'), password);
});

test('existing env is left untouched without creating a replacement password or data directories', async t => {
  const root = await fixture(t);
  await writeFile(join(root, '.env'), 'DB_PASSWORD=existing\nCUSTOM=value\n');
  const result = setup(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(root, '.env'), 'utf8'), 'DB_PASSWORD=existing\nCUSTOM=value\n');
  assert.deepEqual(await readdir(root), ['.env']);
});

test('an interrupted initialization reuses the existing private administrator password', async t => {
  const root = await fixture(t);
  await mkdir(join(root, '.local'), { mode: 0o700 });
  await writeFile(join(root, '.local/admin-password'), 'existing-secure-password\n', { mode: 0o600 });
  const result = setup(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(root, '.local/admin-password'), 'utf8'), 'existing-secure-password\n');
  const env = parseEnv(await readFile(join(root, '.env'), 'utf8'));
  assert.equal(env.ADMIN_BOOTSTRAP_USERNAME, 'admin');
  assert.equal(env.SITE_ORIGIN, 'http://localhost:18088');
  assert.equal(env.SESSION_SECURE, 'false');
});

test('custom env and data paths work when the checkout path contains spaces and dollar signs', async t => {
  const root = await fixture(t);
  const result = setup(root, '--env-file', '.local/config/local.env', '--data-dir', '.local/private $data directory', '--port', '19088');
  assert.equal(result.status, 0, result.stderr);
  const env = parseEnv(await readFile(join(root, '.local/config/local.env'), 'utf8'));
  assert.equal(env.MEDIA_ROOT, join(root, '.local/private $data directory/media'));
  assert.equal(env.SITE_ORIGIN, 'http://localhost:19088');
  assert.equal(env.S3_ENDPOINT, 'http://127.0.0.1:19000');
});

for (const args of [
  ['--mode', 'production'], ['--port', '0'], ['--port', '65536'], ['--port', '123abc'],
  ['--admin-user', 'a'], ['--admin-user', 'admin\nINJECTED=yes'],
  ['--site-origin', 'ftp://example.test'], ['--site-origin', 'https://example.test/blog'],
  ['--site-origin', 'https://user:password@example.test'], ['--site-origin', 'https://example.test/?x=y'],
  ['--site-origin', 'https://foo;bar'], ['--site-origin', 'https://foo$bar'], ['--site-origin', "https://foo'bar"],
  ['--env-file', 'config/local.env'], ['--env-file', '.env.example'], ['--env-file', '../outside.env'],
  ['--data-dir', 'private-data'], ['--data-dir', '../outside-data'], ['--data-dir', '/tmp/escaped-data'],
  ['--trusted-proxies', '0.0.0.0/33'], ['--trusted-proxies', '::1/129'], ['--trusted-proxies', '127.0.0.1;return 200'],
  ['--project-name', 'Bad Name'], ['--bind', 'not-an-ip'], ['--unknown', 'value'], ['--port'],
]) {
  test(`invalid options fail before touching any files: ${JSON.stringify(args)}`, async t => {
    const root = await fixture(t);
    const scopedArgs = args.map(value => value === '/tmp/escaped-data' ? join(root, '../absolute-data') : value);
    const result = setup(root, ...scopedArgs);
    assert.notEqual(result.status, 0);
    assert.deepEqual(await readdir(root), []);
  });
}

test('a restrictive installer umask still creates a published directory nginx can traverse', async t => {
  const root = await fixture(t);
  const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,process.umask(0o077)', '--', join(import.meta.dirname, 'setup.mjs'), '--root', root, '--mode', 'docker'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await stat(join(root, '.local/docker/published'))).mode & 0o777, 0o755);
  assert.equal((await stat(join(root, '.local/docker/media'))).mode & 0o777, 0o700);
});


test('private paths cannot escape through symlinked directories', async t => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await symlink(outside, join(root, '.local'));
  const result = setup(root, '--mode', 'docker');
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await readdir(root), ['.local']);
});

test('trusted proxy IP and CIDR lists are validated and saved explicitly', async t => {
  const root = await fixture(t);
  const result = setup(root, '--mode', 'docker', '--trusted-proxies', '127.0.0.1, 172.20.0.0/16,::1/128');
  assert.equal(result.status, 0, result.stderr);
  const env = parseEnv(await readFile(join(root, '.env.docker'), 'utf8'));
  assert.equal(env.TRUSTED_PROXY_CIDRS, '127.0.0.1,172.20.0.0/16,::1/128');
});

for (const name of ['published', 'media', 'backups', 'reports', 'admin-password']) {
  test(`derived private path ${name} rejects symlinks before creating any files`, async t => {
    const root = await fixture(t);
    const outside = await fixture(t);
    const dataDir = join(root, '.local/docker');
    await mkdir(dataDir, { recursive: true });
    await symlink(outside, join(dataDir, name));
    const result = setup(root, '--mode', 'docker');
    assert.notEqual(result.status, 0);
    assert.deepEqual(await readdir(dataDir), [name]);
    assert.deepEqual(await readdir(outside), []);
    assert.deepEqual(await readdir(root), ['.local']);
  });
}

for (const name of ['published', 'media', 'backups', 'reports']) {
  test(`derived directory ${name} rejects an existing file before creating any other files`, async t => {
    const root = await fixture(t);
    const dataDir = join(root, '.local/docker');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, name), 'keep this file');
    const result = setup(root, '--mode', 'docker');
    assert.notEqual(result.status, 0);
    assert.deepEqual(await readdir(dataDir), [name]);
    assert.equal(await readFile(join(dataDir, name), 'utf8'), 'keep this file');
    assert.deepEqual(await readdir(root), ['.local']);
  });
}
