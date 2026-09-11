import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, access, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { configureMinio } from './setup-minio.mjs';
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, '.local'), {recursive: true, mode: 0o700});
await chmod(resolve(root, '.local'), 0o700);
try { await access(resolve(root, '.env')); console.log('.env 已存在；保留已有配置。'); process.exit(0); } catch {}
const secret = () => randomBytes(32).toString('hex');
for (const folder of ['published', 'media', 'backups', 'reports']) await mkdir(resolve(root, '.local', folder), {recursive: true});
const passwordFile = resolve(root, '.local/admin-password');
await writeFile(passwordFile, `${secret()}\n`, {mode: 0o600, flag: 'wx'});
const entries = {
DB_HOST:'127.0.0.1', DB_PORT:'23306', DB_NAME:'hadesd', DB_USERNAME:'hadesd', DB_PASSWORD:secret(), MYSQL_ROOT_PASSWORD:secret(),
REDIS_HOST:'127.0.0.1', REDIS_PORT:'26379', REDIS_PASSWORD:secret(), SERVER_PORT:'28080', API_ORIGIN:'http://127.0.0.1:28080', LOCAL_PORT:'18088',
WORKER_TOKEN:secret(), RELEASE_ROOT:resolve(root,'.local/published'), MEDIA_ROOT:resolve(root,'.local/media'), ADMIN_BOOTSTRAP_USERNAME:'hades', ADMIN_BOOTSTRAP_PASSWORD_FILE:passwordFile,
SESSION_SECURE:'false', STORAGE_MODE:'local', SITE_ORIGIN:'https://hadesd.sh', WORKER_POLL_MS:'3000'
};
await writeFile(resolve(root, '.env'), Object.entries(entries).map(([k,v])=>`${k}=${v}`).join('\n')+'\n', {mode:0o600,flag:'wx'});
await configureMinio(root);
console.log('已生成 .env 和 .local/admin-password（权限 600），密码未打印。下一步启动数据库并创建管理员。');
