import { randomBytes } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

// Extend configuration only. Existing credentials and the active storage mode
// are preserved so preparing MinIO never switches a running installation.
export async function configureMinio(root, filename = resolve(root, '.env')) {
  const source = await readFile(filename, 'utf8');
  const existing = parseEnv(source);
  const secret = () => randomBytes(32).toString('hex');
  const defaults = {
    MINIO_ROOT_USER: `hadesd-root-${randomBytes(6).toString('hex')}`,
    MINIO_ROOT_PASSWORD: secret(),
    AWS_ACCESS_KEY_ID: `hadesd-app-${randomBytes(6).toString('hex')}`,
    AWS_SECRET_ACCESS_KEY: secret(),
    S3_BUCKET: 'hadesd-media', S3_REGION: 'us-east-1',
    S3_ENDPOINT: 'http://127.0.0.1:19000', S3_PATH_STYLE: 'true', MINIO_PORT: '19000',
  };
  const additions = Object.entries(defaults).filter(([key]) => !existing[key]?.trim());
  if (additions.length) {
    await appendFile(filename, `${source.endsWith('\n') ? '' : '\n'}# Private MinIO storage (prepared; STORAGE_MODE unchanged)\n${additions.map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 });
  }
  return additions.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await configureMinio(resolve(import.meta.dirname, '..'));
  console.log('MinIO 配置已准备；已有配置、密钥和 STORAGE_MODE 保持不变。凭据未打印。详见 docs/minio.md。');
}
