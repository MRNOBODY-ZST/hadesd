import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";

// The account/comment feature must be built and served before running this suite.
// Mutating acceptance tests require an explicitly isolated localhost QA deployment.
// They never publish or edit article revisions; each mutation uses a unique QA identity.
const article = "/posts/welcome-to-hadesd";
const longArticle = "/posts/time-and-backpressure";
const api = "/api/v1";
const shots = ".local/reports/terminal-blog-v2";
test.beforeEach(async ({ baseURL }) => {
  test.skip(process.env.HADESD_ISOLATED_TEST !== "true", "Set HADESD_ISOLATED_TEST=true only for an isolated QA deployment.");
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(baseURL!).hostname);
});
test.beforeAll(async () => { await mkdir(shots, { recursive: true }); });
test.afterEach(async ({ page }, info) => {
  if (page.url().startsWith("http")) await page.screenshot({ path: `${shots}/${info.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 90)}.png` });
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF5sAAAAASUVORK5CYII=", "base64");
type Identity = { username: string; displayName: string; password: string };
type User = { id: string; username: string; displayName: string; role: "USER" | "ADMIN" };
type FileInfo = { id: string; filename: string; mime: string; size: number };
type Comment = { id: string; contentId: string; parentId: string | null; body: string; author: User; attachments: FileInfo[] };

function identity(): Identity {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  return { username: `qa_${suffix}`, displayName: `验收读者 ${suffix}`, password: `E2E!${randomUUID()}` };
}
async function csrf(request: APIRequestContext) {
  const response = await request.get(api + "/auth/csrf");
  expect(response.status()).toBe(200);
  const token = await response.json() as { headerName: string; token: string };
  return { [token.headerName]: token.token };
}
async function loginApi(request: APIRequestContext, account: Identity) {
  const response = await request.post(api + "/auth/login", {
    headers: await csrf(request), form: { username: account.username, password: account.password },
  });
  expect(response.status()).toBe(200);
  const current = await request.get(api + "/auth/me");
  expect(current.status()).toBe(200);
  return await current.json() as User;
}
async function registerApi(request: APIRequestContext, account = identity()) {
  const response = await request.post(api + "/auth/register", { headers: await csrf(request), data: account });
  expect(response.status()).toBe(201);
  const registered = await response.json() as User;
  expect(registered.role).toBe("USER");
  const current = await loginApi(request, account);
  expect(current.id).toBe(registered.id);
  return { ...account, id: current.id };
}
async function upload(request: APIRequestContext, name = `qa-${randomUUID()}.png`) {
  const response = await request.post(api + "/account/files", {
    headers: await csrf(request), multipart: { file: { name, mimeType: "image/png", buffer: png } },
  });
  expect(response.status()).toBe(201);
  return await response.json() as FileInfo;
}
async function publishedArticle(request: APIRequestContext) {
  const response = await request.get(api + "/public/contents", { params: { size: 100 } });
  expect(response.status()).toBe(200);
  const content = (await response.json() as { items: { id: string; route: string }[] }).items.find(item => item.route === article);
  expect(content, "the published welcome article fixture must exist").toBeTruthy();
  return content!;
}
async function removeComment(request: APIRequestContext, id: string) {
  const response = await request.delete(`${api}/account/comments/${id}`, { headers: await csrf(request) });
  expect([204, 404], `cleanup comment ${id}`).toContain(response.status());
}
async function removeFile(request: APIRequestContext, id: string) {
  const response = await request.delete(`${api}/account/files/${id}`, { headers: await csrf(request) });
  expect([204, 404], `cleanup file ${id}`).toContain(response.status());
}
async function enterTerminal(page: Page, path = article) {
  // Feature tests use the supported Off preference. The public suite still tests both GPU paths.
  await page.addInitScript(() => localStorage.setItem("hadesd.display.v2", JSON.stringify({ theme: "amber", crt: "off", reader: false })));
  await page.goto(path);
  await expect(page.locator(".terminal-stage")).toHaveAttribute("data-stage-ready", "true");
  await expect(page.locator(".terminal-stage")).toHaveAttribute("data-intro-phase", "terminal");
}
async function run(page: Page, command: string) {
  await ready(page);
  const field = page.getByRole("textbox", { name: "博客命令", exact: true });
  await field.fill(command);
  await field.press("Enter");
}
async function answer(page: Page, label: RegExp, text: string) {
  const field = page.getByLabel(label);
  await expect(field).toBeVisible();
  await field.fill(text); await field.press("Enter");
}
async function ready(page: Page) {
  await expect(page.getByRole("textbox", { name: "博客命令", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "执行命令", exact: true })).toHaveText("↵");
}
async function output(page: Page, text: string) {
  await expect(page.getByRole("log", { name: "命令输出" })).toContainText(text);
  await ready(page);
}
async function commentRow(page: Page, id: string): Promise<Locator> {
  const comments = page.getByRole("region", { name: "文章评论", exact: true });
  const row = comments.locator(`[data-comment-id="${id}"]`);
  const paging = comments.getByRole("navigation", { name: "评论分页", exact: true });
  await expect(paging).toBeAttached(); await expect(comments).toHaveAttribute("aria-busy", "false");
  if (await row.count()) return row;
  async function turn(direction: "上一页" | "下一页") {
    const before = Number((await paging.innerText()).match(/(\d+)\s*\//u)?.[1]);
    await paging.getByRole("button", { name: direction, exact: true }).click();
    await expect(paging).toContainText(new RegExp(`\\b${before + (direction === "上一页" ? -1 : 1)} /`));
    await expect(comments).toHaveAttribute("aria-busy", "false");
  }
  while (!(await paging.getByRole("button", { name: "上一页", exact: true }).isDisabled())) await turn("上一页");
  const pages = Number((await paging.innerText()).match(/\/\s*(\d+)/u)?.[1]);
  for (let index = 0; index < pages; index++) {
    if (await row.count()) return row;
    if (await paging.getByRole("button", { name: "下一页", exact: true }).isDisabled()) break;
    await turn("下一页");
  }
  await expect(row, "persisted comments must remain reachable by list pagination").toBeAttached();
  return row;
}

test("reader registers, signs out, and signs back in through hidden terminal prompts", async ({ page }) => {
  const account = identity(); await enterTerminal(page);
  await run(page, "register");
  await answer(page, /^Username:/, account.username);
  await answer(page, /^Display name/, account.displayName);
  await expect(page.getByLabel(/^Password:/)).toHaveAttribute("type", "password");
  await answer(page, /^Password:/, account.password);
  await answer(page, /^Confirm password:/, "a-different-password");
  await expect(page.getByRole("log")).toContainText("两次密码不一致");
  await answer(page, /^Password:/, account.password);
  const registered = page.waitForResponse(response => response.url().endsWith(api + "/auth/register") && response.request().method() === "POST");
  await answer(page, /^Confirm password:/, account.password);
  expect((await registered).status()).toBe(201);
  // Wait for the complete UI login, including post-rotation CSRF and identity,
  // before issuing independent requests sharing the browser session cookie.
  await output(page, "注册并登录成功");
  expect(await (await page.request.get(api + "/auth/me")).json()).toMatchObject({ username: account.username, role: "USER" });
  expect(await page.locator(".terminal").textContent()).not.toContain(account.password);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(account.password);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".community-form")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".terminal-stage")).toHaveAttribute("data-intro-phase", "terminal");
  await expect(page.locator(".prompt")).toContainText(account.username);
  expect((await page.request.get(api + "/auth/me")).status()).toBe(200);
  await run(page, "logout"); await ready(page);
  await expect(page.locator(".prompt")).toContainText("guest");
  expect((await page.request.get(api + "/auth/me")).status()).toBe(401);
  await run(page, "login"); await answer(page, /^Username:/, account.username);
  const loggedIn = page.waitForResponse(response => response.url().endsWith(api + "/auth/login") && response.request().method() === "POST");
  await answer(page, /^Password:/, account.password);
  expect((await loggedIn).status()).toBe(200); await output(page, "登录成功");
  expect((await page.request.get(api + "/auth/me")).status()).toBe(200);
  expect((await page.request.get(api + "/admin/contents")).status()).toBe(403);
});

test("terminal uploads, downloads and confirms deletion of a private attachment", async ({ page, request }) => {
  const account = await registerApi(page.request), filename = `qa-private-${randomUUID()}.png`;
  let fileId: string | undefined;
  try {
    await enterTerminal(page); await expect(page.locator(".prompt")).toContainText(account.username);
    const chooser = page.waitForEvent("filechooser");
    await run(page, "upload");
    const uploaded = page.waitForResponse(response => response.url().endsWith(api + "/account/files") && response.request().method() === "POST");
    await (await chooser).setFiles({ name: filename, mimeType: "image/png", buffer: png });
    const response = await uploaded; expect(response.status()).toBe(201);
    fileId = (await response.json() as FileInfo).id;
    await output(page, `上传完成：${filename}`);
    expect((await request.get(`${api}/public/comment-files/${fileId}`)).status()).toBe(404);
    expect((await request.get(`${api}/account/files/${fileId}/content`)).status()).toBe(401);
    await run(page, "files"); await output(page, filename);
    const pendingDownload = page.waitForEvent("download");
    await run(page, `download ${fileId}`);
    const download = await pendingDownload; expect(download.suggestedFilename()).toBe(filename);
    const path = await download.path(); expect(path).toBeTruthy(); expect(await readFile(path!)).toEqual(png);
    await ready(page); await run(page, `files rm ${fileId}`);
    await answer(page, /^永久删除文件/, "n"); await ready(page);
    expect((await page.request.get(`${api}/account/files/${fileId}/content`)).status()).toBe(200);
    await run(page, `files rm ${fileId}`);
    const removed = page.waitForResponse(response => response.url().endsWith(`${api}/account/files/${fileId}`) && response.request().method() === "DELETE");
    await answer(page, /^永久删除文件/, "y"); expect((await removed).status()).toBe(204);
    await output(page, "文件已删除");
    expect((await page.request.get(`${api}/account/files/${fileId}/content`)).status()).toBe(404); fileId = undefined;
  } finally { if (fileId) await removeFile(page.request, fileId); }
});

test("reader posts multiline Markdown and attachments, replies, edits and removes comments through text", async ({ page, request }) => {
  const account = await registerApi(page.request), content = await publishedArticle(page.request);
  const marker = `评论验收 ${randomUUID()}`, commentIds = new Set<string>();
  let fileId: string | undefined;
  try {
    fileId = (await upload(page.request, `qa-comment-${randomUUID()}.png`)).id;
    await enterTerminal(page); await expect(page.locator(".prompt")).toContainText(account.username);
    const comments = page.getByRole("region", { name: "文章评论", exact: true });
    await comments.getByRole("button", { name: "发表评论", exact: true }).click();
    await answer(page, /^comment>/, marker); await answer(page, /^comment>/, "");
    await answer(page, /^comment>/, "**Markdown 生效**"); await answer(page, /^comment>/, `.attach ${fileId}`);
    await answer(page, /^comment>/, ".");
    const endpoint = `${api}/public/contents/${content.id}/comments`;
    const posted = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === "POST");
    await answer(page, /^公开发布评论/, "y");
    const postedResponse = await posted; expect(postedResponse.status()).toBe(201);
    const parent = await postedResponse.json() as Comment; commentIds.add(parent.id);
    expect(parent.attachments.map(file => file.id)).toEqual([fileId]); await output(page, "评论已发布");
    const parentRow = await commentRow(page, parent.id);
    await expect(parentRow.locator("strong").filter({ hasText: "Markdown 生效" })).toBeAttached();
    await expect(parentRow.locator(`a[href*="/public/comment-files/${fileId}"]`).first()).toBeAttached();
    expect((await request.get(`${api}/public/comment-files/${fileId}`)).status()).toBe(200);
    await parentRow.getByRole("button", { name: "回复", exact: true }).click();
    await answer(page, /^comment>/, `回复 ${marker}`); await answer(page, /^comment>/, ".");
    const replied = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === "POST");
    await answer(page, /^公开发布评论/, "y");
    const replyResponse = await replied; expect(replyResponse.status()).toBe(201);
    const reply = await replyResponse.json() as Comment; commentIds.add(reply.id); expect(reply.parentId).toBe(parent.id);
    await ready(page); const replyRow = await commentRow(page, reply.id); await expect(replyRow).toContainText(`回复 ${marker}`);
    await commentRow(page, parent.id); await parentRow.getByRole("button", { name: "编辑评论", exact: true }).click();
    await answer(page, /^comment>/, ".clear"); await answer(page, /^comment>/, `已修改 ${marker}`);
    await answer(page, /^comment>/, `.attach ${fileId}`); await answer(page, /^comment>/, ".");
    const edited = page.waitForResponse(response => response.url().endsWith(`${api}/account/comments/${parent.id}`) && response.request().method() === "PUT");
    await answer(page, /^保存评论修改/, "y"); expect((await edited).status()).toBe(200);
    await output(page, "评论已更新"); await expect(parentRow).toContainText(`已修改 ${marker}`);
    await page.reload(); await expect(page.locator(".terminal-stage")).toHaveAttribute("data-intro-phase", "terminal");
    await expect(await commentRow(page, parent.id)).toContainText(`已修改 ${marker}`);
    await expect(await commentRow(page, reply.id)).toContainText(`回复 ${marker}`);
    for (const id of [reply.id, parent.id]) {
      const row = await commentRow(page, id); await row.getByRole("button", { name: "删除评论", exact: true }).click();
      const removed = page.waitForResponse(response => response.url().endsWith(`${api}/account/comments/${id}`) && response.request().method() === "DELETE");
      await answer(page, /^删除评论/, "y"); expect((await removed).status()).toBe(204);
      commentIds.delete(id); await ready(page); await expect(row).toHaveCount(0);
    }
    expect((await request.get(`${api}/public/comment-files/${fileId}`)).status()).toBe(404);
    await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.locator(".community-form")).toHaveCount(0);
  } finally {
    for (const id of [...commentIds].reverse()) await removeComment(page.request, id);
    if (fileId) await removeFile(page.request, fileId);
  }
});

