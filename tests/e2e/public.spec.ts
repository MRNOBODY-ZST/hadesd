import { test, expect, type CDPSession, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const article = "/posts/welcome-to-hadesd";
const articleTitle = "欢迎来到 hadesd.sh";
const longArticle = "/posts/time-and-backpressure";
const longTitle = "非阻塞系统中的时间与背压";
const shots = process.env.E2E_SCREENSHOTS_DIR ?? ".local/reports/screenshots";

test.beforeAll(async () => {
  await mkdir(shots, { recursive: true });
});

async function ready(page: Page) {
  const stage = page.locator(".terminal-stage");
  // Business tests enter directly; the intro tests below exercise its real timeline.
  // Wait for initialization so an early skip cannot masquerade as GPU readiness.
  await expect(stage).toHaveAttribute("data-renderer", /^(WebGPU|WebGL2|DOM)$/, {
    timeout: 35000,
  });
  if ((await stage.getAttribute("data-stage-ready")) !== "true") {
    await page.getByRole("button", { name: "跳过片头，进入终端", exact: true }).click();
  }
  await expect(stage).toHaveAttribute(
    "data-stage-ready",
    "true",
    { timeout: 35000 },
  );
  await expect(stage).toHaveAttribute("data-intro-phase", "terminal");
  await expect(stage).toHaveAttribute("data-reveal-step", "7");
  await expect(page.locator(".stage-content")).not.toHaveAttribute("inert");
  await expect(page.locator("html")).toHaveAttribute("data-terminal", "true");
}
async function openTerminal(page: Page, path = "/") {
  await page.goto(path + (path.includes("?") ? "&" : "?") + "gpu=webgl");
  await ready(page);
}
async function pathname(page: Page, path: string) {
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
}
async function run(page: Page, command: string) {
  const field = page.getByRole("textbox", { name: "博客命令" });
  await field.fill(command);
  await field.press("Enter");
  // reboot hides the semantic input immediately; its persistent DOM value still clears.
  await expect(page.locator("#terminal-command")).toHaveValue("");
}
async function screenNumber(page: Page) {
  return Number(await page.locator(".screen-pager").getAttribute("data-page"));
}
async function firstScreen(page: Page) {
  while ((await screenNumber(page)) > 1) {
    const before = await screenNumber(page);
    await page.getByRole("button", { name: "上一屏", exact: true }).click();
    await expect(page.locator(".screen-pager")).toHaveAttribute(
      "data-page",
      String(before - 1),
    );
  }
}
async function withinScreen(page: Page, target: Locator) {
  const element = await target.boundingBox();
  const viewport = await page.locator(".screen-viewport").boundingBox();
  return !!(
    element &&
    viewport &&
    element.y >= viewport.y - 1 &&
    element.y + element.height <= viewport.y + viewport.height + 1 &&
    element.x >= viewport.x - 1 &&
    element.x + element.width <= viewport.x + viewport.width + 1
  );
}
/** Use the same explicit paging controls as a reader, never locator scrolling. */
async function reveal(page: Page, target: Locator) {
  await expect(target).toBeAttached();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await firstScreen(page);
  const pages = Number(
    await page.locator(".screen-pager").getAttribute("data-pages"),
  );
  for (let i = 0; i < pages; i++) {
    if (await withinScreen(page, target)) return;
    const next = page.getByRole("button", { name: "下一屏", exact: true });
    if (await next.isDisabled()) break;
    const before = await screenNumber(page);
    await next.click();
    await expect(page.locator(".screen-pager")).toHaveAttribute(
      "data-page",
      String(before + 1),
    );
  }
  expect(
    await withinScreen(page, target),
    "The requested control must be reachable on an actual terminal screen",
  ).toBe(true);
}
async function fixedGeometry(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".screen-viewport") as HTMLElement;
    const box = document
      .querySelector(".terminal-stage")!
      .getBoundingClientRect();
    return {
      x: scrollX,
      y: scrollY,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      innerWidth,
      innerHeight,
      terminalHeight: box.height,
      viewportScroll: viewport.scrollTop,
      overflow: getComputedStyle(document.documentElement).overflow,
    };
  });
}

