import { test, expect, type Page } from "@playwright/test";

test.use({ reducedMotion: "reduce" });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { user: null } }));
  await page.addInitScript(() => localStorage.setItem("hadesd.display.v2", JSON.stringify({ theme: "amber", crt: "off", reader: false })));
  await page.goto("/");
  await expect(page.locator(".terminal-stage")).toHaveAttribute("data-stage-ready", "true");
});

async function run(page: Page, value: string) {
  const prompt = page.getByRole("textbox", { name: "博客命令", exact: true });
  await prompt.fill(value); await prompt.press("Enter");
}
async function ex(page: Page, value: string) {
  await page.keyboard.press(":");
  const prompt = page.getByRole("textbox", { name: "Vim 命令", exact: true });
  await prompt.fill(value); await prompt.press("Enter");
}

test("native scrollback keeps keyboard paging and prompt history independent", async ({ page }) => {
  await run(page, "help");
  const transcript = page.getByRole("region", { name: "终端历史记录", exact: true });
  await expect(page.locator(".screen-pager")).toHaveCount(0);
  expect(await transcript.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  const input = page.getByRole("textbox", { name: "博客命令", exact: true });
  const before = await transcript.evaluate(el => el.scrollTop);
  await input.press("PageDown");
  await expect.poll(() => transcript.evaluate(el => el.scrollTop)).toBeGreaterThan(before);
  await expect(input).toHaveValue("");
  await input.press("PageUp");
  await expect.poll(() => transcript.evaluate(el => el.scrollTop)).toBeLessThanOrEqual(before);
  await input.fill("pw"); await input.press("ArrowUp");
  await expect(input).toHaveValue("help");
  await input.press("ArrowDown"); await expect(input).toHaveValue("pw");
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test("open renders inline Markdown, while explicit Vim retains dirty text and saves a local copy", async ({ page }) => {
  await run(page, "open /about.md");
  await expect(page.locator(".terminal-document")).toBeVisible();
  await expect(page.locator(".terminal-document header")).toContainText("/about.md");
  await expect(page.getByRole("region", { name: "Vim 编辑器", exact: true })).toHaveCount(0);
  await run(page, "vim /about.md");
  const editor = page.getByRole("region", { name: "Vim 编辑器", exact: true });
  await expect(editor).toHaveAttribute("data-vim-mode", "NORMAL");
  await page.keyboard.press("i");
  const text = page.getByRole("textbox", { name: "Vim 文本", exact: true });
  await text.fill("# 浏览器本地验收副本\n\n中文输入与保存退出。");
  await text.press("Escape");
  await ex(page, "q");
  await expect(editor).toBeVisible();
  await expect(editor).toContainText(/未保存|No write|E37/);
  await ex(page, "wq");
  await expect(editor).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("hadesd.vim.local.v1:/about.md"))).toContain("浏览器本地验收副本");
  await run(page, "vim /about.md");
  await expect(editor).toBeVisible();
  await ex(page, "q");
  await expect(editor).toHaveCount(0);
});

test("display and search remain inline while login uses cancellable text prompts without a form panel", async ({ page }) => {
  await run(page, "display");
  const program = page.locator(".terminal [data-terminal-program]");
  await expect(program).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(program).toHaveCount(0);
  await run(page, "login");
  const username = page.getByRole("textbox", { name: "Username: ", exact: true });
  await expect(username).toBeVisible();
  await expect(program).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await username.fill("guest_reader"); await username.press("Enter");
  const password = page.locator('#terminal-secret[type="password"]');
  await expect(password).toBeVisible();
  await password.fill("not-sent-password-123"); await password.press("Control+c");
  await expect(page.getByRole("textbox", { name: "博客命令", exact: true })).toBeVisible();
  await expect(page.locator(".terminal-transcript")).not.toContainText("not-sent-password-123");
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("textbox", { name: "搜索页面或操作" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "搜索页面或操作" })).toHaveCount(0);
});

test("mobile Vim keeps text and command controls inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await run(page, "vim /about.md");
  const editor = page.getByRole("region", { name: "Vim 编辑器", exact: true });
  await expect(editor).toBeVisible();
  await page.keyboard.press("i");
  await expect(page.getByRole("textbox", { name: "Vim 文本", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await ex(page, "q!");
  await expect(editor).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("guest directory traversal, home completion and Markdown commands retain a chronological transcript", async ({ page }) => {
  const output = page.locator(".terminal-output pre");
  await run(page, "pwd"); await expect(output.last()).toHaveText("/home/guest");
  await run(page, "cd .."); await run(page, "pwd"); await expect(output.last()).toHaveText("/home");
  await run(page, "cd .."); await run(page, "pwd"); await expect(output.last()).toHaveText("/");
  await run(page, "cd");
  const input = page.getByRole("textbox", { name: "博客命令", exact: true });
  await input.fill("md ~/ab"); await input.press("Tab"); await expect(input).toHaveValue("md ~/about.md ");
  await input.press("Enter"); await expect(page.locator(".terminal-document").last()).toContainText("/home/guest/about.md");
  await run(page, "echo preserved-history"); await expect(output.last()).toHaveText("preserved-history");
  await expect(page.locator(".terminal-document")).toHaveCount(1);
  await expect(page.locator(".terminal-record .terminal-echo").last()).toContainText("echo preserved-history");
  expect(new URL(page.url()).pathname).toBe("/");
});

test("a route selected after clear remains visible and restores a readable top position", async ({ page }) => {
  await run(page, "clear");
  await expect(page.locator(".home-page")).toHaveCount(0);
  await page.keyboard.press("Meta+k");
  await page.getByRole("textbox", { name: "搜索页面或操作", exact: true }).fill("关于");
  await page.getByRole("region", { name: "SEARCH / 快速访问", exact: true }).getByRole("button", { name: /^↳ 关于/ }).first().click();
  await expect(page).toHaveURL(/\/about$/);
  const heading = page.getByRole("heading", { name: "关于", exact: true });
  await expect(heading).toBeVisible();
  expect(await heading.evaluate(el => {
    const box = el.getBoundingClientRect(), viewport = el.closest(".terminal-transcript")!.getBoundingClientRect();
    return box.top >= viewport.top && box.bottom <= viewport.bottom;
  })).toBe(true);
});
