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

test("typing a command returns keyboard control to paging and preserves prompt history", async ({ page }) => {
  await run(page, "help");
  const pager = page.locator(".screen-pager:visible");
  await expect(pager).toHaveAttribute("data-pages", /[2-9]|[1-9][0-9]+/);
  await page.keyboard.press("Home");
  await expect(pager).toHaveAttribute("data-page", "1");
  await page.keyboard.press("ArrowDown");
  await expect(pager).toHaveAttribute("data-page", "2");
  await expect(page.getByRole("textbox", { name: "博客命令", exact: true })).toHaveValue("");
  await page.keyboard.press("ArrowUp");
  await expect(pager).toHaveAttribute("data-page", "1");
  const input = page.getByRole("textbox", { name: "博客命令", exact: true });
  await input.fill("pw"); await input.press("ArrowUp");
  await expect(input).toHaveValue("help");
  await input.press("Escape");
});

test("open enters Vim, dirty q retains text, and wq persists an explicitly local copy", async ({ page }) => {
  await run(page, "open /about.md");
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
  await run(page, "open /about.md");
  await expect(editor).toBeVisible();
  await ex(page, "q");
  await expect(editor).toHaveCount(0);
});

test("display, search and login run inside the terminal and exit without native dialogs", async ({ page }) => {
  for (const command of ["display", "login"]) {
    await run(page, command);
    const program = page.locator(".terminal [data-terminal-program]");
    await expect(program).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(program).toHaveCount(0);
  }
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("textbox", { name: "搜索页面或操作" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "搜索页面或操作" })).toHaveCount(0);
});

test("mobile Vim keeps text and command controls inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await run(page, "open /about.md");
  const editor = page.getByRole("region", { name: "Vim 编辑器", exact: true });
  await expect(editor).toBeVisible();
  await page.keyboard.press("i");
  await expect(page.getByRole("textbox", { name: "Vim 文本", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await ex(page, "q!");
  await expect(editor).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