type IntroGraphics = {
  backend: string;
  frames: number;
  introPhase: string;
  journey: number;
  phaseProgress: number;
  bootProgress: number;
  revealStep: number;
  asciiActive: boolean;
  asciiTilesVisible: boolean;
  hardwareVisible: boolean;
  visibleHardwareCount: number;
  macVisible: boolean;
};
type IntroSample = {
  phase: string; journey: number; boot: number; phaseProgress: number;
  reveal: number; ready: boolean; inert: boolean;
  visible: (boolean | null)[];
};
/** Observe actual committed DOM phases, including short transitions between assertions. */
async function observeIntro(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { __hadesdIntroSamples: IntroSample[] };
    state.__hadesdIntroSamples = [];
    const selectors = [".terminal-session", ".terminal-identity", ".terminal-files", ".terminal-recent", ".terminal-welcome-hint", ".screen-paging", ".terminal-input"];
    const record = () => {
      const stage = document.querySelector<HTMLElement>(".terminal-stage");
      if (!stage) return;
      state.__hadesdIntroSamples.push({
        phase: stage.dataset.introPhase!, journey: Number(stage.dataset.introProgress),
        boot: Number(stage.dataset.bootProgress), phaseProgress: Number(stage.dataset.phaseProgress),
        reveal: Number(stage.dataset.revealStep), ready: stage.dataset.stageReady === "true",
        inert: !!stage.querySelector(".stage-content[inert]"),
        visible: selectors.map((selector) => {
          const element = stage.querySelector(selector);
          return element ? getComputedStyle(element).visibility === "visible" : null;
        }),
      });
      if (state.__hadesdIntroSamples.length > 2000) state.__hadesdIntroSamples.shift();
    };
    new MutationObserver(record).observe(document, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["data-intro-phase", "data-intro-progress", "data-boot-progress", "data-phase-progress", "data-reveal-step", "data-stage-ready", "data-terminal-reveal-step"],
    });
  });
}
async function introSamples(page: Page) {
  return page.evaluate(() => (window as unknown as { __hadesdIntroSamples: IntroSample[] }).__hadesdIntroSamples);
}
function assertCompleteIntro(samples: IntroSample[]) {
  const phases = samples.map((sample) => sample.phase).filter((phase, index, all) => index === 0 || phase !== all[index - 1]);
  expect(phases).toEqual(["boot", "pullback", "hero", "journey", "resume", "penetrate", "reveal", "terminal"]);
  const boot = samples.filter((sample) => sample.phase === "boot");
  expect(boot.some((sample) => sample.boot > 0)).toBe(true);
  expect(boot.every((sample) => sample.boot <= 80)).toBe(true);
  expect(samples.filter((sample) => ["pullback", "hero", "journey"].includes(sample.phase)).every((sample) => sample.boot === 80 && !sample.ready)).toBe(true);
  expect(samples.some((sample) => sample.phase === "resume" && sample.boot > 80 && sample.boot < 100 && !sample.ready)).toBe(true);
  const reveals = samples.filter((sample) => sample.phase === "reveal");
  expect(new Set(reveals.map((sample) => sample.reveal))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  expect(reveals.every((sample) => sample.inert && !sample.ready && sample.boot === 100)).toBe(true);
  for (const sample of reveals) {
    sample.visible.forEach((visible, group) => {
      if (visible !== null) expect(visible, `group ${group + 1} at reveal ${sample.reveal}`).toBe(group < sample.reveal);
    });
  }
}
async function waitForRevealingTerminal(page: Page) {
  const stage = page.locator(".terminal-stage");
  await expect(stage).toHaveAttribute("data-intro-phase", "resume");
  await expect(stage).toHaveAttribute("data-stage-ready", "false");
  await expect(stage).toHaveAttribute("data-intro-phase", "penetrate");
  await expect(stage).toHaveAttribute("data-boot-progress", "100");
  const handle = await page.waitForFunction(() => {
    const samples = (window as unknown as { __hadesdIntroSamples: IntroSample[] }).__hadesdIntroSamples;
    return samples.find((sample) => sample.phase === "reveal" && sample.reveal >= 3 && sample.reveal <= 5);
  });
  const partial = await handle.jsonValue();
  if (!partial) throw new Error("The terminal never exposed a partial reveal snapshot");
  expect(partial.ready).toBe(false);
  expect(partial.inert).toBe(true);
  expect(partial.visible[0]).toBe(true);
  expect(partial.visible[2]).toBe(true);
  expect(partial.visible[6]).toBe(false);
  await handle.dispose();
  await expect(stage).toHaveAttribute("data-stage-ready", "true", { timeout: 15000 });
  await expect(stage).toHaveAttribute("data-reveal-step", "7");
  return partial;
}
async function introGraphics(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __hadesdGraphics?: IntroGraphics }).__hadesdGraphics,
  );
}
async function expectFixedViewport(page: Page) {
  const geometry = await fixedGeometry(page);
  expect(geometry.x).toBe(0);
  expect(geometry.y).toBe(0);
  expect(geometry.width).toBeLessThanOrEqual(geometry.innerWidth);
  expect(geometry.height).toBeLessThanOrEqual(geometry.innerHeight);
  expect(geometry.viewportScroll).toBe(0);
}
async function touchSwipe(session: CDPSession, x: number, from: number, to: number) {
  // CDP dispatches real touch input through Chromium; no synthetic wheel shortcut.
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [{ x, y: from }],
  });
  for (let step = 1; step <= 8; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x, y: from + (to - from) * step / 8 }],
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("DOS pauses at 80%, pulls back to Mac, then scroll resumes boot, penetrates and reveals the terminal", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await observeIntro(page);
  await page.goto("/?gpu=webgl");
  const stage = page.locator(".terminal-stage");
  await expect(stage).toHaveAttribute("data-intro-phase", "boot");
  await expect(page.locator(".stage-boot-status")).toBeVisible();
  await expect.poll(async () => (await introGraphics(page))?.introPhase, { timeout: 35000 }).toBe("boot");
  await page.screenshot({ path: shots + "/intro-desktop-dos.png" });
  await expectFixedViewport(page);

  await expect(stage).toHaveAttribute("data-intro-phase", "pullback", { timeout: 15000 });
  await expect(stage).toHaveAttribute("data-boot-progress", "80");
  await expect(page.locator(".stage-hero")).toHaveAttribute("inert", "");
  await expect(stage).toHaveAttribute("data-intro-phase", "hero", { timeout: 15000 });
  await expect(stage).toHaveAttribute("data-boot-progress", "80");
  await expect(page.getByRole("region", { name: "个人计算机介绍" })).toBeVisible();
  await expect(page.getByRole("button", { name: "进入终端", exact: true })).toBeVisible();
  await expect.poll(async () => (await introGraphics(page))?.macVisible).toBe(true);
  await page.waitForTimeout(900); // Hero intentionally waits for the reader indefinitely.
  await expect(stage).toHaveAttribute("data-intro-phase", "hero");
  await expect(stage).toHaveAttribute("data-intro-progress", "0");
  await expect(stage).toHaveAttribute("data-stage-ready", "false");
  await page.screenshot({ path: shots + "/intro-desktop-hero.png" });

  await page.mouse.move(980, 480);
  await page.mouse.wheel(0, 360);
  await expect(stage).toHaveAttribute("data-intro-phase", "journey");
  await expect.poll(async () => Number(await stage.getAttribute("data-intro-progress"))).toBeGreaterThanOrEqual(17);
  expect(Number(await stage.getAttribute("data-intro-progress"))).toBeLessThan(30);
  await expectFixedViewport(page);
  // All four positions have the same DOM percentage. The physical Mac and
  // first tile must switch in the GPU frame, without a React percentage update.
  const wheelSpan = Math.max(1200, page.viewportSize()!.height * 2.1);
  let wheelTotal = 360;
  const handoff: IntroGraphics[] = [];
  for (const [index, target] of [0.2749, 0.2751, 0.2749, 0.2751].entries()) {
    const destination = target * wheelSpan;
    await page.mouse.wheel(0, destination - wheelTotal);
    wheelTotal = destination;
    await expect.poll(async () => Math.abs((await introGraphics(page))!.journey - target)).toBeLessThan(1e-6);
    const frame = (await introGraphics(page))!;
    expect(frame.macVisible).toBe(target < 0.275);
    expect(frame.asciiTilesVisible).toBe(target >= 0.275);
    expect(Number(frame.macVisible) + Number(frame.asciiTilesVisible)).toBe(1);
    await expect(stage).toHaveAttribute("data-intro-progress", "27");
    await expect(stage).toHaveAttribute("data-intro-phase", "journey");
    handoff.push(frame);
    if (index < 2) await page.screenshot({ path: shots + `/intro-desktop-handoff-${index === 0 ? "mac" : "tile"}.png` });
  }
  await page.mouse.wheel(0, 1040 - wheelTotal);
  await expect.poll(async () => Number(await stage.getAttribute("data-intro-progress"))).toBeGreaterThanOrEqual(53);
  await expect.poll(async () => (await introGraphics(page))?.asciiActive).toBe(true);
  await expect.poll(async () => (await introGraphics(page))?.hardwareVisible).toBe(true);
  const middle = await introGraphics(page);
  expect(middle?.visibleHardwareCount).toBeGreaterThanOrEqual(3);
  expect(middle?.journey).toBeLessThan(0.7);
  await page.screenshot({ path: shots + "/intro-desktop-hardware-ascii.png" });
  await expectFixedViewport(page);

  // Spatial motion belongs to wheel input. GPU frames may continue for the wink
  // and CRT, but pausing or reversing must not advance the screen journey.
  await page.waitForTimeout(1100);
  const held = (await introGraphics(page))!;
  await page.waitForTimeout(650);
  const still = (await introGraphics(page))!;
  expect(still.journey).toBeCloseTo(held.journey, 3);
  expect(still.frames).toBeGreaterThan(held.frames);
  await expect(stage).toHaveAttribute("data-intro-phase", "journey");
  await expect(stage).toHaveAttribute("data-boot-progress", "80");
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await introGraphics(page))!.journey).toBeLessThan(held.journey - 0.06);
  await page.waitForTimeout(900);
  const reversed = (await introGraphics(page))!;
  expect(reversed.asciiActive).toBe(true);
  await expect(stage).toHaveAttribute("data-stage-ready", "false");
  await page.screenshot({ path: shots + "/intro-desktop-ascii-reversed.png" });
  await expectFixedViewport(page);
  await page.mouse.wheel(0, 200);
  await expect.poll(async () => Math.abs((await introGraphics(page))!.journey - held.journey)).toBeLessThan(0.002);
  const returned = (await introGraphics(page))!;
  expect(returned.asciiActive).toBe(true);
  await page.screenshot({ path: shots + "/intro-desktop-ascii-returned.png" });
  const journeyControl = { held, still, reversed, returned };

  await page.mouse.wheel(0, 1000);
  const partial = await waitForRevealingTerminal(page);
  await expect.poll(async () => (await introGraphics(page))?.introPhase).toBe("terminal");
  const terminal = await introGraphics(page);
  expect(terminal?.asciiActive).toBe(false);
  expect(terminal?.hardwareVisible).toBe(false);
  expect(terminal?.macVisible).toBe(false);
  await expectFixedViewport(page);
  await run(page, "pwd");
  await expect(page.locator(".terminal-output pre").last()).toHaveText("/");
  await page.screenshot({ path: shots + "/intro-desktop-terminal.png" });
  expect(errors).toEqual([]);
  const samples = await introSamples(page);
  assertCompleteIntro(samples);
  await writeFile(".local/reports/intro-v4-1-desktop.json", JSON.stringify({ handoff, middle, journeyControl, partial, terminal, samples, errors }, null, 2));
});

