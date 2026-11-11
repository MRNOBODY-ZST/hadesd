#!/usr/bin/env node
// Editorial import through the authenticated API; no direct database writes.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Session } from './api-session.mjs';

const root = resolve(import.meta.dirname, '..');
export const files = ['01-architecture.md', '02-terminal-crt.md', '03-atomic-publishing.md', '04-self-hosting-validation.md', 'about.md', 'now.md'];
export const demoSlugs = new Set(['welcome-to-hadesd', 'two-ways-one-story', 'time-and-backpressure', 'hadesd-demo']);
export function isQaDraft(content) {
  const { slug, title } = content.latestRevision;
  return content.type === 'POST' && (
    /^qa-mouse-\d+$/.test(slug) && title === '示例验收 · 纯鼠标写作与发布' ||
    /^qa-lifecycle-\d+$/.test(slug) && title === '示例验收 · Reactive 发布闭环' ||
    /^admin-qa-\d+$/.test(slug) && title === '后台验证 · 写作与修订');
}

export function parseArticle(source, filename) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/u);
  assert(match, `${filename}: missing front matter`);
  const data = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const item = line.match(/^(slug|title|summary|type|tags):\s*(.+)$/u);
    assert(item && !(item[1] in data), `${filename}: unknown or duplicate front matter field`);
    // The checked-in source uses JSON strings/arrays, a deliberately small YAML subset.
    data[item[1]] = item[2].startsWith('"') || item[2].startsWith('[') ? JSON.parse(item[2]) : item[2];
  }
  for (const field of ['slug', 'title', 'summary', 'type']) assert.equal(typeof data[field], 'string', `${filename}: ${field}`);
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug) && data.slug.length <= 100, `${filename}: invalid slug`);
  assert(data.title.trim() && data.title.length <= 200 && data.summary.length <= 1000, `${filename}: invalid text lengths`);
  assert(Array.isArray(data.tags) && data.tags.length <= 30 && data.tags.every(tag => typeof tag === 'string' && tag.trim() && tag.length <= 40), `${filename}: invalid tags`);
  assert(['POST', 'ABOUT', 'NOW'].includes(data.type), `${filename}: unsupported content type`);
  if (data.type !== 'POST') assert.equal(data.slug, data.type.toLowerCase(), `${filename}: page slug mismatch`);
  const markdown = match[2].trim() + '\n';
  assert(markdown.length <= 2000000, `${filename}: article too long`);
  return { ...data, type: data.type === 'POST' ? 'POST' : 'PAGE', markdown, language: 'zh-CN', coverMediaId: null };
}

export async function readArticles() {
  const articles = await Promise.all(files.map(async file => parseArticle(await readFile(resolve(root, 'content/development', file), 'utf8'), file)));
  assert.equal(new Set(articles.map(item => item.slug)).size, articles.length, 'Duplicate editorial slugs');
  return articles;
}

export function editorialSettings(current = {}) {
  return {
    ...current,
    title: current.title || 'HADESD',
    tagline: '从想法，到运行中的系统。',
    introduction: 'Hades / 研发手记',
    homeText: '记录这个博客如何被设计、实现和部署。\n从终端交互到静态发布，把每一个选择讲清楚。',
    navigation: [{ label: '研发手记', href: '/posts' }, { label: '关于', href: '/about' }, { label: '近况', href: '/now' }, { label: '源码', href: '/links' }],
    links: [{ label: 'HADESD · GitHub', url: 'https://github.com/MRNOBODY-ZST/hadesd', description: '博客源码、部署文档与开发记录。' }],
  };
}

export function previewSnapshot(articles, now = new Date().toISOString()) {
  return {
    releaseId: 'development-preview', createdAt: now,
    site: editorialSettings({ title: 'HADESD', heroTitle: '让想象，\n接通现实。' }),
    contents: articles.map((item, index) => ({
      ...item, id: `development-${item.slug}`, revisionId: `preview-${index}`,
      route: item.type === 'PAGE' ? `/${item.slug}` : `/posts/${item.slug}`,
      publishedAt: new Date(Date.parse(now) - index * 1000).toISOString(), updatedAt: now,
    })),
  };
}

export async function collect(session, endpoint) {
  const result = [];
  for (let page = 0; ; page++) {
    const data = await session.request(`${endpoint}${endpoint.includes('?') ? '&' : '?'}page=${page}&size=100`);
    assert(Array.isArray(data.items) && Number.isSafeInteger(data.total), 'Invalid paginated API response');
    result.push(...data.items);
    if (result.length >= data.total) return result;
    assert(data.items.length, 'Collection changed during pagination; retry');
  }
}

function sameRevision(a, b) {
  return ['title', 'slug', 'summary', 'markdown', 'language', 'coverMediaId'].every(key => (a[key] ?? null) === (b[key] ?? null)) && JSON.stringify(a.tags) === JSON.stringify(b.tags);
}

