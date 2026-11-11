import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArticle, previewSnapshot, editorialSettings, publishDevelopment, isQaDraft } from './publish-development.mjs';

const article = { type: 'POST', slug: 'building-hadesd', title: '研发手记', summary: '从源码理解博客', markdown: '# 实现\n\n正文。\n', tags: ['研发'], language: 'zh-CN', coverMediaId: null };
const legacy = { id: 'old', type: 'POST', version: 2, latestRevision: { ...article, id: 'old-revision', slug: 'welcome-to-hadesd' } };

function fixture({ existing, failPublish = false } = {}) {
  const state = { events: [], contents: existing ? [existing, legacy] : [legacy], online: [{ ...legacy.latestRevision, id: legacy.id, revisionId: 'old-revision', type: 'POST' }], settings: editorialSettings(), release: { releaseId: 'before' } };
  if (existing) state.online.push({ ...existing.latestRevision, id: existing.id, revisionId: existing.latestRevision.id, type: existing.type });
  const session = {
    origin: 'https://example.test',
    async request(endpoint, options = {}) {
      const method = options.method || 'GET';
      if (method !== 'GET') state.events.push(`${method} ${endpoint}`);
      const url = new URL(endpoint, 'https://example.test');
      const pathname = url.pathname;
      const page = items => ({ items, total: items.length, page: 0, size: 100 });
      if (pathname === '/public/release') return state.release;
      if (pathname === '/public/site') return { ...state.settings, homeText: '当前公开文案' };
      if (pathname === '/admin/settings') {
        if (method === 'PUT') state.settings = options.body;
        return state.settings;
      }
      if (pathname === '/public/contents') return page(state.online);
      if (pathname === '/admin/contents') {
        if (method === 'POST') {
          const content = { id: 'new', type: options.body.type, version: 1, latestRevision: { ...options.body, id: 'new-revision' } };
          state.contents.push(content); return content;
        }
        return page(url.searchParams.get('trash') === 'true' ? [] : state.contents);
      }
      const id = pathname.split('/')[3];
      const content = state.contents.find(c => c.id === id);
      if (pathname.endsWith('/revisions')) return page([content.latestRevision]);
      if (method === 'DELETE') { state.contents = state.contents.filter(c => c.id !== id); return null; }
      assert(content, `Unexpected endpoint ${endpoint}`);
      return content;
    },
    async publish(request) {
      state.events.push(request.operation);
      if (failPublish) throw new Error('Build failed');
      if (request.operation === 'WITHDRAW') state.online = state.online.filter(c => c.id !== request.contentId);
      if (request.operation === 'PUBLISH') {
        const content = state.contents.find(c => c.id === request.contentId);
        state.online = state.online.filter(c => c.id !== content.id);
        state.online.push({ ...content.latestRevision, id: content.id, type: content.type, revisionId: request.revisionId });
      }
      state.release = { releaseId: 'after' };
    },
  };
  return { state, session, backup: async data => { assert.equal(data.active.length, state.contents.length); assert.equal(data.revisions.old[0].id, 'old-revision'); assert.equal(data.publicSnapshot.site.homeText, '当前公开文案'); assert.equal(data.publicSnapshot.releaseId, 'before'); state.events.push('BACKUP'); }, log: () => {} };
}

test('article source maps page types and rejects invalid/ambiguous metadata', () => {
  const source = '---\nslug: "about"\ntitle: "关于"\nsummary: "项目说明"\ntype: ABOUT\ntags: ["研发"]\n---\n# 关于\n';
  assert.equal(parseArticle(source, 'about.md').type, 'PAGE');
  assert.throws(() => parseArticle(source.replace('type: ABOUT', 'type: UNKNOWN'), 'bad.md'));
  assert.throws(() => parseArticle(source.replace('slug: "about"', 'slug: "../about"'), 'bad.md'));
  assert.throws(() => parseArticle(source.replace('type: ABOUT', 'title: "重复"\ntype: ABOUT'), 'bad.md'));
  const snapshot = previewSnapshot([article], '2026-11-11T00:00:00.000Z');
  assert.equal(snapshot.contents[0].route, '/posts/building-hadesd');
});