test("mobile touch completes resumed boot and staged reveal without document scrolling or premature focus", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: String(test.info().project.use.baseURL), viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "no-preference",
  });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await observeIntro(page);
    await page.goto("/?gpu=webgl");
    const stage = page.locator(".terminal-stage");
    await expect(stage).toHaveAttribute("data-intro-phase", "boot");
    await expect(stage).toHaveAttribute("data-intro-phase", "hero", { timeout: 35000 });
    await expect(stage).toHaveAttribute("data-boot-progress", "80");
    await expect.poll(async () => (await introGraphics(page))?.macVisible).toBe(true);
    await expect(page.getByRole("button", { name: "进入终端", exact: true })).toBeVisible();
    expect(await page.evaluate(() => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName || ""))).toBe(false);
    await page.screenshot({ path: shots + "/intro-mobile-hero.png" });
    await expectFixedViewport(page);
    const session = await context.newCDPSession(page);
    await touchSwipe(session, 195, 670, 380);
    await expect(stage).toHaveAttribute("data-intro-phase", "journey");
    await expect.poll(async () => Number(await stage.getAttribute("data-intro-progress"))).toBeGreaterThanOrEqual(25);
    expect(Number(await stage.getAttribute("data-intro-progress"))).toBeLessThan(40);
    await expectFixedViewport(page);
    // Stop on the four-hardware composition. A second full-length swipe lands
    // near 57%, where hardware is already exiting; sampling its earlier frame
    // merely because the DOM passed 53% made this assertion timing dependent.
    await touchSwipe(session, 195, 670, 464);
    await expect.poll(async () => Math.abs((await introGraphics(page))!.journey - 0.49)).toBeLessThan(0.001);
    const settled = (await introGraphics(page))!;
    await page.waitForTimeout(500);
    const middle = (await introGraphics(page))!;
    expect(middle.journey).toBeCloseTo(settled.journey, 3);
    expect(middle.asciiActive).toBe(true);
    expect(middle.hardwareVisible).toBe(true);
    expect(middle.visibleHardwareCount).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: shots + "/intro-mobile-hardware-ascii.png" });
    await expectFixedViewport(page);
    await touchSwipe(session, 195, 740, 170);
    const partial = await waitForRevealingTerminal(page);
    await expect.poll(async () => (await introGraphics(page))?.introPhase).toBe("terminal");
    await expectFixedViewport(page);
    expect(await page.evaluate(() => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName || ""))).toBe(false);
    await page.screenshot({ path: shots + "/intro-mobile-terminal.png" });
    expect(errors).toEqual([]);
    const samples = await introSamples(page);
    assertCompleteIntro(samples);
    await writeFile(".local/reports/intro-v4-1-mobile.json", JSON.stringify({ middle, partial, terminal: await introGraphics(page), samples, errors }, null, 2));
    await session.detach();
  } finally {
    await context.close();
  }
});

