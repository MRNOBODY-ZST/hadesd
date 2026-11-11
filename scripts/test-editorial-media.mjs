// Isolated real-Nginx check: requires Docker, does not touch the running blog.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { renderNginxConfig } from './nginx-config.mjs';

const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, '.local'), { recursive: true });
const dir = await mkdtemp(resolve(root, '.local/editorial-guard-'));
const name = `hadesd-editorial-check-${process.pid}`;
const image = 'nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6';
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message);
  return result.stdout.trim();
}
function get(base, host, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { headers: { Host: host, ...headers } }, res => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject); req.end();
  });
}
try {
  for (const frontend of ['site', 'journal']) {
    await mkdir(`${dir}/published/current/${frontend}/editorial`, { recursive: true });
    await writeFile(`${dir}/published/current/${frontend}/editorial/probe.png`, 'public image fixture');
  }
  const source = await readFile(resolve(root, 'infra/nginx/default.conf'), 'utf8');
  // No backend is needed to exercise the static-media locations.
  const config = renderNginxConfig(source, 'https://hadesd.sh', '', 'https://itshades.dev')
    .replaceAll('http://backend:8080', 'http://127.0.0.1:9');
  await writeFile(`${dir}/default.conf`, config);
  docker(['run', '-d', '--name', name, '-p', '127.0.0.1::8080', '--read-only', '--tmpfs', '/tmp',
    '-v', `${dir}/default.conf:/etc/nginx/conf.d/default.conf:ro`,
    '-v', `${dir}/published:/srv/published:ro`, image]);
  const base = `http://${docker(['port', name, '8080/tcp'])}`;
  for (let attempt = 0; ; attempt++) {
    try { if ((await get(base, 'hadesd.sh', '/health')).status === 200) break; } catch {}
    if (attempt >= 50) throw new Error('Test Nginx did not become healthy');
    await delay(100);
  }
  docker(['exec', name, 'nginx', '-t']);
  let checks = 0;
  for (const host of ['hadesd.sh', 'itshades.dev']) {
    for (const headers of [{}, { Referer: `https://${host}/posts/example`, 'Sec-Fetch-Site': 'same-origin' },
      { Referer: 'https://external.test/', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' }]) {
      const response = await get(base, host, '/editorial/probe.png', headers);
      assert.equal(response.status, 200, `${host} ${JSON.stringify(headers)}\n${response.status === 200 ? '' : docker(['logs', name])}`);
      assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
      assert.equal(response.headers['cloudflare-cdn-cache-control'], 'no-store');
      assert.match(response.headers['cache-control'], /no-store/);
      checks++;
    }
    for (const headers of [{ Referer: 'https://external.test/' }, { Referer: `https://${host}.external.test/` },
      { Referer: 'https://localhost/' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe' }]) {
      const response = await get(base, host, '/editorial/probe.png', headers);
      assert.equal(response.status, 403);
      assert.match(response.headers['cache-control'], /no-store/);
      checks++;
    }
    assert.equal((await get(base, host, '/editorial/missing.png')).status, 404);
    checks++;
  }
  console.log(`PASS: nginx -t and ${checks} HTTP checks across both frontend hosts.`);
} finally {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  await rm(dir, { recursive: true, force: true });
}
