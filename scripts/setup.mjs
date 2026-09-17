import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, lstat, readFile, chmod } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { configureMinio } from './setup-minio.mjs';
import { parseTrustedProxies } from './trusted-proxies.mjs';

const repository = resolve(import.meta.dirname, '..');
const help = `Usage: node -- scripts/setup.mjs [options]
  --mode dev|docker          dev writes .env; docker writes .env.docker
  --site-origin URL          Public HTTP(S) origin (default http://localhost:PORT)
  --admin-user USER          Initial administrator username (default admin)
  --port PORT                Blog HTTP port (default 18088)
  --bind IP                  Docker listener address (default 127.0.0.1)
  --project-name NAME        Docker Compose project (default personal-blog)
  --trusted-proxies CIDRS    Comma-separated trusted reverse proxy IPs/CIDRs
  --env-file PATH            Root .env/.env.* (except .env.example) or .local path
  --data-dir PATH            Private data directory inside .local
  --root PATH                Checkout root (default this repository)
Existing environment and password files are never overwritten.
`;

function safePath(root, value) {
  const result = resolve(root, value);
  if (/[\r\n\0']/.test(result)) throw new Error('Paths must not contain newlines, null bytes or single quotes');
  return result;
}

async function validatePrivatePath(root, filename, kind) {
  const name = relative(root, filename);
  const inLocal = name === '.local' || name.startsWith(`.local${sep}`);
  const rootEnv = !name.includes(sep) && (name === '.env' || name.startsWith('.env.')) && name !== '.env.example';
  if (kind !== 'env' ? !inLocal : !(rootEnv || inLocal && name !== '.local')) {
    throw new Error(kind === 'data' ? '--data-dir must be inside the checkout .local directory' : '--env-file must be a root .env/.env.* file (except .env.example) or inside .local');
  }
  let current = root;
  for (const part of name.split(sep)) {
    current = resolve(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error('Private configuration and data paths must not contain symbolic links');
      if (current === filename && (kind === 'data' ? !info.isDirectory() : !info.isFile())) {
        throw new Error(kind === 'data' ? 'Private data paths must be directories' : 'Private configuration and password paths must be regular files');
      }
      if (current === filename && kind === 'password' && (info.mode & 0o077)) {
        throw new Error('Existing administrator password must be a regular private file (chmod 600)');
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function exists(filename) {
  try { await lstat(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function initialize(options = {}) {
  const root = resolve(options.root ?? repository);
  const mode = options.mode ?? 'dev';
  if (!['dev', 'docker'].includes(mode)) throw new Error('--mode must be dev or docker');
  const port = String(options.port ?? '18088');
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('--port must be an integer between 1 and 65535');
  const adminUser = options['admin-user'] ?? 'admin';
  if (!/^[A-Za-z0-9_.-]{3,100}$/.test(adminUser)) throw new Error('--admin-user must contain 3–100 letters, numbers, dots, underscores or hyphens');
  const project = options['project-name'] ?? 'personal-blog';
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('--project-name must use lowercase letters, numbers, underscores or hyphens');
  const bind = options.bind ?? '127.0.0.1';
  if (!isIP(bind)) throw new Error('--bind must be an IPv4 or IPv6 address');
  let origin;
  try { origin = new URL(options['site-origin'] ?? `http://localhost:${port}`); }
  catch { throw new Error('--site-origin must be an HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(origin.protocol) || !/^[A-Za-z0-9._:[\]-]+$/.test(origin.host) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('--site-origin must be an HTTP(S) origin without credentials, a path, query or fragment');
  }
  const trustedProxies = parseTrustedProxies(options['trusted-proxies'] ?? '');
  const envFile = safePath(root, options['env-file'] ?? (mode === 'docker' ? '.env.docker' : '.env'));
  const dataDir = safePath(root, options['data-dir'] ?? (mode === 'docker' ? '.local/docker' : '.local'));
  await validatePrivatePath(root, envFile, 'env');
  await validatePrivatePath(root, dataDir, 'data');
  // Check before even creating directories: existing installations are untouched.
  if (await exists(envFile)) return { created: false, envFile };
  const folders = ['published', 'media', 'backups', 'reports'];
  const passwordFile = resolve(dataDir, 'admin-password');
  // Inspect every destination before creating anything, including derived paths.
  for (const folder of folders) await validatePrivatePath(root, resolve(dataDir, folder), 'data');
  await validatePrivatePath(root, passwordFile, 'password');
  const secret = () => randomBytes(32).toString('hex');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  for (const folder of folders) {
    const directory = resolve(dataDir, folder);
    const created = await mkdir(directory, { recursive: true, mode: folder === 'published' ? 0o755 : 0o700 });
    // nginx has a different UID; an installer's restrictive umask must not hide public files.
    if (created && folder === 'published') await chmod(directory, 0o755);
  }
  try { await writeFile(passwordFile, `${secret()}\n`, { mode: 0o600, flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = await lstat(passwordFile);
    if (!info.isFile() || (info.mode & 0o077)) throw new Error('Existing administrator password must be a regular private file (chmod 600)');
    const password = (await readFile(passwordFile, 'utf8')).trimEnd();
    if (password.length < 14 || Buffer.byteLength(password) > 72) throw new Error('Existing administrator password must contain at least 14 characters and at most 72 UTF-8 bytes');
  }
  const entries = {
    DB_HOST: '127.0.0.1', DB_PORT: '23306', DB_NAME: 'hadesd', DB_USERNAME: 'hadesd',
    DB_PASSWORD: secret(), MYSQL_ROOT_PASSWORD: secret(),
    REDIS_HOST: '127.0.0.1', REDIS_PORT: '26379', REDIS_PASSWORD: secret(),
    SERVER_PORT: '28080', API_ORIGIN: 'http://127.0.0.1:28080', LOCAL_PORT: String(Number(port)),
    WORKER_TOKEN: secret(), RELEASE_ROOT: resolve(dataDir, 'published'), MEDIA_ROOT: resolve(dataDir, 'media'),
    ADMIN_BOOTSTRAP_USERNAME: adminUser, ADMIN_BOOTSTRAP_PASSWORD_FILE: passwordFile,
    SESSION_SECURE: String(origin.protocol === 'https:'), STORAGE_MODE: 'local',
    SITE_ORIGIN: origin.origin, WORKER_POLL_MS: '3000',
    ...(mode === 'docker' ? {
      COMPOSE_PROJECT_NAME: project, APP_UID: String(process.getuid?.() ?? 1000),
      APP_GID: String(process.getgid?.() ?? 1000), HTTP_BIND_IP: bind, TRUSTED_PROXY_CIDRS: trustedProxies.join(','),
    } : {}),
  };
  await mkdir(dirname(envFile), { recursive: true, mode: 0o700 });
  // Single quoting also protects literal dollar signs in host paths from Compose interpolation.
  const source = Object.entries(entries).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n';
  try { await writeFile(envFile, source, { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') return { created: false, envFile }; throw error; }
  await configureMinio(root, envFile);
  return { created: true, envFile, passwordFile, mode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      mode: { type: 'string' }, 'site-origin': { type: 'string' }, 'admin-user': { type: 'string' },
      'trusted-proxies': { type: 'string' }, port: { type: 'string' }, bind: { type: 'string' }, 'project-name': { type: 'string' },
      'env-file': { type: 'string' }, 'data-dir': { type: 'string' }, root: { type: 'string' }, help: { type: 'boolean' },
    }, strict: true });
    if (values.help) console.log(help);
    else {
      const result = await initialize(values);
      if (!result.created) console.log(`Configuration already exists; preserved: ${result.envFile}`);
      else console.log(`Created ${result.envFile}\nPrivate administrator password: ${result.passwordFile}\nCredentials were not printed. ${result.mode === 'docker' ? `Next: ./scripts/deploy.sh --env-file '${result.envFile}' start, then ./scripts/deploy.sh --env-file '${result.envFile}' bootstrap.` : 'Next: pnpm deps:up, pnpm backend:build, pnpm bootstrap.'}`);
    }
  } catch (error) { console.error(`Setup failed: ${error.message}`); process.exitCode = 1; }
}