test("mouse, terminal, palette, tag and live search reach the same file; copy and reader remain functional", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openTerminal(page);
  const posts = page.locator(".terminal-files a").filter({ hasText: "posts/" });
  await reveal(page, posts);
  await posts.click();
  await pathname(page, "/posts");
  const mouseFile = page.getByRole("link", { name: articleTitle, exact: true });
  await reveal(page, mouseFile);
  await mouseFile.click();
  await pathname(page, article);
  await expect(
    page.getByRole("heading", { name: articleTitle, exact: true }),
  ).toBeVisible();
  const copy = page
    .getByRole("button", { name: "复制代码", exact: true })
    .first();
  await reveal(page, copy);
  await copy.click();
  await expect(
    page.getByRole("button", { name: "已复制", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("open welcome-to-hadesd.md");
  const reader = page.getByRole("button", { name: "专注阅读 ↗", exact: true });
  await reveal(page, reader);
  await reader.click();
  await expect(page.locator("html")).toHaveAttribute("data-reader", "true");
  await expect(page.locator(".terminal-stage")).toHaveAttribute(
    "data-graphics",
    "false",
  );
  await page.getByRole("button", { name: "退出阅读模式", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-reader", "false");

  await page.getByRole("link", { name: "HADESD 首页", exact: true }).click();
  await run(page, "help");
  const help = page.getByText("查看命令与使用示例", { exact: true });
  await reveal(page, help);
  await page.screenshot({ path: shots + "/terminal-help.png" });
  for (const command of ["ls", "cd posts", "ls", "open welcome-to-hadesd.md"]) {
    await run(page, command);
    if (command === "cd posts") await pathname(page, "/posts");
  }
  await pathname(page, article);
  await expect(page.locator(".prompt")).toContainText("~/posts");
  await expect(
    page.getByRole("heading", { name: articleTitle, exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "搜索与命令面板", exact: true })
    .click();
  await page.getByRole("textbox", { name: "搜索页面或操作" }).fill("欢迎");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(articleTitle) })
    .click();
  await pathname(page, article);
  const tag = page.getByRole("link", { name: "#随笔", exact: true });
  await reveal(page, tag);
  await tag.click();
  await pathname(page, "/tags/" + encodeURIComponent("随笔"));
  const tagFile = page.getByRole("link", { name: articleTitle, exact: true });
  await reveal(page, tagFile);
  await tagFile.click();
  await pathname(page, article);
  await run(page, 'search "欢迎"');
  await pathname(page, "/search");
  const searchFile = page.getByRole("link", {
    name: articleTitle,
    exact: true,
  });
  await expect(searchFile).toBeAttached();
  await reveal(page, searchFile);
  await page.screenshot({ path: shots + "/search.png" });
  await searchFile.click();
  await pathname(page, article);
  expect(errors).toEqual([]);
});

test("published HTML exposes complete articles, math, SEO and file links without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const response = await page.goto(baseURL + article);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: articleTitle, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "让好奇心持续运行", exact: true }),
  ).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://hadesd.sh" + article,
  );
  expect(await page.title()).toContain(articleTitle);
  await expect(page.locator(".stage-content")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: shots + "/article-no-javascript.png",
    fullPage: true,
  });
  await page
    .locator("article")
    .getByRole("link", { name: "posts", exact: true })
    .click();
  await pathname(page, "/posts");
  await expect(
    page.getByRole("link", { name: articleTitle, exact: true }),
  ).toBeVisible();
  await page.goto(baseURL + longArticle);
  await expect(
    page.getByRole("heading", { name: longTitle, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".katex").first()).toBeVisible();
  await expect(page.locator(".markdown table")).toBeVisible();
  await expect(page.getByText("END OF FILE", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector(".screen-viewport")!).overflow,
    ),
  ).toBe("visible");
  await page.screenshot({
    path: shots + "/long-article-no-javascript.png",
    fullPage: true,
  });
  await context.close();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`fixed terminal, cursor and mouse paging at ${viewport.width}x${viewport.height}`, async ({
    browser,
    baseURL,
  }) => {
    const mobile = viewport.width < 768;
    const context = await browser.newContext({
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
      baseURL,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openTerminal(page);
    await expect(page.locator(".terminal-banner")).toContainText("██");
    await expect(page.locator(".terminal-session")).toContainText("TTY 01");
    await expect(page.locator("[data-terminal-cursor]")).toHaveText("█");
    await expect(page.getByRole("textbox", { name: "博客命令" })).toBeVisible();
    expect(await page.locator(".terminal-shell header").count()).toBe(0);
    if (mobile) {
      expect(
        await page.evaluate(() =>
          ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName ?? ""),
        ),
      ).toBe(false);
    }
    const before = await fixedGeometry(page);
    expect(before.overflow).toBe("hidden");
    expect(before.width).toBeLessThanOrEqual(viewport.width);
    expect(before.height).toBe(viewport.height);
    expect(before.terminalHeight).toBe(viewport.height);
    const screenBefore = await screenNumber(page);
    const box = await page.locator(".screen-viewport").boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 1200);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await fixedGeometry(page)).toEqual(before);
    expect(await screenNumber(page)).toBe(screenBefore);
    await page.screenshot({
      path: `${shots}/terminal-home-${viewport.width}x${viewport.height}.png`,
    });

    await run(page, "open /posts/time-and-backpressure.md");
    await pathname(page, longArticle);
    await expect(
      page.getByRole("heading", { name: longTitle, exact: true }),
    ).toBeVisible();
    const pages = Number(
      await page.locator(".screen-pager").getAttribute("data-pages"),
    );
    expect(pages).toBeGreaterThan(1);
    await page.getByRole("button", { name: "下一屏", exact: true }).click();
    await expect(page.locator(".screen-pager")).toHaveAttribute(
      "data-page",
      "2",
    );
    await page.keyboard.press("k");
    await expect(page.locator(".screen-pager")).toHaveAttribute(
      "data-page",
      "1",
    );
    await page.keyboard.press("j");
    await expect(page.locator(".screen-pager")).toHaveAttribute(
      "data-page",
      "2",
    );
    await page.keyboard.press("PageUp");
    await expect(page.locator(".screen-pager")).toHaveAttribute(
      "data-page",
      "1",
    );
    expect((await fixedGeometry(page)).y).toBe(0);
    expect((await fixedGeometry(page)).viewportScroll).toBe(0);
    await page.screenshot({
      path: `${shots}/article-${viewport.width}x${viewport.height}.png`,
    });
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("every long-article block remains reachable by discrete pages and TOC jumps to its page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await openTerminal(page, longArticle);
  const blocks = page.locator(
    ".markdown h1,.markdown h2,.markdown h3,.markdown h4,.markdown p,.markdown li,.markdown pre,.markdown table,.markdown img,.markdown .katex-display",
  );
  const total = await blocks.count();
  expect(total).toBeGreaterThan(10);
  const covered = new Set<number>();
  const pages = Number(
    await page.locator(".screen-pager").getAttribute("data-pages"),
  );
  expect(pages).toBeGreaterThan(1);
  for (let i = 0; i < pages; i++) {
    const current = await page.evaluate(() => {
      const viewport = document
        .querySelector(".screen-viewport")!
        .getBoundingClientRect();
      return Array.from(
        document.querySelectorAll(
          ".markdown h1,.markdown h2,.markdown h3,.markdown h4,.markdown p,.markdown li,.markdown pre,.markdown table,.markdown img,.markdown .katex-display",
        ),
      ).flatMap((block, index) => {
        const rect = block.getBoundingClientRect(),
          middle = rect.top + rect.height / 2;
        return rect.height > 0 &&
          middle >= viewport.top &&
          middle <= viewport.bottom
          ? [index]
          : [];
      });
    });
    for (const index of current) covered.add(index);
    expect((await fixedGeometry(page)).y).toBe(0);
    if (i + 1 < pages)
      await page.getByRole("button", { name: "下一屏", exact: true }).click();
  }
  expect(
    covered.size,
    "Every rendered long-article block must pass through an actual terminal screen",
  ).toBe(total);
  const end = page.getByText("END OF FILE", { exact: true });
  await reveal(page, end);
  await page.screenshot({ path: shots + "/terminal-end-of-file.png" });
  const lastToc = page
    .getByRole("navigation", { name: "文章目录" })
    .getByRole("link")
    .last();
  const hash = await lastToc.getAttribute("href");
  await reveal(page, lastToc);
  await lastToc.click();
  const heading = page.locator(`[id="${decodeURIComponent(hash!.slice(1))}"]`);
  expect(await withinScreen(page, heading)).toBe(true);
  expect(await screenNumber(page)).toBeGreaterThan(1);
  expect((await fixedGeometry(page)).y).toBe(0);
  const widths = await page.evaluate(() => {
    const viewport = document.querySelector(".screen-viewport") as HTMLElement;
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        ".md-code,.md-table,.katex-display",
      ),
    ).map((element) => ({
      width: element.scrollWidth,
      limit: viewport.clientWidth,
    }));
  });
  for (const value of widths)
    expect(value.width).toBeLessThanOrEqual(value.limit + 1);
});

