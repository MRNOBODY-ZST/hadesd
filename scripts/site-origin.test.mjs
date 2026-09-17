import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { normalizeSiteOrigin } from '../packages/contracts/src/site-origin.mjs';
const exec = promisify(execFile);

test('site origins accept http/https authorities and reject credentials or subpaths', () => {
  assert.equal(normalizeSiteOrigin(), 'http://localhost:18088');
  assert.equal(normalizeSiteOrigin('https://notes.example.org/'), 'https://notes.example.org');
  assert.equal(normalizeSiteOrigin('http://127.0.0.1:18991'), 'http://127.0.0.1:18991');
  for (const bad of ['javascript:alert(1)', 'https://user:secret@example.org', 'https://example.org/blog', 'https://example.org/?q=1', 'https://example.org/#x', '//example.org', 'invalid']) {
    assert.throws(() => normalizeSiteOrigin(bad), /SITE_ORIGIN/);
  }
});

test('standalone SEO generation uses the configured origin and XML-escapes content', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'blog-seo-'));
  try {
    const snapshotFile = path.join(temporary, 'snapshot.json');
    await writeFile(snapshotFile, JSON.stringify({ releaseId: 'demo', site: { title: 'Notes & things', tagline: 'Read <this>' }, contents: [{ id: 'one', type: 'POST', route: '/posts/hello', tags: ['中文'], title: 'First & second', summary: 'A < B', publishedAt: '2026-09-17T00:00:00Z' }] }));
    await exec(process.execPath, ['scripts/seo.mjs'], { cwd: path.resolve('apps/web'), env: { ...process.env, SITE_ORIGIN: 'https://notes.example.org', HADESD_BUILD_DIR: path.join(temporary, 'build'), HADESD_SNAPSHOT: snapshotFile } });
    const [rss, sitemap, robots] = await Promise.all(['rss.xml', 'sitemap.xml', 'robots.txt'].map(name => readFile(path.join(temporary, 'build/client', name), 'utf8')));
    for (const file of [rss, sitemap, robots]) { assert.match(file, /https:\/\/notes\.example\.org/); assert.doesNotMatch(file, /hadesd\.sh/); }
    assert.match(rss, /Notes &amp; things/);
    assert.match(rss, /https:\/\/notes\.example\.org\/posts\/hello/);
    assert.match(sitemap, /\/tags\/%E4%B8%AD%E6%96%87/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