test("Tab completes paths while native history scroll and guest parent directories work", async ({ page }) => {
  await enterTerminal(page, longArticle);
  const field = page.getByRole("textbox", { name: "博客命令", exact: true });
  await field.fill("crt "); await field.press("Tab"); await expect(field).toHaveValue("crt off ");
  await expect(field).toBeFocused(); await expect(page.getByRole("listbox", { name: "命令补全" })).toBeVisible();
  await field.press("Tab"); await expect(field).toHaveValue("crt low ");
  await field.press("Shift+Tab"); await expect(field).toHaveValue("crt off ");
  await field.fill("open /posts/wel"); await field.press("Tab");
  await expect(field).toHaveValue("open /posts/welcome-to-hadesd.md ");
  await field.fill("unsubmitted draft");
  const transcript = page.getByRole("region", { name: "终端历史记录", exact: true });
  await expect.poll(() => transcript.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await field.press("PageDown"); const first = await transcript.evaluate(el => el.scrollTop); expect(first).toBeGreaterThan(0);
  await field.press("PageDown"); const second = await transcript.evaluate(el => el.scrollTop); expect(second).toBeGreaterThan(first);
  await field.press("PageUp"); expect(await transcript.evaluate(el => el.scrollTop)).toBeLessThan(second);
  await expect(field).toHaveValue("unsubmitted draft"); await expect(field).toBeFocused();
  const beforeWheel = await transcript.evaluate(el => el.scrollTop);
  await transcript.hover(); await page.mouse.wheel(0, 400);
  await expect.poll(() => transcript.evaluate(el => el.scrollTop)).toBeGreaterThan(beforeWheel);
  await expect(page.locator(".screen-pager")).toHaveCount(0);
  await run(page, "cd"); await ready(page); await run(page, "pwd"); await output(page, "/home/guest");
  await run(page, "cd .."); await ready(page); await run(page, "pwd"); await expect(page.locator(".terminal-record").last()).toContainText("/home");
  await run(page, "cd .."); await ready(page); await run(page, "pwd"); await expect(page.locator(".terminal-record").last().locator("pre")).toHaveText("/");
  await run(page, `md ${article}.md`); await ready(page);
  await expect(page.locator(".terminal-record").last().locator(".markdown")).toBeAttached();
  await run(page, "login reader do-not-echo-this-secret"); await ready(page);
  await run(page, "history"); await ready(page);
  await expect(page.locator(".terminal")).not.toContainText("do-not-echo-this-secret");
  await field.press("ArrowUp"); await field.press("ArrowUp"); await expect(field).toHaveValue("login");
});

test("private files and comment mutations enforce author ownership, CSRF and publication ACL", async ({ page, browser, baseURL, request }) => {
  const owner = page.request;
  const peerContext = await browser.newContext({ baseURL });
  const peer = peerContext.request;
  let fileId: string | undefined, commentId: string | undefined, unexpectedPeerComment: string | undefined;
  try {
    const author = await registerApi(owner);
    await registerApi(peer);
    const content = await publishedArticle(owner);
    const file = await upload(owner);
    fileId = file.id;
    const ownFileUrl = `${api}/account/files/${file.id}/content`;
    const publicFileUrl = `${api}/public/comment-files/${file.id}`;
    expect((await owner.get(ownFileUrl)).status()).toBe(200);
    expect((await peer.get(ownFileUrl)).status()).toBe(404);
    expect((await request.get(ownFileUrl)).status()).toBe(401);
    expect((await request.get(publicFileUrl)).status()).toBe(404);
    const foreignList = await peer.get(api + "/account/files");
    expect((await foreignList.json()).items.some((item: FileInfo) => item.id === file.id)).toBe(false);
    const endpoint = `${api}/public/contents/${content.id}/comments`;
    expect((await owner.post(endpoint, { data: { body: "missing CSRF", attachmentIds: [] } })).status()).toBe(403);
    const hijack = await peer.post(endpoint, {
      headers: await csrf(peer), data: { body: "must not borrow another reader's private file", attachmentIds: [file.id] },
    });
    if (hijack.status() === 201) unexpectedPeerComment = (await hijack.json() as Comment).id;
    expect(hijack.status()).toBe(404);
    const created = await owner.post(endpoint, {
      headers: await csrf(owner), data: { body: `ACL 验收 ${author.username}`, attachmentIds: [file.id] },
    });
    expect(created.status()).toBe(201);
    const comment = await created.json() as Comment;
    commentId = comment.id;
    expect(comment.author.id).toBe(author.id);
    const publicFile = await request.get(publicFileUrl);
    expect(publicFile.status()).toBe(200);
    expect(publicFile.headers()["x-content-type-options"]).toBe("nosniff");
    expect(publicFile.headers()["content-type"]).toContain("image/png");
    expect(await publicFile.body()).toEqual(png);
    expect((await peer.put(`${api}/account/comments/${comment.id}`, {
      headers: await csrf(peer), data: { body: "forged edit", attachmentIds: [] },
    })).status()).toBe(404);
    expect((await peer.delete(`${api}/account/comments/${comment.id}`, { headers: await csrf(peer) })).status()).toBe(404);
    expect((await peer.delete(`${api}/account/files/${file.id}`, { headers: await csrf(peer) })).status()).toBe(404);
    expect((await owner.delete(`${api}/account/files/${file.id}`, { headers: await csrf(owner) })).status()).toBe(409);
    expect((await peer.get(api + "/admin/contents")).status()).toBe(403);
    expect((await peer.delete(`${api}/admin/comments/${comment.id}`, { headers: await csrf(peer) })).status()).toBe(403);
    const detached = await owner.put(`${api}/account/comments/${comment.id}`, {
      headers: await csrf(owner), data: { body: `附件已移除 ${author.username}`, attachmentIds: [] },
    });
    expect(detached.status()).toBe(200);
    expect((await request.get(publicFileUrl)).status()).toBe(404);
    expect((await owner.get(ownFileUrl)).status()).toBe(200);
    const listed = await request.get(endpoint, { params: { size: 100 } });
    expect((await listed.json()).items.find((item: Comment) => item.id === comment.id)?.body).toContain("附件已移除");
    await removeComment(owner, comment.id);
    commentId = undefined;
    await removeFile(owner, file.id);
    fileId = undefined;
  } finally {
    try {
      if (unexpectedPeerComment) await removeComment(peer, unexpectedPeerComment);
      if (commentId) await removeComment(owner, commentId);
      if (fileId) await removeFile(owner, fileId);
    } finally { await peerContext.close(); }
  }
});
