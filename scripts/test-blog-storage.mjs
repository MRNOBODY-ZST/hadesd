import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Session } from './api-session.mjs';

if (process.env.HADESD_ISOLATED_TEST !== 'true') {
  throw new Error('This smoke test requires HADESD_ISOLATED_TEST=true and an isolated database, release directory and object bucket');
}
if (!process.env.API_ORIGIN) throw new Error('API_ORIGIN must explicitly identify the isolated backend');
const origin = new URL(process.env.API_ORIGIN);
if (!['backend', 'localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
  throw new Error('Isolated smoke API_ORIGIN must use backend or a loopback host; public hosts are refused');
}
if (!process.env.ADMIN_BOOTSTRAP_PASSWORD_FILE) throw new Error('Mount ADMIN_BOOTSTRAP_PASSWORD_FILE for the isolated administrator');

const report = { performedAt: new Date().toISOString(), result: 'RUNNING', checks: [], cleanup: [], retainedQaFixtures: {} };
const admin = new Session(origin.href);
const anonymous = new Session(origin.href);
const suffix = randomUUID().slice(0, 8);
const prefix = `qa-storage-${suffix}`;
const commentsToRemove = new Set();
const filesToRemove = [];
let baselineReleaseId = null;
let originalContents = [];
let originalSite;
let content;
let uploadedMedia;
let publicationChanged = false;
let failure;

function passed(check) {
  report.checks.push(check);
  console.log(`PASS ${check}`);
}

async function expectStatus(session, endpoint, status, options = {}, code) {
  const response = await session.request(endpoint, { ...options, raw: true });
  const body = await response.text();
  assert.equal(response.status, status, `${options.method || 'GET'} ${endpoint}: expected ${status}, got ${response.status}`);
  if (code) assert.equal(JSON.parse(body).code, code);
  return response;
}

async function bytes(session, endpoint, expected) {
  const response = await session.request(endpoint, { raw: true });
  assert.equal(response.status, 200, `Download failed: ${endpoint}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response;
}

async function upload(session, endpoint, name, body, mime = 'text/plain') {
  const form = new FormData();
  form.append('file', new Blob([body], { type: mime }), name);
  return session.request(endpoint, { method: 'POST', body: form });
}

async function allPublicContents() {
  const contents = [];
  for (let page = 0; ; page++) {
    const result = await anonymous.request(`/public/contents?size=100&page=${page}`);
    contents.push(...result.items);
    if (contents.length >= result.total) return contents;
  }
}

function revisionBody(version, revision, changes = {}) {
  const { title, slug, summary, markdown, tags, language, coverMediaId } = revision;
  return { version, title, slug, summary, markdown, tags, language, coverMediaId, ...changes };
}

async function registerReader(label) {
  const session = new Session(origin.href);
  const username = `qa-${suffix}-${label}`;
  const password = randomBytes(24).toString('base64url');
  await session.refreshCsrf();
  const user = await session.request('/auth/register', {
    method: 'POST', body: { username, displayName: `QA Reader ${label}`, password },
  });
  assert.equal(user.role, 'USER');
  assert.equal('password' in user, false);
  await expectStatus(session, '/auth/me', 401);
  await session.request('/auth/login', { method: 'POST', body: new URLSearchParams({ username, password }) });
  await session.refreshCsrf();
  assert.equal((await session.request('/auth/me')).id, user.id);
  return { session, user };
}

async function publish(body) {
  // A timed-out wait can still leave a job running; always attempt restoration.
  publicationChanged = true;
  const job = await admin.publish(body);
  return job;
}

try {
  assert.equal((await admin.login()).role, 'ADMIN');
  await anonymous.refreshCsrf();
  originalContents = await allPublicContents();
  originalSite = await anonymous.request('/public/site');
  baselineReleaseId = (await anonymous.request('/public/release')).releaseId;
  if (!baselineReleaseId) {
    baselineReleaseId = (await publish({ operation: 'INITIALIZE' })).releaseId;
  }
  report.baselineReleaseId = baselineReleaseId;

  await expectStatus(anonymous, '/admin/contents', 401);
  passed('administrator authentication and anonymous admin boundary');

  const mediaBytes = Buffer.from(`QA MinIO bytes ${suffix}\n中文附件\n`, 'utf8');
  uploadedMedia = await upload(admin, '/admin/media', `${prefix}.txt`, mediaBytes);
  assert.equal(uploadedMedia.size, mediaBytes.length);
  assert.equal(uploadedMedia.mime, 'text/plain');
  const privateDownload = await bytes(admin, `/admin/media/${uploadedMedia.id}/content`, mediaBytes);
  assert.match(privateDownload.headers.get('content-disposition'), /^attachment;/);
  await expectStatus(anonymous, `/public/media/${uploadedMedia.id}`, 404);
  passed('private MinIO-backed admin upload and exact-byte download');

  const removedMedia = await upload(admin, '/admin/media', `${prefix}-delete.txt`, Buffer.from('QA remove me'));
  await admin.request(`/admin/media/${removedMedia.id}`, { method: 'DELETE' });
  await expectStatus(admin, `/admin/media/${removedMedia.id}/content`, 404);
  passed('unreferenced admin attachment deletion');

  const originalMarkdown = `# QA original ${suffix}\n\n[QA attachment](/api/v1/public/media/${uploadedMedia.id})\n`;
  content = await admin.request('/admin/contents', { method: 'POST', body: {
    type: 'POST', title: `QA storage original ${suffix}`, slug: prefix,
    summary: 'QA isolated integration fixture', markdown: originalMarkdown,
    tags: ['QA', 'storage'], language: 'zh-CN', coverMediaId: null,
  } });
  const originalRevision = content.latestRevision;
  await expectStatus(anonymous, `/public/contents/${content.id}`, 404);
  await expectStatus(anonymous, `/public/contents/${content.id}/comments`, 404);
  passed('new draft and its comments remain private');

  const staleVersion = content.version;
  content = await admin.request(`/admin/contents/${content.id}/revisions`, { method: 'POST', body:
    revisionBody(content.version, originalRevision, { title: `QA unpublished ${suffix}`, markdown: `# QA private revision ${suffix}` }),
  });
  assert.notEqual(content.latestRevision.id, originalRevision.id);
  assert.equal(content.version, staleVersion + 1);
  await expectStatus(admin, `/admin/contents/${content.id}/revisions`, 409, { method: 'POST', body:
    revisionBody(staleVersion, originalRevision, { title: 'QA stale conflicting edit' }),
  }, 'REVISION_CONFLICT');
  assert.equal((await admin.request(`/admin/contents/${content.id}/revisions/${originalRevision.id}`)).markdown, originalMarkdown);
  const history = await admin.request(`/admin/contents/${content.id}/revisions?size=100`);
  assert.equal(history.total, 2);
  assert.equal((await admin.request(`/admin/contents/${content.id}`)).version, staleVersion + 1);
  passed('immutable revision history and stale-version conflict without extra revision');

  const publishedJob = await publish({ operation: 'PUBLISH', contentId: content.id, revisionId: originalRevision.id });
  let publicContent = await anonymous.request(`/public/contents/${content.id}`);
  assert.equal(publicContent.revisionId, originalRevision.id);
  assert.equal(publicContent.markdown, originalMarkdown);
  assert.equal(publicContent.title, originalRevision.title);
  await bytes(anonymous, `/public/media/${uploadedMedia.id}`, mediaBytes);
  await expectStatus(admin, `/admin/media/${uploadedMedia.id}`, 409, { method: 'DELETE' }, 'MEDIA_REFERENCED');
  passed('publication selects explicit historical revision and retains referenced media');

  content = await admin.request(`/admin/contents/${content.id}/revisions`, { method: 'POST', body:
    revisionBody(content.version, content.latestRevision, { markdown: `# QA private after publication ${suffix}` }),
  });
  publicContent = await anonymous.request(`/public/contents/${content.id}`);
  assert.equal(publicContent.revisionId, originalRevision.id);
  assert.equal(publicContent.markdown, originalMarkdown);
  const results = await anonymous.request(`/public/search?q=${encodeURIComponent(suffix)}&size=100`);
  assert.ok(results.items.some(item => item.id === content.id));
  assert.equal(results.items.find(item => item.id === content.id).markdown, originalMarkdown);
  passed('post-publication edits remain private in article and search results');

  const a = await registerReader('a');
  const b = await registerReader('b');
  report.retainedQaFixtures.readerIds = [a.user.id, b.user.id];
  for (const endpoint of ['/admin/contents', '/admin/media', '/admin/comments', '/admin/releases']) {
    await expectStatus(a.session, endpoint, 403);
  }
  const profile = await a.session.request('/account/profile', { method: 'PUT', body: { displayName: `QA Updated ${suffix}` } });
  assert.equal(profile.displayName, `QA Updated ${suffix}`);
  assert.equal(profile.username, a.user.username);
  passed('reader registration login profile and administrator ACL');

  const userBytes = Buffer.from(`QA reader attachment ${suffix}\n中文`, 'utf8');
  const file = await upload(a.session, '/account/files', `${prefix}-reader.txt`, userBytes);
  filesToRemove.push({ session: a.session, id: file.id });
  await bytes(a.session, `/account/files/${file.id}/content`, userBytes);
  assert.ok((await a.session.request('/account/files?size=100')).items.some(item => item.id === file.id));
  await expectStatus(b.session, `/account/files/${file.id}/content`, 404);
  await expectStatus(b.session, `/account/files/${file.id}`, 404, { method: 'DELETE' });
  await expectStatus(anonymous, `/public/comment-files/${file.id}`, 404);
  passed('reader MinIO attachment ownership and unpublished file privacy');

  const commentsEndpoint = `/public/contents/${content.id}/comments`;
  await expectStatus(anonymous, commentsEndpoint, 401, { method: 'POST', body: { body: 'QA anonymous rejected' } });
  await expectStatus(b.session, commentsEndpoint, 404, { method: 'POST', body: { body: 'QA stolen file rejected', attachmentIds: [file.id] } });
  const comment = await a.session.request(commentsEndpoint, { method: 'POST', body: { body: 'QA first comment', attachmentIds: [file.id] } });
  commentsToRemove.add(comment.id);
  assert.equal(comment.author.id, a.user.id);
  assert.equal(comment.attachments[0].id, file.id);
  await bytes(anonymous, `/public/comment-files/${file.id}`, userBytes);
  await expectStatus(a.session, `/account/files/${file.id}`, 409, { method: 'DELETE' }, 'FILE_REFERENCED');
  await expectStatus(b.session, `/account/comments/${comment.id}`, 404, { method: 'PUT', body: { body: 'QA forged edit' } });
  await expectStatus(b.session, `/account/comments/${comment.id}`, 404, { method: 'DELETE' });
  const reply = await b.session.request(commentsEndpoint, { method: 'POST', body: { body: 'QA reply', parentId: comment.id } });
  commentsToRemove.add(reply.id);
  assert.equal(reply.parentId, comment.id);
  await expectStatus(a.session, commentsEndpoint, 400, { method: 'POST', body: { body: 'QA nested reply rejected', parentId: reply.id } }, 'INVALID_PARENT');
  assert.equal((await anonymous.request(`${commentsEndpoint}?size=100`)).total, 2);
  passed('comments replies attachment publication and ownership validation');

  const edited = await a.session.request(`/account/comments/${comment.id}`, { method: 'PUT', body: { body: 'QA edited; attachment retained' } });
  assert.equal(edited.attachments.length, 1);
  assert.equal(edited.body, 'QA edited; attachment retained');
  passed('comment edits retain attachments when field omitted');

  await publish({ operation: 'WITHDRAW', contentId: content.id });
  await expectStatus(anonymous, `/public/contents/${content.id}`, 404);
  await expectStatus(anonymous, `/public/media/${uploadedMedia.id}`, 404);
  await expectStatus(anonymous, commentsEndpoint, 404);
  await expectStatus(anonymous, `/public/comment-files/${file.id}`, 404);
  await bytes(a.session, `/account/files/${file.id}/content`, userBytes);
  passed('withdrawal revokes article and both public attachment classes while preserving owner access');

  await publish({ operation: 'ROLLBACK', releaseId: publishedJob.releaseId });
  assert.equal((await anonymous.request(`/public/contents/${content.id}`)).revisionId, originalRevision.id);
  await bytes(anonymous, `/public/media/${uploadedMedia.id}`, mediaBytes);
  await bytes(anonymous, `/public/comment-files/${file.id}`, userBytes);
  passed('rollback restores exact published revision and its public media');

  const detached = await a.session.request(`/account/comments/${comment.id}`, { method: 'PUT', body: { body: 'QA attachment detached', attachmentIds: [] } });
  assert.equal(detached.attachments.length, 0);
  await expectStatus(anonymous, `/public/comment-files/${file.id}`, 404);
  await a.session.request(`/account/files/${file.id}`, { method: 'DELETE' });
  filesToRemove.splice(filesToRemove.findIndex(item => item.id === file.id), 1);
  await expectStatus(a.session, `/account/files/${file.id}/content`, 404);
  await b.session.request(`/account/comments/${reply.id}`, { method: 'DELETE' });
  commentsToRemove.delete(reply.id);
  await a.session.request(`/account/comments/${comment.id}`, { method: 'DELETE' });
  commentsToRemove.delete(comment.id);
  assert.equal((await anonymous.request(`${commentsEndpoint}?size=100`)).total, 0);
  passed('attachment detach and owner file/comment deletion');

  const moderated = await a.session.request(commentsEndpoint, { method: 'POST', body: { body: 'QA moderation fixture' } });
  commentsToRemove.add(moderated.id);
  await admin.request(`/admin/comments/${moderated.id}`, { method: 'DELETE' });
  commentsToRemove.delete(moderated.id);
  assert.equal((await anonymous.request(`${commentsEndpoint}?size=100`)).total, 0);
  await a.session.request('/auth/logout', { method: 'POST' });
  await expectStatus(a.session, '/auth/me', 401);
  passed('administrator moderation and logout invalidation');
} catch (error) {
  failure = error;
  report.error = error.message;
} finally {
  for (const id of commentsToRemove) {
    try { await admin.request(`/admin/comments/${id}`, { method: 'DELETE' }); }
    catch (error) { report.cleanup.push(`comment cleanup failed: ${id}`); failure ||= error; }
  }
  for (const file of filesToRemove) {
    try { await file.session.request(`/account/files/${file.id}`, { method: 'DELETE' }); }
    catch (error) { report.cleanup.push(`file cleanup failed: ${file.id}`); failure ||= error; }
  }
  if (publicationChanged && baselineReleaseId) {
    try {
      await admin.publish({ operation: 'ROLLBACK', releaseId: baselineReleaseId });
      const finalContents = await allPublicContents();
      assert.deepEqual(finalContents, originalContents);
      assert.deepEqual(await anonymous.request('/public/site'), originalSite);
      report.cleanup.push('original public content and site settings restored');
      passed('public baseline restored after test');
    } catch (error) {
      report.cleanup.push('PUBLIC BASELINE RESTORE FAILED; isolated environment needs attention');
      failure ||= error;
    }
  }
  if (content) report.retainedQaFixtures.contentId = content.id;
  if (uploadedMedia) report.retainedQaFixtures.mediaId = uploadedMedia.id;
  report.retainedQaFixtures.reason = 'Immutable revisions, historical releases and reader accounts are retained only in the isolated test dataset';
  report.result = failure ? 'FAIL' : 'PASS';
  report.finishedAt = new Date().toISOString();
  if (process.env.HADESD_TEST_REPORT) await writeFile(process.env.HADESD_TEST_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}
if (failure) process.exitCode = 1;