test('default plan makes no changes and does not require a backup store', async () => {
  const env = fixture();
  const result = await publishDevelopment({ ...env, articles: [article], replaceDemo: true });
  assert.equal(result.applied, false);
  assert.deepEqual(env.state.events, []);
});

test('failed backups prevent all editorial writes', async () => {
  const env = fixture();
  await assert.rejects(publishDevelopment({ ...env, articles: [article], apply: true, replaceDemo: true, backup: async () => { throw new Error('Disk full'); } }), /Disk full/);
  assert.deepEqual(env.state.events, []);
});

test('failed replacement publication leaves legacy content online and out of trash', async () => {
  const env = fixture({ failPublish: true });
  await assert.rejects(publishDevelopment({ ...env, articles: [article], apply: true, replaceDemo: true }), /Build failed/);
  assert.equal(env.state.events[0], 'BACKUP');
  assert(!env.state.events.some(event => event === 'WITHDRAW' || event.startsWith('DELETE')));
  assert(env.state.online.some(c => c.id === 'old'));
});

test('replacements are published before legacy withdrawal and recoverable deletion', async () => {
  const env = fixture();
  const result = await publishDevelopment({ ...env, articles: [article], apply: true, replaceDemo: true });
  assert(result.applied);
  assert.deepEqual(env.state.events, ['BACKUP', 'POST /admin/contents', 'PUBLISH', 'WITHDRAW', 'DELETE /admin/contents/old?version=2']);
  assert.equal(env.state.online.length, 1);
});

test('an unchanged already published article is reused without a new revision or build', async () => {
  const env = fixture({ existing: { id: 'existing', type: 'POST', version: 3, latestRevision: { ...article, id: 'same' } } });
  await publishDevelopment({ ...env, articles: [article], apply: true });
  assert.deepEqual(env.state.events, ['BACKUP']);
});

test('QA cleanup requires both the known test slug and exact test title', () => {
  const qa = { type: 'POST', latestRevision: { slug: 'qa-mouse-1788962451621', title: '示例验收 · 纯鼠标写作与发布' } };
  assert(isQaDraft(qa));
  assert(!isQaDraft({ ...qa, latestRevision: { ...qa.latestRevision, title: '真实文章' } }));
  assert(!isQaDraft({ ...qa, latestRevision: { ...qa.latestRevision, slug: 'my-qa-mouse' } }));
});

test('series retirement requires an explicit flag and only matches retired POST slugs', async () => {
  const env = fixture();
  env.state.contents[0] = { ...legacy, latestRevision: { ...legacy.latestRevision, slug: 'building-hadesd-architecture' } };
  env.state.online[0].slug = 'building-hadesd-architecture';
  const plan = await publishDevelopment({ ...env, articles: [article], replaceSeries: true });
  assert.equal(plan.applied, false);
  assert.deepEqual(env.state.events, []);
  await publishDevelopment({ ...env, articles: [article], apply: true });
  assert(env.state.contents.some(c => c.id === 'old'));
  const second = fixture();
  second.state.contents[0] = { ...legacy, latestRevision: { ...legacy.latestRevision, slug: 'building-hadesd-architecture' } };
  second.state.online[0].slug = 'building-hadesd-architecture';
  await publishDevelopment({ ...second, articles: [article], apply: true, replaceSeries: true });
  assert.deepEqual(second.state.events, ['BACKUP', 'POST /admin/contents', 'PUBLISH', 'WITHDRAW', 'DELETE /admin/contents/old?version=2']);
  const page = fixture();
  page.state.contents[0] = { ...legacy, type: 'PAGE', latestRevision: { ...legacy.latestRevision, slug: 'building-hadesd-architecture' } };
  await publishDevelopment({ ...page, articles: [article], apply: true, replaceSeries: true });
  assert(!page.state.events.includes('WITHDRAW'));
});

test('failed story publication keeps the retired series available', async () => {
  const env = fixture({ failPublish: true });
  env.state.contents[0] = { ...legacy, latestRevision: { ...legacy.latestRevision, slug: 'building-hadesd-terminal-crt' } };
  await assert.rejects(publishDevelopment({ ...env, articles: [article], apply: true, replaceSeries: true }), /Build failed/);
  assert(!env.state.events.some(event => event === 'WITHDRAW' || event.startsWith('DELETE')));
  assert(env.state.contents.some(c => c.id === 'old'));
});