test("real Three TSL text render targets boot, animate, and reboot without losing terminal interaction", async ({
  page,
}) => {
  await observeIntro(page);
  await openTerminal(page);
  const stage = page.locator(".terminal-stage");
  await expect(stage).toHaveAttribute("data-renderer", "WebGL2");
  await expect(stage).toHaveAttribute("data-graphics", "true");
  await expect(page.locator(".stage-content")).toHaveCSS("opacity", "0");
  const graphics = await page.evaluate(
    () =>
      (
        window as unknown as {
          __hadesdGraphics: {
            backend: string;
            frames: number;
            renderTargets: number;
            tsl: boolean;
            textTexture: boolean;
            textureWidth: number;
            textureHeight: number;
          };
        }
      ).__hadesdGraphics,
  );
  expect(graphics.backend).toBe("WebGL2");
  expect(graphics.tsl).toBe(true);
  expect(graphics.textTexture).toBe(true);
  expect(graphics.renderTargets).toBeGreaterThanOrEqual(2);
  expect(graphics.textureWidth).toBeGreaterThan(200);
  expect(graphics.textureHeight).toBeGreaterThan(100);
  await page.mouse.move(300, 210);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __hadesdGraphics: { frames: number } })
            .__hadesdGraphics.frames,
      ),
    )
    .toBeGreaterThan(graphics.frames);
  await page.evaluate(() => { (window as unknown as { __hadesdIntroSamples: IntroSample[] }).__hadesdIntroSamples = []; });
  await page.getByRole("button", { name: "[ reboot ]", exact: true }).click();
  await expect(stage).toHaveAttribute("data-stage-ready", "false");
  await expect(stage).toHaveAttribute("data-intro-phase", "boot");
  await expect(stage).toHaveAttribute("data-intro-progress", "0");
  await expect(stage).toHaveAttribute("data-reveal-step", "0");
  await expect(page.locator(".stage-boot-status")).toBeVisible();
  await expect.poll(async () => (await introGraphics(page))?.introPhase).toBe("boot");
  await page.screenshot({ path: shots + "/terminal-reboot-dos.png" });
  await expect(stage).toHaveAttribute("data-intro-phase", "pullback", { timeout: 15000 });
  await expect(stage).toHaveAttribute("data-boot-progress", "80");
  await expect(stage).toHaveAttribute("data-intro-phase", "hero", { timeout: 15000 });
  await page.getByRole("button", { name: "进入终端", exact: true }).click();
  await expect(stage).toHaveAttribute("data-intro-phase", "journey");
  const partial = await waitForRevealingTerminal(page);
  const samples = await introSamples(page);
  assertCompleteIntro(samples);
  await run(page, "pwd");
  await expect(page.locator(".terminal-output pre").last()).toHaveText("/");
  await writeFile(
    ".local/reports/webgl.json",
    JSON.stringify(
      {
        ...graphics,
        reboot: "passed", partial, samples,
        note: "Real browser WebGL2 TSL/render-target path. Headless browser evidence does not establish physical GPU frame rate.",
      },
      null,
      2,
    ),
  );
});

