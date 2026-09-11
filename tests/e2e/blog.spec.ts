import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";

// The account/comment feature must be built and served before running this suite.
// It never publishes or edits article revisions; each mutation uses its own QA identity.
const article = "/posts/welcome-to-hadesd";
const longArticle = "/posts/time-and-backpressure";
const api = "/api/v1";
const shots = ".local/reports/blog-v1";
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
  const field = page.getByRole("textbox", { name: "博客命令", exact: true });
  await field.fill(command);
  await field.press("Enter");
  await expect(field).toHaveValue("");
}
async function screenNumber(page: Page) {
  return Number(await page.locator(".screen-pager").getAttribute("data-page"));
}
async function visibleOnScreen(page: Page, target: Locator) {
  const item = await target.boundingBox(), frame = await page.locator(".screen-viewport").boundingBox();
  return !!(item && frame && item.x >= frame.x - 1 && item.y >= frame.y - 1 &&
    item.x + item.width <= frame.x + frame.width + 1 && item.y + item.height <= frame.y + frame.height + 1);
}
async function reveal(page: Page, target: Locator) {
  await expect(target).toBeAttached();
  // Use terminal controls, never scrollIntoView, so a broken pager cannot pass this suite.
  const pager = page.getByRole("region", { name: "终端屏幕", exact: true });
  await pager.focus();
  while ((await screenNumber(page)) > 1) {
    const before = await screenNumber(page);
    await pager.press("PageUp");
    await expect(page.locator(".screen-pager")).toHaveAttribute("data-page", String(before - 1));
  }
  const count = Number(await page.locator(".screen-pager").getAttribute("data-pages"));
  for (let index = 0; index < count; index++) {
    if (await visibleOnScreen(page, target)) return;
    if (await page.getByRole("button", { name: "下一屏", exact: true }).isDisabled()) break;
    const before = await screenNumber(page);
    await pager.press("PageDown");
    await expect(page.locator(".screen-pager")).toHaveAttribute("data-page", String(before + 1));
  }
  expect(await visibleOnScreen(page, target), "control must fit on an actual fixed terminal screen").toBe(true);
}
async function fillOnScreen(page: Page, target: Locator, value: string) {
  await reveal(page, target);
  await target.fill(value);
}
async function clickOnScreen(page: Page, target: Locator) {
  await reveal(page, target);
  await target.click();
}
async function accountProgram(page: Page) {
  await page.getByRole("button", { name: "账户", exact: true }).click();
  const dialog = page.getByRole("region", { name: "账户", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return dialog;
}
async function commentRow(page: Page, id: string) {
  const comments = page.locator("#comments");
  const row = comments.locator(`[data-comment-id="${id}"]`);
  const paging = comments.getByRole("navigation", { name: "列表分页", exact: true });
  await expect(paging).toBeAttached();
  if (await row.count()) return row;
  async function turn(direction: "上一页" | "下一页") {
    const before = Number((await paging.innerText()).match(/(\d+)\s*\//u)?.[1]);
    const button = paging.getByRole("button", { name: direction, exact: true });
    await reveal(page, button);
    await button.click();
    await expect(paging).toContainText(new RegExp(`\\b${before + (direction === "上一页" ? -1 : 1)} /`));
  }
  while (!(await paging.getByRole("button", { name: "上一页", exact: true }).isDisabled())) await turn("上一页");
  const pages = Number((await paging.innerText()).match(/\/\s*(\d+)/u)?.[1]);
  for (let index = 0; index < pages; index++) {
    if (await row.count()) return row;
    if (await paging.getByRole("button", { name: "下一页", exact: true }).isDisabled()) break;
    await turn("下一页");
  }
  await expect(row, "the persisted comment must be reachable through comment-list pagination").toBeAttached();
  return row;
}
async function fixedScreen(page: Page) {
  const geometry = await page.evaluate(() => ({
    x: scrollX, y: scrollY,
    width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
    viewportWidth: innerWidth, viewportHeight: innerHeight,
    scroll: document.querySelector(".screen-viewport")?.scrollTop,
  }));
  expect(geometry.x).toBe(0);
  expect(geometry.y).toBe(0);
  expect(geometry.width).toBe(geometry.viewportWidth);
  expect(geometry.height).toBe(geometry.viewportHeight);
  expect(geometry.scroll).toBe(0);
}

test("reader registers, signs out, and signs back in through the inline account program", async ({ page }) => {
  const account = identity();
  await enterTerminal(page);
  let dialog = await accountProgram(page);
  await clickOnScreen(page, dialog.getByRole("navigation", { name: "账户页面" }).getByRole("button", { name: "注册", exact: true }));
  await fillOnScreen(page, dialog.getByLabel("用户名", { exact: true }), account.username);
  await dialog.getByLabel("用户名", { exact: true }).press("Tab");
  await expect(dialog.getByLabel("显示名称", { exact: true })).toBeFocused();
  await fillOnScreen(page, dialog.getByLabel("显示名称", { exact: true }), account.displayName);
  await fillOnScreen(page, dialog.getByLabel("密码", { exact: true }), account.password);
  await fillOnScreen(page, dialog.getByLabel("确认密码", { exact: true }), "a-different-password");
  await clickOnScreen(page, dialog.getByRole("button", { name: "注册并登录", exact: true }));
  await expect(dialog.getByRole("alert")).toHaveText("两次输入的密码不一致。");
  await fillOnScreen(page, dialog.getByLabel("确认密码", { exact: true }), account.password);
  const registered = page.waitForResponse(response => response.url().endsWith(api + "/auth/register") && response.request().method() === "POST");
  await clickOnScreen(page, dialog.getByRole("button", { name: "注册并登录", exact: true }));
  expect((await registered).status()).toBe(201);
  await expect(dialog.getByRole("status")).toHaveText("注册成功，已登录。");
  await expect.poll(async () => (await page.request.get(api + "/auth/me")).status()).toBe(200);
  expect(await (await page.request.get(api + "/auth/me")).json()).toMatchObject({ username: account.username, role: "USER" });
  await page.reload();
  await expect(page.locator(".terminal-stage")).toHaveAttribute("data-stage-ready", "true");
  expect((await page.request.get(api + "/auth/me")).status()).toBe(200);
  await run(page, "logout");
  await expect.poll(async () => (await page.request.get(api + "/auth/me")).status()).toBe(401);
  dialog = await accountProgram(page);
  await clickOnScreen(page, dialog.getByRole("navigation", { name: "账户页面" }).getByRole("button", { name: "登录", exact: true }));
  await fillOnScreen(page, dialog.getByLabel("用户名", { exact: true }), account.username);
  await fillOnScreen(page, dialog.getByLabel("密码", { exact: true }), account.password);
  const loggedIn = page.waitForResponse(response => response.url().endsWith(api + "/auth/login") && response.request().method() === "POST");
  await clickOnScreen(page, dialog.getByRole("button", { name: "登录账户", exact: true }));
  expect((await loggedIn).status()).toBe(200);
  await expect(dialog.getByRole("status")).toHaveText("登录成功。");
  await expect.poll(async () => (await page.request.get(api + "/auth/me")).status()).toBe(200);
  expect((await page.request.get(api + "/admin/contents")).status()).toBe(403);
});

test("my files uploads, downloads and deletes a private attachment using the UI", async ({ page, request }) => {
  const account = await registerApi(page.request);
  const filename = `qa-private-${randomUUID()}.png`;
  let fileId: string | undefined;
  try {
    await enterTerminal(page);
    await expect(page.getByRole("button", { name: "账户", exact: true })).toHaveText(`[ ${account.displayName} ]`);
    await page.getByRole("button", { name: "我的文件", exact: true }).click();
    const dialog = page.getByRole("region", { name: "账户", exact: true });
    await expect(dialog.getByRole("region", { name: "我的文件", exact: true })).toBeVisible();
    const uploaded = page.waitForResponse(response => response.url().endsWith(api + "/account/files") && response.request().method() === "POST");
    await dialog.getByLabel("上传文件", { exact: true }).setInputFiles({ name: filename, mimeType: "image/png", buffer: png });
    const response = await uploaded;
    expect(response.status()).toBe(201);
    fileId = (await response.json() as FileInfo).id;
    const row = dialog.getByRole("listitem").filter({ hasText: filename });
    await expect(row).toBeVisible();
    await page.screenshot({ path: `${shots}/private-file-uploaded.png` });
    expect((await request.get(`${api}/public/comment-files/${fileId}`)).status()).toBe(404);
    expect((await request.get(`${api}/account/files/${fileId}/content`)).status()).toBe(401);
    const pendingDownload = page.waitForEvent("download");
    await row.getByRole("link", { name: "下载", exact: true }).click();
    const download = await pendingDownload;
    expect(download.suggestedFilename()).toBe(filename);
    const path = await download.path();
    expect(path).toBeTruthy();
    expect(await readFile(path!)).toEqual(png);
    await row.getByRole("button", { name: `删除文件 ${filename}`, exact: true }).click();
    const removed = page.waitForResponse(response => response.url().endsWith(`${api}/account/files/${fileId}`) && response.request().method() === "DELETE");
    await row.getByRole("button", { name: "确认删除", exact: true }).click();
    expect((await removed).status()).toBe(204);
    await expect(row).toHaveCount(0);
    expect((await page.request.get(`${api}/account/files/${fileId}/content`)).status()).toBe(404);
    fileId = undefined;
  } finally { if (fileId) await removeFile(page.request, fileId); }
});

test("reader posts Markdown with an attachment, replies, edits and removes the comments", async ({ page, request }) => {
  const account = await registerApi(page.request);
  const content = await publishedArticle(page.request);
  const marker = `评论验收 ${randomUUID()}`;
  const filename = `qa-comment-${randomUUID()}.png`;
  const commentIds = new Set<string>();
  let fileId: string | undefined;
  try {
    await enterTerminal(page);
    await expect(page.getByRole("button", { name: "账户", exact: true })).toContainText(account.displayName);
    await run(page, "comments");
    const comments = page.locator("#comments");
    await expect(comments).toBeAttached();
    const compose = comments.getByRole("button", { name: "发表评论", exact: true });
    await reveal(page, compose);
    await compose.click();
    const composer = page.getByRole("region", { name: "发表评论", exact: true });
    await expect(composer).toBeVisible();
    const editor = composer.getByRole("textbox", { name: "评论内容", exact: true });
    await fillOnScreen(page, editor, `${marker}\n\n**Markdown 生效**`);
    const articleScreen = await screenNumber(page);
    await editor.press("PageDown");
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue(`${marker}\n\n**Markdown 生效**`);
    expect(await screenNumber(page)).toBe(articleScreen);
    const uploaded = page.waitForResponse(response => response.url().endsWith(api + "/account/files") && response.request().method() === "POST");
    await composer.getByLabel("评论附件", { exact: true }).setInputFiles({ name: filename, mimeType: "image/png", buffer: png });
    const uploadResponse = await uploaded;
    expect(uploadResponse.status()).toBe(201);
    fileId = (await uploadResponse.json() as FileInfo).id;
    const endpoint = `${api}/public/contents/${content.id}/comments`;
    const posted = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === "POST");
    const submit = composer.getByRole("button", { name: "发表评论", exact: true });
    await clickOnScreen(page, submit);
    const postedResponse = await posted;
    expect(postedResponse.status()).toBe(201);
    const parent = await postedResponse.json() as Comment;
    commentIds.add(parent.id);
    expect(parent.attachments.map(file => file.id)).toEqual([fileId]);
    const parentRow = await commentRow(page, parent.id);
    await expect(parentRow).toBeAttached();
    await expect(parentRow.locator("strong").filter({ hasText: "Markdown 生效" })).toBeAttached();
    await expect(parentRow.locator(`a[href*="/public/comment-files/${fileId}"]`).first()).toBeAttached();
    expect((await request.get(`${api}/public/comment-files/${fileId}`)).status()).toBe(200);
    const replyButton = parentRow.getByRole("button", { name: "回复", exact: true });
    await reveal(page, replyButton);
    await replyButton.click();
    const replyComposer = page.getByRole("region", { name: "回复评论", exact: true });
    await expect(replyComposer).toBeVisible();
    await fillOnScreen(page, replyComposer.getByRole("textbox", { name: "评论内容", exact: true }), `回复 ${marker}`);
    const replied = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === "POST");
    const replySubmit = replyComposer.getByRole("button", { name: "发表回复", exact: true });
    await clickOnScreen(page, replySubmit);
    const replyResponse = await replied;
    expect(replyResponse.status()).toBe(201);
    const reply = await replyResponse.json() as Comment;
    commentIds.add(reply.id);
    expect(reply.parentId).toBe(parent.id);
    const replyRow = await commentRow(page, reply.id);
    await expect(replyRow).toContainText(`回复 ${marker}`);
    await page.screenshot({ path: `${shots}/comment-and-reply.png` });
    await commentRow(page, parent.id);
    const editButton = parentRow.getByRole("button", { name: /^编辑(?:评论)?$/ });
    await reveal(page, editButton);
    await editButton.click();
    const editComposer = page.getByRole("region", { name: "编辑评论", exact: true });
    await expect(editComposer).toBeVisible();
    await fillOnScreen(page, editComposer.getByRole("textbox", { name: "评论内容", exact: true }), `已修改 ${marker}`);
    const edited = page.waitForResponse(response => response.url().endsWith(`${api}/account/comments/${parent.id}`) && response.request().method() === "PUT");
    const saveCommand = editComposer.getByRole("textbox", { name: "程序命令", exact: true });
    await fillOnScreen(page, saveCommand, ":wq");
    await saveCommand.press("Enter");
    expect((await edited).status()).toBe(200);
    await expect(parentRow).toContainText(`已修改 ${marker}`);
    await page.reload();
    await expect(page.locator(".terminal-stage")).toHaveAttribute("data-stage-ready", "true");
    await run(page, "comments");
    await commentRow(page, parent.id);
    await expect(parentRow).toContainText(`已修改 ${marker}`);
    await commentRow(page, reply.id);
    await expect(replyRow).toContainText(`回复 ${marker}`);
    for (const id of [reply.id, parent.id]) {
      const row = await commentRow(page, id);
      const remove = row.getByRole("button", { name: "删除评论", exact: true });
      await reveal(page, remove);
      await remove.click();
      const confirm = row.getByRole("button", { name: "确认删除评论", exact: true });
      await reveal(page, confirm);
      const removed = page.waitForResponse(response => response.url().endsWith(`${api}/account/comments/${id}`) && response.request().method() === "DELETE");
      await confirm.click();
      expect((await removed).status()).toBe(204);
      commentIds.delete(id);
      await expect(row).toHaveCount(0);
    }
    expect((await request.get(`${api}/public/comment-files/${fileId}`)).status()).toBe(404);
    await fixedScreen(page);
  } finally {
    for (const id of [...commentIds].reverse()) await removeComment(page.request, id);
    if (fileId) await removeFile(page.request, fileId);
  }
});

test("Tab completes paths and parameters while command-focused paging stays fixed", async ({ page }) => {
  await enterTerminal(page, longArticle);
  const command = page.getByRole("textbox", { name: "博客命令", exact: true });
  await command.fill("crt ");
  await command.press("Tab");
  await expect(command).toHaveValue("crt off ");
  await expect(command).toBeFocused();
  await expect(page.getByRole("listbox", { name: "命令补全" })).toBeVisible();
  await command.press("Tab");
  await expect(command).toHaveValue("crt low ");
  await command.press("Shift+Tab");
  await expect(command).toHaveValue("crt off ");
  await command.fill("open /posts/wel");
  await command.press("Tab");
  await expect(command).toHaveValue("open /posts/welcome-to-hadesd.md ");
  await command.fill("unsubmitted draft");
  await command.press("PageDown");
  await expect(page.locator(".screen-pager")).toHaveAttribute("data-page", "2");
  await command.press("PageDown");
  await expect(page.locator(".screen-pager")).toHaveAttribute("data-page", "3");
  await command.press("PageUp");
  await expect(page.locator(".screen-pager")).toHaveAttribute("data-page", "2");
  await expect(command).toHaveValue("unsubmitted draft");
  await expect(command).toBeFocused();
  await page.getByRole("button", { name: "上一屏", exact: true }).click();
  await page.keyboard.press("PageDown");
  await expect(page.locator(".screen-pager")).toHaveAttribute("data-page", "2");
  await page.mouse.wheel(0, 800);
  await expect(page.locator(".screen-pager")).toHaveAttribute("data-page", "2");
  await fixedScreen(page);
  await run(page, "login do-not-echo-this-secret");
  await expect(page.getByText("login 不接受参数，请在对应界面操作。", { exact: true })).toBeAttached();
  await run(page, "history");
  await expect(page.locator(".terminal")).not.toContainText("do-not-echo-this-secret");
  await command.press("ArrowUp");
  await command.press("ArrowUp");
  await expect(command).toHaveValue("login");
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
