#!/usr/bin/env node
// Built-site browser QA. Every API call is intercepted; no live backend is used.
// HADESD_BUILD_DIR=/absolute/build HADESD_SNAPSHOT=/absolute/snapshot.json node apps/journal/scripts/check-browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const build = resolve(process.env.HADESD_BUILD_DIR || join(root, ".local/journal-build"), "client");
const fixture = JSON.parse(await readFile(process.env.HADESD_SNAPSHOT || join(root, ".local/development/snapshot.json"), "utf8"));
const output = resolve(process.env.REPORT_DIR || join(root, ".local/reports/journal"));
await mkdir(output, { recursive: true });
const paths = [...new Set(["/", "/posts", "/projects", "/research", "/about", "/now", "/links", "/search", "/404", ...fixture.contents.map(item => item.route), ...fixture.contents.flatMap(item => item.tags.map(tag => `/tags/${encodeURIComponent(tag)}`))])];
for (const path of paths) {
  const html = await readFile(join(build, decodeURIComponent(path), "index.html"), "utf8"), expected = `${process.env.SITE_ORIGIN || "https://itshades.dev"}${path}`;
  assert(html.includes(`rel="canonical" href="${expected}"`), `Canonical must use journal origin: ${path}`);
  assert(html.includes(`property="og:url" content="${expected}"`), `Open Graph must use journal origin: ${path}`);
}
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".xml": "application/xml" };
const server = createServer(async (request, response) => {
  try {
    let path = resolve(build, `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`);
    if (path !== build && !path.startsWith(build + sep)) throw new Error("Outside build");
    if ((await stat(path)).isDirectory()) path = join(path, "index.html");
    response.setHeader("content-type", mime[extname(path)] || "application/octet-stream"); response.end(await readFile(path));
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise(done => server.listen(18475, "127.0.0.1", done));
const origin = "http://127.0.0.1:18475", browser = await chromium.launch(), report = [], blocked = [];
const first = fixture.contents.find(item => item.type === "POST");
const contrastResults = [];
async function checkContrast(page, selectors) {
  const results = await page.evaluate(selectors => {
    const rgb = value => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [0, 0, 0];
    const luminance = values => values.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    return selectors.flatMap(selector => [...document.querySelectorAll(selector)].map(element => {
      const style = getComputedStyle(element); let parent = element, background;
      while (parent && !background) { const color = getComputedStyle(parent).backgroundColor; if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") background = color; parent = parent.parentElement; }
      const foregroundL = luminance(rgb(style.color)), backgroundL = luminance(rgb(background || "rgb(255,255,255)"));
      return { selector, color: style.color, background, ratio: (Math.max(foregroundL, backgroundL) + .05) / (Math.min(foregroundL, backgroundL) + .05), minimum: parseFloat(style.fontSize) >= 24 ? 3 : 4.5 };
    }));
  }, selectors);
  for (const result of results) assert(result.ratio >= result.minimum, `Insufficient text contrast: ${JSON.stringify(result)}`);
  contrastResults.push(...results);
}
try {
  for (const device of [{ name: "desktop", viewport: { width: 1440, height: 1000 } }, { name: "tablet", viewport: { width: 768, height: 1024 } }, { name: "mobile", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]) {
    const { name, ...options } = device;
    const context = await browser.newContext({ ...options, locale: "zh-CN", reducedMotion: "reduce", serviceWorkers: "block" });
    let user = null, comments = [], writes = [];
    const account = { id: "reader-fixture", username: "reader", displayName: "读者 QA", role: "READER", createdAt: "2026-11-11T00:00:00Z" };
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (url.origin !== origin) { blocked.push(url.href); return route.abort(); }
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const path = url.pathname.replace("/api/v1", "");
      if (method !== "GET") { assert.equal(request.headers()["x-csrf-token"], "fixture-token"); writes.push(`${method} ${path}`); }
      const ok = json => route.fulfill({ json });
      if (path === "/auth/session") return ok({ user });
      if (path === "/auth/csrf") return ok({ token: "fixture-token", headerName: "X-CSRF-TOKEN" });
      if (path === "/auth/register") return ok(account);
      if (path === "/auth/login") { user = account; return route.fulfill({ status: 204 }); }
      if (path === "/auth/me") return ok(user);
      if (path === "/auth/logout") { user = null; return route.fulfill({ status: 204 }); }
      if (path === "/account/profile") { user = { ...user, displayName: request.postDataJSON().displayName }; return ok(user); }
      if (path === "/account/files") return ok({ items: [], total: 0, page: 0, size: 10 });
      if (path === "/account/comments") return ok({ items: comments, total: comments.length, page: 0, size: 10 });
      if (path === "/public/search" && url.searchParams.get("q") === "没有匹配项") return ok({ items: [], total: 0, page: 0, size: 20 });
      if (path === "/public/search") return ok({ items: fixture.contents.filter(item => item.type === "POST"), total: fixture.contents.filter(item => item.type === "POST").length, page: 0, size: 20 });
      if (path.endsWith("/comments") && path.startsWith("/public/contents/")) {
        if (method === "POST") { const item = { id: `comment-${comments.length + 1}`, contentId: first.id, ...request.postDataJSON(), author: user, attachments: [], createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z" }; comments.push(item); return ok(item); }
        return ok({ items: comments, total: comments.length, page: 0, size: 10 });
      }
      if (path.startsWith("/account/comments/")) {
        const id = path.split("/").at(-1);
        if (method === "DELETE") { comments = comments.filter(item => item.id !== id); return route.fulfill({ status: 204 }); }
        comments = comments.map(item => item.id === id ? { ...item, ...request.postDataJSON() } : item); return ok(comments.find(item => item.id === id));
      }
      blocked.push(`${method} ${path}`); return route.abort();
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    const checkWidth = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal overflow at ${page.url()}`);
    await page.goto(origin, { waitUntil: "networkidle" }); await expect(page.locator("h1")).toHaveText("Hades"); await checkWidth();
    await checkContrast(page, [".journal-intro p", ".journal-intro .pill-button", ".post-meta", ".footer-bottom"]);
    await page.screenshot({ path: join(output, `${name}-home.png`) });
    await page.screenshot({ path: join(output, `${name}-home-full.png`), fullPage: true });
    console.log(`Screenshot: ${join(output, `${name}-home.png`)}`);
    await expect(page.locator("canvas,.terminal-stage")).toHaveCount(0);
    if (name === "mobile") { await page.getByRole("button", { name: "打开导航" }).click(); await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible(); await page.screenshot({ path: join(output, "mobile-navigation.png") }); await page.getByRole("button", { name: "关闭导航" }).click(); }
    await page.locator(".account-button").click(); await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: join(output, `${name}-login.png`) });
    await checkContrast(page, [".community-tabs button", ".community-form label"]);
    await page.getByRole("button", { name: "注册", exact: true }).click();
    await page.getByLabel("用户名", { exact: true }).fill("reader"); await page.getByLabel("显示名称", { exact: true }).fill("读者 QA");
    await page.getByLabel("密码", { exact: true }).fill("fixture-password-only"); await page.getByLabel("确认密码").fill("fixture-password-only");
    await page.getByRole("button", { name: "注册并登录" }).click(); await expect(page.getByRole("button", { name: "保存资料" })).toBeVisible();
    await page.getByLabel("显示名称", { exact: true }).fill("测试读者"); await page.getByRole("button", { name: "保存资料" }).click(); await expect(page.getByText("显示名称已更新。", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "我的文件", exact: true }).click(); await expect(page.getByText(/暂无文件/)).toBeVisible();
    await page.getByRole("button", { name: "关闭账户" }).click();
    await page.goto(origin + first.route, { waitUntil: "networkidle" }); await expect(page.locator("h1")).toHaveText(first.title); await checkWidth();
    await checkContrast(page, [".article-summary", ".back-link", ".reading-time", ".article-tags", ".article-toc>span", ".article-toc nav", ".article-end", ".discussion-intro", ".discussion-empty", ".next-post>p:last-child"]);
    if (name !== "desktop") { const toc=page.locator(".mobile-toc"); await expect(toc).toBeVisible(); await toc.locator("summary").click(); await expect(toc.locator("a").first()).toBeVisible(); await toc.locator("summary").click(); }
    await page.screenshot({ path: join(output, `${name}-article.png`) });
    await page.locator(".article-body").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `${name}-article-full.png`), fullPage: true });
    await page.getByRole("button", { name: "写评论", exact: true }).click();
    await page.getByRole("textbox", { name: "评论正文" }).fill("一条 **可读的** 评论。");
    await page.getByRole("button", { name: "预览 Markdown" }).click(); await expect(page.locator(".comment-preview strong")).toHaveText("可读的");
    await page.getByRole("button", { name: "公开发表" }).click(); await expect(page.locator(".comment-list strong").filter({ hasText: "可读的" })).toBeVisible();
    await page.getByRole("button", { name: "编辑", exact: true }).click(); await page.getByRole("textbox", { name: "评论正文" }).fill("编辑后的评论。"); await page.getByRole("button", { name: "公开发表" }).click(); await expect(page.locator(".comment-list")).toContainText("编辑后的评论。");
    await page.getByRole("button", { name: "回复", exact: true }).click(); await page.getByRole("textbox", { name: "评论正文" }).fill("继续讨论。"); await page.getByRole("button", { name: "公开发表" }).click(); await expect(page.locator(".comment-list .is-reply")).toHaveCount(1);
    await page.locator(".discussion").scrollIntoViewIfNeeded(); await page.screenshot({ path: join(output, `${name}-comments.png`) }); await checkWidth();
    await page.getByRole("button", { name: "删除", exact: true }).last().click(); await page.getByRole("button", { name: "确认", exact: true }).click(); await expect(page.locator(".comment-list .is-reply")).toHaveCount(0);
    await page.goto(origin + "/search?q=发布", { waitUntil: "networkidle" }); await expect(page.locator(".result-count")).toContainText(`找到 ${fixture.contents.filter(item => item.type === "POST").length} 条`); await checkWidth(); await page.screenshot({ path: join(output, `${name}-search.png`) });
    await page.goto(origin + "/search?q=" + encodeURIComponent("没有匹配项"), { waitUntil: "networkidle" });
    await expect(page.getByText("没有找到相关的文章。", { exact: true })).toBeVisible();
    await page.reload({ waitUntil: "networkidle" }); await expect(page.locator("#search")).toHaveValue("没有匹配项");
    await page.getByRole("link", { name: "清除搜索", exact: true }).click(); await expect(page.locator("#search")).toHaveValue("");
    await page.goBack({ waitUntil: "networkidle" }); await expect(page.locator("#search")).toHaveValue("没有匹配项");
    await page.goto(origin + "/about", { waitUntil: "networkidle" }); await expect(page.locator("h1")).toBeVisible(); await checkWidth(); await page.screenshot({ path: join(output, `${name}-about.png`), fullPage: true });
    await page.goto(origin + "/posts", { waitUntil: "networkidle" }); await page.screenshot({ path: join(output, `${name}-list.png`), fullPage: true });
    for (const article of fixture.contents.filter(item => item.type === "POST")) {
      await page.goto(origin + article.route, { waitUntil: "networkidle" });
      await expect(page.locator("h1")).toHaveText(article.title);
      const pictures = page.locator('.article-prose img[src^="/editorial/"]');
      for (const picture of await pictures.all()) {
        await picture.scrollIntoViewIfNeeded();
        await expect.poll(() => picture.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
        await picture.evaluate(async img => { await img.decode(); await new Promise(requestAnimationFrame); });
        await page.screenshot({ path: join(output, `${name}-${article.slug}-${(await picture.getAttribute("src")).split("/").at(-1)}`) });
      }
      await expect(page.locator('.md-image-error')).toHaveCount(0);
      await checkWidth();
    }
    await page.goto(origin + "/tags/" + encodeURIComponent(first.tags[0]), { waitUntil: "networkidle" }); await expect(page.getByRole("link", {name:"清除标签，返回文章列表"})).toBeVisible();
    await page.locator(".account-button").click(); await page.getByRole("button", { name: "退出登录" }).click(); await expect(page.locator(".account-button")).toHaveText("登录");
    assert.deepEqual(errors, []); report.push({ device: name, viewport: options.viewport, errors, writes }); await context.close();
  }
  const noJs = await browser.newContext({ javaScriptEnabled: false }); const page = await noJs.newPage();
  await page.goto(origin + first.route); await expect(page.locator("h1")).toHaveText(first.title); await expect(page.locator(".markdown h2").first()).toBeVisible(); await noJs.close();
  for (const width of [320, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "no-preference" });
    await context.route("**/api/**", route => route.fulfill({ json: route.request().url().includes("/auth/session") ? { user: null } : { items: [], total: 0, page: 0, size: 10 } }));
    const page = await context.newPage(); await page.goto(origin, { waitUntil: "networkidle" });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: home overflow`);
    await page.locator(".post-row").last().scrollIntoViewIfNeeded(); await expect(page.locator(".post-row").last()).toHaveClass(/is-visible/);
    await page.goto(origin + first.route, { waitUntil: "networkidle" });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: article overflow`);
    await context.close();
  }
  assert.deepEqual(blocked, []);
  await writeFile(join(output, "results.json"), JSON.stringify({ fixtureRelease: fixture.releaseId, build, report, noJavaScriptArticle: true, metadataPaths: paths, extraResponsiveWidths: [320, 768], contrastResults, blocked }, null, 2));
  console.log(JSON.stringify({ output, report, noJavaScriptArticle: true }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