test("keyboard skip exits every intro phase with all terminal groups visible and no stale transition", async ({ page }) => {
  await openTerminal(page);
  const stage = page.locator(".terminal-stage");
  const phases = ["boot", "pullback", "hero", "journey", "resume", "penetrate", "reveal"];
  for (const [index, phase] of phases.entries()) {
    await run(page, "reboot");
    await expect(stage).toHaveAttribute("data-reveal-step", "0");
    if (phase === "pullback") {
      await expect(stage).toHaveAttribute("data-intro-phase", "pullback");
    } else if (phase !== "boot") {
      await expect(stage).toHaveAttribute("data-intro-phase", "hero", { timeout: 15000 });
      if (phase !== "hero") {
        await page.keyboard.press(phase === "journey" ? "PageDown" : "End");
        await expect(stage).toHaveAttribute("data-intro-phase", phase, { timeout: 15000 });
      }
    }
    await expect(stage).toHaveAttribute("data-intro-phase", phase);
    await page.getByRole("button", { name: "跳过片头，进入终端", exact: true }).focus();
    await page.keyboard.press(index % 2 === 0 ? "Enter" : "Escape");
    await expect(stage).toHaveAttribute("data-stage-ready", "true");
    await expect(stage).toHaveAttribute("data-reveal-step", "7");
    await expect(page.locator(".stage-content")).not.toHaveAttribute("inert");
    await expect(page.locator(".terminal-input")).toHaveCSS("visibility", "visible");
  }
  await page.waitForTimeout(2100);
  await expect(stage).toHaveAttribute("data-intro-phase", "terminal");
  await run(page, "pwd");
  await expect(page.locator(".terminal-output pre").last()).toHaveText("/");
});

