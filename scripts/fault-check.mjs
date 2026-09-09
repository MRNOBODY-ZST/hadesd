import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Session } from './api-session.mjs';

// Explicit local acceptance drill: stop one dependency, then always restore it.
const root = path.resolve(import.meta.dirname, '..');
const origin = `http://127.0.0.1:${process.env.LOCAL_PORT || 18088}`;
const report = { performedAt: new Date().toISOString(), checks: [] };
const session = new Session(origin);
await session.login();
async function compose(...args) {
  await new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', '--env-file', '.env', '-f', 'infra/compose/dependencies.yaml', ...args], {
      cwd: root, env: process.env, stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Dependency command failed (${code})`)));
    child.stderr.resume();
  });
}
async function staticBody() {
  const response = await fetch(`${origin}/posts/welcome-to-hadesd`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('让好奇心持续运行'));
  return createHash('sha256').update(html).digest('hex');
}
const originalHtml = await staticBody();
const contentsBefore = await session.request('/admin/contents');
for (const dependency of ['mysql', 'redis']) {
  try {
    await compose('stop', dependency);
    assert.equal(await staticBody(), originalHtml);
    const search = await fetch(`${origin}/api/v1/public/search?q=${encodeURIComponent('欢迎')}`, { signal: AbortSignal.timeout(35000) });
    const result = await search.json();
    assert.equal(search.status, dependency === 'mysql' ? 503 : 200);
    if (dependency === 'mysql') assert.equal(result.code, 'SERVICE_UNAVAILABLE');
    else {
      assert.ok(result.items.some(item => item.slug === 'welcome-to-hadesd'));
      const admin = await session.request('/admin/contents', { raw: true });
      assert.equal(admin.status, 503);
      report.checks.push({ dependency, staticStatus: 200, htmlUnchanged: true, publicSearch: search.status, authenticatedAdmin: admin.status });
      continue;
    }
    report.checks.push({ dependency, staticStatus: 200, htmlUnchanged: true, publicSearch: search.status, errorCode: result.code });
  } finally {
    await compose('up', '-d', '--wait', dependency);
  }
}
const contentsAfter = await session.request('/admin/contents');
assert.equal(contentsAfter.total, contentsBefore.total);
assert.equal(await staticBody(), originalHtml);
report.result = 'PASS';
report.persistedContentsAfterRestart = contentsAfter.total;
await mkdir(path.join(root, '.local/reports'), { recursive: true });
await writeFile(path.join(root, '.local/reports/fault-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