// `backup` must finish before the first mutation; tests inject a private store.
export async function publishDevelopment({ session, articles, replaceDemo = false, archiveQa = false, apply = false, backup, log = console.log }) {
  const before = await session.request('/public/release');
  const releaseQuery = before.releaseId ? `?releaseId=${encodeURIComponent(before.releaseId)}` : '';
  const publicSite = await session.request(`/public/site${releaseQuery}`);
  const settings = await session.request('/admin/settings');
  const active = await collect(session, '/admin/contents');
  const online = await collect(session, `/public/contents${releaseQuery}`);
  const plan = articles.map(article => {
    const matches = active.filter(c => c.type === article.type && c.latestRevision.slug === article.slug);
    assert(matches.length <= 1, `Ambiguous content slug: ${article.slug}`);
    const existing = matches[0];
    const published = online.find(c => c.id === existing?.id);
    return { article, existing, action: !existing ? 'create' : sameRevision(existing.latestRevision, article) ? 'reuse' : 'revise', needsPublish: !existing || !sameRevision(existing.latestRevision, article) || published?.revisionId !== existing.latestRevision.id };
  });
  const obsolete = active.filter(c => replaceDemo && demoSlugs.has(c.latestRevision.slug) || archiveQa && isQaDraft(c));
  log(JSON.stringify({ origin: session.origin, apply, articles: plan.map(({ article, action, needsPublish }) => ({ slug: article.slug, action, needsPublish })), archive: obsolete.map(c => ({ id: c.id, title: c.latestRevision.title })), preservedOtherDrafts: active.filter(c => !obsolete.includes(c) && !plan.some(p => p.existing?.id === c.id)).length }, null, 2));
  if (!apply) return { applied: false, plan };
  assert(backup, 'A private backup store is required before applying');
  const trash = await collect(session, '/admin/contents?trash=true');
  const revisions = {};
  for (const content of [...active, ...trash]) revisions[content.id] = await collect(session, `/admin/contents/${content.id}/revisions`);
  const sameRelease = await session.request('/public/release');
  assert.equal(sameRelease.releaseId, before.releaseId, 'Public release changed during backup; retry');
  await backup({ capturedAt: new Date().toISOString(), origin: session.origin, release: before, settings, active, trash, revisions, online,
    publicSnapshot: { releaseId: before.releaseId ?? 'empty', createdAt: before.createdAt ?? '', site: publicSite, contents: online } });
  // Settings and source revisions remain recoverable in the backup. Old articles
  // stay public until every replacement has finished a real publishing job.
  const desiredSettings = editorialSettings(settings);
  const settingsChanged = JSON.stringify(settings) !== JSON.stringify(desiredSettings);
  if (settingsChanged) await session.request('/admin/settings', { method: 'PUT', body: desiredSettings });
  let publishedAny = false;
  for (const item of [...plan].reverse()) {
    let content = item.existing;
    if (!content) content = await session.request('/admin/contents', { method: 'POST', body: item.article });
    else if (item.action === 'revise') content = await session.request(`/admin/contents/${content.id}/revisions`, { method: 'POST', body: { ...item.article, version: content.version } });
    if (item.needsPublish) {
      await session.publish({ operation: 'PUBLISH', contentId: content.id, revisionId: content.latestRevision.id });
      publishedAny = true;
      log(`Published: ${item.article.slug}`);
    }
  }
  if (settingsChanged && !publishedAny) await session.publish({ operation: 'SETTINGS' });
  for (const content of obsolete) {
    const latest = await session.request(`/admin/contents/${content.id}`);
    assert.equal(latest.version, content.version, `Draft changed since backup: ${content.id}`);
    if (online.some(c => c.id === content.id)) await session.publish({ operation: 'WITHDRAW', contentId: content.id });
    await session.request(`/admin/contents/${content.id}?version=${content.version}`, { method: 'DELETE' });
    log(`Moved to trash: ${content.latestRevision.slug}`);
  }
  const result = await collect(session, '/public/contents');
  for (const article of articles) assert(result.some(c => c.type === article.type && c.slug === article.slug && sameRevision(c, article)), `Published content mismatch: ${article.slug}`);
  if (replaceDemo) assert(!result.some(c => demoSlugs.has(c.slug)), 'Legacy demo content is still public');
  return { applied: true, release: await session.request('/public/release'), count: result.length };
}

async function cli() {
  const { values } = parseArgs({ options: { apply: { type: 'boolean' }, 'replace-demo': { type: 'boolean' }, 'archive-qa': { type: 'boolean' }, snapshot: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) {
    console.log('Usage: node [--env-file=PRIVATE_ENV] scripts/publish-development.mjs [--apply] [--replace-demo] [--archive-qa]\n       node scripts/publish-development.mjs --snapshot .local/development/snapshot.json\nDefault: read-only authenticated plan. --apply backs up content/settings/revisions under .local/backups before publishing.\n--replace-demo archives only the four original demo slugs after all replacements publish; no permanent deletion.\n--archive-qa also archives known QA drafts matching both their generated slug and exact test title.\nSet API_ORIGIN, ADMIN_BOOTSTRAP_USERNAME and ADMIN_BOOTSTRAP_PASSWORD_FILE for the intended site.');
    return;
  }
  const articles = await readArticles();
  if (values.snapshot) {
    assert(!values.apply && !values['replace-demo'] && !values['archive-qa'], '--snapshot cannot be combined with publication');
    const target = resolve(values.snapshot);
    const local = relative(resolve(root, '.local'), target);
    assert(local && local !== '..' && !local.startsWith(`..${sep}`) && !local.startsWith(sep), 'Preview snapshot must be under checkout .local');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(previewSnapshot(articles), null, 2));
    console.log(`Preview snapshot: ${target}`);
    return;
  }
  assert(process.env.API_ORIGIN, 'Set API_ORIGIN explicitly to the intended site');
  const session = new Session();
  await session.login();
  const result = await publishDevelopment({ session, articles, apply: values.apply, replaceDemo: values['replace-demo'], archiveQa: values['archive-qa'], backup: async data => {
    const destination = resolve(root, '.local/backups', `editorial-${new Date().toISOString().replaceAll(':', '-')}`);
    await mkdir(destination, { recursive: true, mode: 0o700 });
    await writeFile(resolve(destination, 'content-backup.json'), JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
    logBackup(destination);
  } });
  console.log(JSON.stringify({ applied: result.applied, release: result.release, count: result.count }));
}
function logBackup(destination) { console.log(`Private editorial backup: ${destination}`); }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) cli().catch(error => { console.error(error.message); process.exitCode = 1; });