test("display preferences migrate cleanly, restore themes on reload and preserve keyboard modal controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      "hadesd.display",
      JSON.stringify({ theme: "paper", crt: "low", reader: true }),
    );
  });
  await openTerminal(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "amber");
  await expect(page.locator("html")).toHaveAttribute("data-reader", "false");
  await page.getByRole("button", { name: "显示设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "完整", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "荧绿", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "green");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.screenshot({ path: shots + "/terminal-green-theme.png" });
  await page.reload();
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "green");
  await page.getByRole("button", { name: "显示设置", exact: true }).click();
  await page.getByRole("button", { name: "纸张", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await page.keyboard.press("Escape");
  await expect(page.locator(".stage-content")).toHaveCSS("opacity", "1");
  await page.reload();
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await expect(page.locator(".terminal-stage")).toHaveAttribute(
    "data-graphics",
    "false",
  );
  await page.screenshot({ path: shots + "/paper-theme.png" });
  await page.getByRole("textbox", { name: "博客命令" }).focus();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "搜索页面或操作" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("textbox", { name: "博客命令" })).toBeFocused();
  expect(errors).toEqual([]);
});

test("GPU unavailable falls back to a readable fixed DOM terminal with its blinking cursor", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      get: () => undefined,
      configurable: true,
    });
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (["webgl", "webgl2", "experimental-webgl", "webgpu"].includes(type))
        return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openTerminal(page, article);
  await expect(page.locator(".terminal-stage")).toHaveAttribute(
    "data-renderer",
    "DOM",
  );
  await expect(page.locator(".stage-content")).toHaveCSS("opacity", "1");
  await expect(
    page.getByRole("heading", { name: articleTitle, exact: true }),
  ).toBeVisible();
  const cursor = page.locator("[data-terminal-cursor]");
  await expect(cursor).toHaveText("█");
  await expect
    .poll(() =>
      cursor.evaluate((element) => getComputedStyle(element).visibility),
    )
    .toBe("hidden");
  await expect
    .poll(() =>
      cursor.evaluate((element) => getComputedStyle(element).visibility),
    )
    .toBe("visible");
  await run(page, "ls ~");
  await expect(page.locator(".terminal-output")).toContainText("projects/");
  expect((await fixedGeometry(page)).y).toBe(0);
  await page.screenshot({ path: shots + "/webgl-disabled.png" });
  expect(errors).toEqual([]);
  await context.close();
});

test("actual Three WebGL context loss preserves the current file and usable DOM commands", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openTerminal(page, article);
  await expect(page.locator(".terminal-stage")).toHaveAttribute(
    "data-renderer",
    "WebGL2",
  );
  const info = await page
    .locator(".stage-graphics canvas")
    .evaluate((canvas) => {
      const gl = (canvas as HTMLCanvasElement).getContext("webgl2");
      if (!gl)
        return {
          available: false,
          lossInvoked: false,
          renderer: "unavailable",
        };
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      const extension = gl.getExtension("WEBGL_lose_context");
      extension?.loseContext();
      return { available: true, lossInvoked: !!extension, renderer };
    });
  expect(info.available).toBe(true);
  expect(info.lossInvoked).toBe(true);
  await expect(page.locator(".terminal-stage")).toHaveAttribute(
    "data-renderer",
    "DOM",
  );
  await expect(page.locator(".stage-content")).toHaveCSS("opacity", "1");
  await expect(
    page.getByRole("heading", { name: articleTitle, exact: true }),
  ).toBeVisible();
  await pathname(page, article);
  await run(page, "pwd");
  await expect(page.locator(".terminal-output pre").last()).toHaveText(
    "/posts",
  );
  await page.screenshot({ path: shots + "/terminal-context-loss.png" });
  await writeFile(
    ".local/reports/context-loss.json",
    JSON.stringify(
      { ...info, fallback: "DOM", terminalCommands: "passed" },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});
