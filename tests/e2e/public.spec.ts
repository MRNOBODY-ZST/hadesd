import { test, expect, type CDPSession, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const article = "/posts/welcome-to-hadesd";
const articleTitle = "欢迎来到 hadesd.sh";
const longArticle = "/posts/time-and-backpressure";
const longTitle = "非阻塞系统中的时间与背压";
const shots = process.env.E2E_SCREENSHOTS_DIR ?? ".local/reports/screenshots";
const introShot = (name: string) => shots + "/e2e-" + name;

test.beforeAll(async () => {
  await mkdir(shots, { recursive: true });
});

async function ready(page: Page) {
  const stage = page.locator(".terminal-stage");
  // Respect the system accessibility preference for flows unrelated to the intro.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(stage).toHaveAttribute("data-renderer", /^(WebGPU|WebGL2|DOM)$/, {
    timeout: 35000,
  });
  await expect(stage).toHaveAttribute(
    "data-stage-ready",
    "true",
    { timeout: 35000 },
  );
  await expect(stage).toHaveAttribute("data-intro-phase", "terminal");
  await expect(stage).toHaveAttribute("data-reveal-step", "7");
  await expect(page.locator(".stage-content")).not.toHaveAttribute("inert");
  await expect(page.locator("html")).toHaveAttribute("data-terminal", "true");
  await page.emulateMedia({ reducedMotion: "no-preference" });
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
async function scrollTop(page: Page) {
  return page.locator(".terminal-transcript").evaluate(el => el.scrollTop);
}
async function withinScreen(page: Page, target: Locator) {
  return target.evaluate(element => {
    const box = element.getBoundingClientRect();
    const viewport = element.closest(".terminal-transcript,.terminal-program-scroll")?.getBoundingClientRect();
    return !!viewport && box.y >= viewport.y - 1 && box.bottom <= viewport.bottom + 1
      && box.x >= viewport.x - 1 && box.right <= viewport.right + 1;
  });
}
/** A real native scroll container makes every DOM control directly reachable. */
async function reveal(page: Page, target: Locator) {
  await expect(target).toBeAttached();
  await target.scrollIntoViewIfNeeded();
  await expect.poll(() => withinScreen(page, target)).toBe(true);
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
  binaryStreamsVisible: boolean;
  visibleBinaryStreamCount: number;
  macVisible: boolean;
  bootSequence: number;
};
type IntroSample = {
  phase: string; journey: number; boot: number; phaseProgress: number;
  renderer: string; bootSegment: string | null; time: number;
  reveal: number; ready: boolean; inert: boolean;
  visible: (boolean | null)[];
};
type BootFrame = {
  dataUrl: string; graphics: IntroGraphics; segment: string; time: number;
  opaqueRatio: number; luminanceRange: number; meanLuminance: number; maximumLuminance: number;
};
async function mockIntroAccount(page: Page) {
  // Intro geometry is independent of the backend and the published snapshot.
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { user: null } }));
}
/** Observe actual committed DOM phases, including short transitions between assertions. */
async function observeIntro(page: Page) {
  await mockIntroAccount(page);
  await page.addInitScript(() => {
    const state = window as unknown as {
      __hadesdIntroSamples: IntroSample[]; __hadesdBootFrames: Record<string, BootFrame>;
      __hadesdGraphics?: IntroGraphics;
    };
    state.__hadesdIntroSamples = [];
    state.__hadesdBootFrames = {};
    const selectors = [".terminal-session", ".terminal-identity", ".terminal-files", ".terminal-recent", ".terminal-welcome-hint", ".terminal-actions", ".terminal-input"];
    const record = () => {
      const stage = document.querySelector<HTMLElement>(".terminal-stage");
      if (!stage) return;
      state.__hadesdIntroSamples.push({
        phase: stage.dataset.introPhase!, journey: Number(stage.dataset.introProgress),
        boot: Number(stage.dataset.bootProgress), phaseProgress: Number(stage.dataset.phaseProgress),
        renderer: stage.dataset.renderer!, bootSegment: stage.dataset.bootSegment || null, time: performance.now(),
        reveal: Number(stage.dataset.revealStep), ready: stage.dataset.stageReady === "true",
        inert: !!stage.querySelector(".stage-content[inert]"),
        visible: selectors.map((selector) => {
          const element = stage.querySelector(selector);
          return element ? getComputedStyle(element).visibility === "visible" : null;
        }),
      });
      if (state.__hadesdIntroSamples.length > 2000) state.__hadesdIntroSamples.shift();
    };
    const captureFrame = (graphics: IntroGraphics) => {
      const stage = document.querySelector<HTMLElement>(".terminal-stage");
      if (!stage || graphics.introPhase !== "boot") return;
      const p = graphics.bootSequence;
      const segment = p < .07 ? "warmup" : p >= .12 && p < .33 ? "post" : p >= .6 && p < .8 ? "gui" : null;
      if (!segment || state.__hadesdBootFrames[segment]) return;
      const gpu = stage.querySelector<HTMLCanvasElement>(".stage-graphics canvas");
      if (!gpu || !gpu.width || !gpu.height) return;
      const copy = document.createElement("canvas");
      copy.width = gpu.width; copy.height = gpu.height;
      const ctx = copy.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(gpu, 0, 0);
      const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
      let opaque = 0, darkest = 765, lightest = 0, totalLuminance = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]! > 250) opaque++;
        const luminance = pixels[i]! + pixels[i + 1]! + pixels[i + 2]!;
        darkest = Math.min(darkest, luminance); lightest = Math.max(lightest, luminance);
        totalLuminance += luminance;
      }
      const opaqueRatio = opaque / (pixels.length / 4);
      const luminanceRange = lightest - darkest;
      // Capture synchronously after the committed GPU frame. The unlit tube may
      // now be entirely black: its warmup does not need a bright perimeter.
      if (opaqueRatio < .95 || (segment !== "warmup" && luminanceRange < 5)) return;
      state.__hadesdBootFrames[segment] = {
        dataUrl: copy.toDataURL("image/png"), graphics: { ...graphics }, segment, time: performance.now(), opaqueRatio, luminanceRange,
        meanLuminance: totalLuminance / (pixels.length / 4) / 3, maximumLuminance: lightest / 3,
      };
    };
    // The diagnostic write happens synchronously after pipeline.render(). It
    // is the final readable moment before WebGL discards the drawing buffer.
    // Observe those writes without changing application, renderer or clock state.
    let graphicsValue: IntroGraphics | undefined;
    Object.defineProperty(window, "__hadesdGraphics", {
      configurable: true,
      get: () => graphicsValue,
      set: (value: IntroGraphics) => {
        graphicsValue = new Proxy(value, {
          set(target, property, next) {
            Reflect.set(target, property, next);
            if (property === "bootSequence") captureFrame(target);
            return true;
          },
        });
        captureFrame(value);
      },
    });
    new MutationObserver(record).observe(document, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["data-intro-phase", "data-intro-progress", "data-boot-progress", "data-boot-segment", "data-renderer", "data-phase-progress", "data-reveal-step", "data-stage-ready", "data-terminal-reveal-step"],
    });
  });
}
async function introSamples(page: Page) {
  return page.evaluate(() => (window as unknown as { __hadesdIntroSamples: IntroSample[] }).__hadesdIntroSamples);
}
function assertCompleteIntro(samples: IntroSample[], exactRevealSteps = true) {
  const phases = samples.map((sample) => sample.phase).filter((phase, index, all) => index === 0 || phase !== all[index - 1]);
  expect(phases).toEqual(["boot", "pullback", "hero", "journey", "resume", "penetrate", "reveal", "terminal"]);
  const boot = samples.filter((sample) => sample.phase === "boot");
  expect([...new Set(boot.map(sample => sample.bootSegment))]).toEqual(["warmup", "post", "transition", "gui"]);
  expect(boot.filter(sample => sample.phaseProgress < 42).every(sample => sample.boot === 0)).toBe(true);
  const gpuStart = boot.find(sample => sample.renderer === "WebGL2" && sample.phaseProgress === 0)!;
  const pullback = samples.find(sample => sample.phase === "pullback")!;
  expect(pullback.time - gpuStart.time).toBeGreaterThanOrEqual(4950);
  expect(boot.some((sample) => sample.boot > 0)).toBe(true);
  expect(boot.every((sample) => sample.boot <= 80)).toBe(true);
  expect(samples.filter((sample) => ["pullback", "hero", "journey"].includes(sample.phase)).every((sample) => sample.boot === 80 && !sample.ready)).toBe(true);
  expect(samples.some((sample) => sample.phase === "resume" && sample.boot > 80 && sample.boot < 100 && !sample.ready)).toBe(true);
  const reveals = samples.filter((sample) => sample.phase === "reveal");
  const observed = [...new Set(reveals.map(sample => sample.reveal))];
  if (exactRevealSteps) expect(observed).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  else {
    // Reboot can cross two absolute-time thresholds in one delayed GPU frame.
    // Unit tests verify all seven thresholds; this observes real committed frames.
    expect(observed[0]).toBe(0);
    expect(observed.at(-1)).toBe(7);
    expect(observed.filter(step => step > 0 && step < 7).length).toBeGreaterThanOrEqual(2);
    expect(reveals.every((sample, index) => index === 0 || sample.reveal >= reveals[index - 1]!.reveal)).toBe(true);
  }
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
async function saveBootFrames(page: Page, label: string) {
  const frames = await page.evaluate(() => (window as unknown as { __hadesdBootFrames: Record<string, BootFrame> }).__hadesdBootFrames);
  expect(Object.keys(frames).sort()).toEqual(["gui", "post", "warmup"]);
  expect(frames.warmup!.graphics.bootSequence).toBeLessThan(.07);
  expect(frames.warmup!.graphics.phaseProgress).toBeLessThan(.07);
  expect(frames.warmup!.graphics.bootProgress).toBe(0);
  expect(frames.warmup!.opaqueRatio).toBeGreaterThan(.95);
  expect(frames.warmup!.meanLuminance).toBeLessThan(16);
  expect(frames.warmup!.maximumLuminance).toBeLessThan(100);
  expect(frames.post!.graphics.bootProgress).toBe(0);
  expect(frames.gui!.graphics.bootProgress).toBeGreaterThan(0);
  for (const [segment, frame] of Object.entries(frames)) {
    await writeFile(introShot(`${label}-${segment}.png`), Buffer.from(frame.dataUrl.split(",")[1]!, "base64"));
  }
  const metadata = Object.fromEntries(Object.entries(frames).map(([segment, { dataUrl, ...frame }]) => [segment, frame]));
  await writeFile(`.local/reports/${label}-frames.json`, JSON.stringify(metadata, null, 2));
}
async function expectFullScreenSurface(page: Page) {
  const geometry = await page.locator(".stage-content").evaluate(surface => {
    const rect = surface.getBoundingClientRect();
    const stage = surface.parentElement!.getBoundingClientRect();
    const field = surface.querySelector("#terminal-command")!.getBoundingClientRect();
    return { width: rect.width / stage.width, height: rect.height / stage.height,
      x: (rect.left - stage.left) / stage.width, y: (rect.top - stage.top) / stage.height,
      fieldInside: field.left >= rect.left && field.right <= rect.right && field.top >= rect.top && field.bottom <= rect.bottom };
  });
  expect(geometry.width).toBeCloseTo(.98, 3);
  expect(geometry.height).toBeCloseTo(.96, 3);
  expect(geometry.x).toBeCloseTo(.01, 3);
  expect(geometry.y).toBeCloseTo(.02, 3);
  expect(geometry.fieldInside).toBe(true);
}

async function wheelTravel(page: Page, pixels: number) {
  // Individual wheel notches stay small, just as the interaction now requires.
  // Acknowledging native dispatch avoids coalescing several notches into one
  // capped event when the graphics backend is slower than the test runner.
  await page.evaluate(() => {
    const state = window as unknown as { __hadesdWheelEvents?: number };
    if (state.__hadesdWheelEvents !== undefined) return;
    state.__hadesdWheelEvents = 0;
    window.addEventListener("wheel", () => state.__hadesdWheelEvents!++, { capture: true, passive: true });
  });
  let remaining = pixels;
  while (Math.abs(remaining) > 0.001) {
    const step = Math.sign(remaining) * Math.min(120, Math.abs(remaining));
    const before = await page.evaluate(() => (window as unknown as { __hadesdWheelEvents: number }).__hadesdWheelEvents);
    await page.mouse.wheel(0, step);
    await page.waitForFunction(count => (window as unknown as { __hadesdWheelEvents: number }).__hadesdWheelEvents > count, before);
    remaining -= step;
  }
}

async function travelForward(page: Page) {
  for (let i = 0; i < 9; i++) await page.keyboard.press("PageDown");
}

test("CRT warms up before DOS and GUI, then scroll resumes boot and reveals the full-screen terminal", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await observeIntro(page);
  await page.goto("/?gpu=webgl");
  const stage = page.locator(".terminal-stage");
  await expect(stage).toHaveAttribute("data-intro-phase", "boot");
  await expect(page.locator(".stage-boot-status")).toHaveCSS("clip-path", "inset(50%)");
  await expect.poll(async () => (await introGraphics(page))?.introPhase, { timeout: 35000 }).toBe("boot");
  await expectFixedViewport(page);

  await expect(stage).toHaveAttribute("data-intro-phase", "pullback", { timeout: 15000 });
  await expect(stage).toHaveAttribute("data-boot-progress", "80");
  await expect(page.locator(".stage-hero")).toHaveAttribute("inert", "");
  await expect(stage).toHaveAttribute("data-intro-phase", "hero", { timeout: 15000 });
  await saveBootFrames(page, "intro-desktop-boot");
  await expect(stage).toHaveAttribute("data-boot-progress", "80");
  await expect(page.getByRole("region", { name: "个人计算机介绍" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "让想象，接通现实。" })).toBeVisible();
  await expect(page.getByText("滚动进入这台电脑", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /进入终端|SKIP INTRO/ })).toHaveCount(0);
  await expect(page.locator(".stage-base")).toHaveCount(0);
  await expect.poll(async () => (await introGraphics(page))?.macVisible).toBe(true);
  await page.waitForTimeout(900); // Hero intentionally waits for the reader indefinitely.
  await expect(stage).toHaveAttribute("data-intro-phase", "hero");
  await expect(stage).toHaveAttribute("data-intro-progress", "0");
  await expect(stage).toHaveAttribute("data-stage-ready", "false");
  await page.screenshot({ path: introShot("intro-desktop-hero.png") });

  await page.mouse.move(980, 480);
  await wheelTravel(page, 360);
  await expect(stage).toHaveAttribute("data-intro-phase", "journey");
  await expect.poll(async () => Number(await stage.getAttribute("data-intro-progress"))).toBeGreaterThanOrEqual(5);
  expect(Number(await stage.getAttribute("data-intro-progress"))).toBeLessThan(8);
  await expectFixedViewport(page);
  // All four positions have the same DOM percentage. The physical Mac and
  // first tile must switch in the GPU frame, without a React percentage update.
  const wheelSpan = Math.max(4800, page.viewportSize()!.height * 6.6);
  let wheelTotal = 360;
  const handoff: IntroGraphics[] = [];
  for (const [index, target] of [0.2749, 0.2751, 0.2749, 0.2751].entries()) {
    const destination = target * wheelSpan;
    await wheelTravel(page, destination - wheelTotal);
    wheelTotal = destination;
    await expect.poll(async () => Math.abs((await introGraphics(page))!.journey - target)).toBeLessThan(1e-6);
    const frame = (await introGraphics(page))!;
    expect(frame.macVisible).toBe(target < 0.275);
    expect(frame.asciiTilesVisible).toBe(target >= 0.275);
    expect(Number(frame.macVisible) + Number(frame.asciiTilesVisible)).toBe(1);
    await expect(stage).toHaveAttribute("data-intro-progress", "27");
    await expect(stage).toHaveAttribute("data-intro-phase", "journey");
    handoff.push(frame);
    if (index < 2) await page.screenshot({ path: introShot(`intro-desktop-handoff-${index === 0 ? "mac" : "tile"}.png`) });
  }
  await wheelTravel(page, 0.55 * wheelSpan - wheelTotal);
  await expect.poll(async () => Number(await stage.getAttribute("data-intro-progress"))).toBeGreaterThanOrEqual(53);
  await expect.poll(async () => (await introGraphics(page))?.asciiActive).toBe(true);
  await expect.poll(async () => (await introGraphics(page))?.binaryStreamsVisible).toBe(true);
  const middle = await introGraphics(page);
  expect(middle?.visibleBinaryStreamCount).toBeGreaterThanOrEqual(3);
  expect(middle?.journey).toBeLessThan(0.7);
  await page.screenshot({ path: introShot("intro-desktop-binary-ascii.png") });
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
  await wheelTravel(page, -0.08 * wheelSpan);
  await expect.poll(async () => (await introGraphics(page))!.journey).toBeLessThan(held.journey - 0.06);
  await page.waitForTimeout(900);
  const reversed = (await introGraphics(page))!;
  expect(reversed.asciiActive).toBe(true);
  await expect(stage).toHaveAttribute("data-stage-ready", "false");
  await page.screenshot({ path: introShot("intro-desktop-ascii-reversed.png") });
  await expectFixedViewport(page);
  await wheelTravel(page, 0.08 * wheelSpan);
  await expect.poll(async () => Math.abs((await introGraphics(page))!.journey - held.journey)).toBeLessThan(0.002);
  const returned = (await introGraphics(page))!;
  expect(returned.asciiActive).toBe(true);
  await page.screenshot({ path: introShot("intro-desktop-ascii-returned.png") });
  const journeyControl = { held, still, reversed, returned };

  await travelForward(page);
  const partial = await waitForRevealingTerminal(page);
  await expect.poll(async () => (await introGraphics(page))?.introPhase).toBe("terminal");
  const terminal = await introGraphics(page);
  expect(terminal?.asciiActive).toBe(false);
  expect(terminal?.binaryStreamsVisible).toBe(false);
  expect(terminal?.macVisible).toBe(false);
  await expectFixedViewport(page);
  await expectFullScreenSurface(page);
  await run(page, "pwd");
  await expect(page.locator(".terminal-output pre").last()).toHaveText("/home/guest");
  await page.screenshot({ path: introShot("intro-desktop-terminal.png") });
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
    await saveBootFrames(page, "intro-mobile-boot");
    await expect(stage).toHaveAttribute("data-boot-progress", "80");
    await expect.poll(async () => (await introGraphics(page))?.macVisible).toBe(true);
    await expect(page.getByRole("heading", { name: "让想象，接通现实。" })).toBeVisible();
    expect(await page.evaluate(() => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName || ""))).toBe(false);
    await page.screenshot({ path: introShot("intro-mobile-hero.png") });
    await expectFixedViewport(page);
    await expectFullScreenSurface(page);
    const session = await context.newCDPSession(page);
    await touchSwipe(session, 195, 670, 380);
    await expect(stage).toHaveAttribute("data-intro-phase", "journey");
    await expect.poll(async () => Number(await stage.getAttribute("data-intro-progress"))).toBeGreaterThanOrEqual(12);
    expect(Number(await stage.getAttribute("data-intro-progress"))).toBeLessThan(18);
    await expectFixedViewport(page);
    // Reach the middle composition through several measured real touch gestures.
    const touchSpan = Math.max(1600, page.viewportSize()!.height * 2.4);
    await touchSwipe(session, 195, 670, 380);
    await touchSwipe(session, 195, 670, 670 - (0.49 * touchSpan - 580));
    await expect.poll(async () => Math.abs((await introGraphics(page))!.journey - 0.49)).toBeLessThan(0.001);
    const settled = (await introGraphics(page))!;
    await page.waitForTimeout(500);
    const middle = (await introGraphics(page))!;
    expect(middle.journey).toBeCloseTo(settled.journey, 3);
    expect(middle.asciiActive).toBe(true);
    expect(middle.binaryStreamsVisible).toBe(true);
    expect(middle.visibleBinaryStreamCount).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: introShot("intro-mobile-binary-ascii.png") });
    await expectFixedViewport(page);
    await touchSwipe(session, 195, 740, 170);
    await touchSwipe(session, 195, 740, 170);
    const partial = await waitForRevealingTerminal(page);
    await expect.poll(async () => (await introGraphics(page))?.introPhase).toBe("terminal");
    await expectFixedViewport(page);
    await expectFullScreenSurface(page);
    expect(await page.evaluate(() => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName || ""))).toBe(false);
    await page.screenshot({ path: introShot("intro-mobile-terminal.png") });
    expect(errors).toEqual([]);
    const samples = await introSamples(page);
    assertCompleteIntro(samples);
    await writeFile(".local/reports/intro-v4-1-mobile.json", JSON.stringify({ middle, partial, terminal: await introGraphics(page), samples, errors }, null, 2));
    await session.detach();
  } finally {
    await context.close();
  }
});

test("mouse, Markdown commands, tags and search append readable files while canonical pages retain copy and reader tools", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openTerminal(page);
  const posts = page.locator(".terminal-files a").filter({ hasText: "posts/" });
  await reveal(page, posts); await posts.click();
  await pathname(page, "/");
  const mouseFile = page.locator(".terminal-output .terminal-list a").filter({ hasText: articleTitle });
  await reveal(page, mouseFile); await mouseFile.click();
  await expect(page.locator(".terminal-document").last()).toContainText("让好奇心持续运行");
  await pathname(page, "/");
  await run(page, "cd ~/posts");
  await expect(page.locator(".prompt")).toContainText("~/posts");
  await run(page, "md welcome-to-hadesd.md");
  await expect(page.locator(".terminal-document")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Vim 编辑器" })).toHaveCount(0);
  await run(page, "tag 随笔");
  await expect(page.locator(".terminal-record").last()).toContainText(articleTitle);
  await run(page, 'search "欢迎"');
  const searchFile = page.locator(".terminal-record").last().locator(".terminal-list a").filter({ hasText: articleTitle });
  await reveal(page, searchFile); await page.screenshot({ path: shots + "/search.png" }); await searchFile.click();
  await expect(page.locator(".terminal-document")).toHaveCount(3);
  await pathname(page, "/");
  await run(page, "help");
  await reveal(page, page.getByText("查看命令与使用示例", { exact: true }));
  await page.screenshot({ path: shots + "/terminal-help.png" });

  // Direct links still render the complete SEO route, including reader controls.
  await openTerminal(page, article);
  const copy = page.getByRole("button", { name: "复制代码", exact: true }).first();
  await reveal(page, copy); await copy.click();
  await expect(page.getByRole("button", { name: "已复制", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("open welcome-to-hadesd.md");
  const reader = page.getByRole("button", { name: "专注阅读 ↗", exact: true });
  await reveal(page, reader); await reader.click();
  await expect(page.locator("html")).toHaveAttribute("data-reader", "true");
  await expect(page.locator(".terminal-stage")).toHaveAttribute("data-graphics", "false");
  await page.getByRole("button", { name: "退出阅读模式", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-reader", "false");
  const tag = page.getByRole("link", { name: "#随笔", exact: true });
  await reveal(page, tag); await tag.click();
  await pathname(page, "/tags/" + encodeURIComponent("随笔"));
  await page.keyboard.press("Meta+k");
  await page.getByRole("textbox", { name: "搜索页面或操作" }).fill("欢迎");
  const paletteFile = page.getByRole("region", { name: "SEARCH / 快速访问" }).getByRole("button", { name: new RegExp(articleTitle) }).first();
  await reveal(page, paletteFile); await paletteFile.click();
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
  { width: 1440, height: 900 }, { width: 1024, height: 768 },
  { width: 390, height: 844 }, { width: 320, height: 568 },
]) {
  test(`native terminal scrollback, cursor and mouse at ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }) => {
    const mobile = viewport.width < 768;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, baseURL });
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openTerminal(page);
    await expect(page.locator(".terminal-banner")).toContainText("██");
    await expect(page.locator(".terminal-session")).toContainText("TTY 01");
    await expect(page.locator("[data-terminal-cursor]")).toHaveText("█");
    await expect(page.getByRole("textbox", { name: "博客命令" })).toBeVisible();
    await expect(page.locator(".screen-pager")).toHaveCount(0);
    const geometry = await fixedGeometry(page);
    expect(geometry.overflow).toBe("hidden");
    expect(geometry.width).toBeLessThanOrEqual(viewport.width);
    expect(geometry.height).toBe(viewport.height);
    expect(geometry.terminalHeight).toBe(viewport.height);
    await page.screenshot({ path: `${shots}/terminal-home-${viewport.width}x${viewport.height}.png` });

    await openTerminal(page, longArticle);
    await pathname(page, longArticle);
    await expect(page.getByRole("heading", { name: longTitle, exact: true })).toBeVisible();
    const transcript = page.locator(".terminal-transcript");
    expect(await transcript.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    const box = await transcript.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 350);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
    const afterWheel = await scrollTop(page);
    const input = page.getByRole("textbox", { name: "博客命令" });
    await input.focus(); await input.press("PageUp");
    await expect.poll(() => scrollTop(page)).toBeLessThan(afterWheel);
    const beforeDown = await scrollTop(page);
    await input.press("PageDown");
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(beforeDown);
    await expect(input).toHaveValue("");
    expect((await fixedGeometry(page)).y).toBe(0);
    expect((await fixedGeometry(page)).width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `${shots}/article-${viewport.width}x${viewport.height}.png` });
    expect(errors).toEqual([]); await context.close();
  });
}

test("every long-article block remains reachable by native scrolling and TOC jumps to its heading", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await openTerminal(page, longArticle);
  const blocks = page.locator(".markdown h1,.markdown h2,.markdown h3,.markdown h4,.markdown p,.markdown li,.markdown pre,.markdown table,.markdown img,.markdown .katex-display");
  const total = await blocks.count(); expect(total).toBeGreaterThan(10);
  const covered = new Set<number>(), transcript = page.locator(".terminal-transcript");
  const dimensions = await transcript.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }));
  for (let i = 0; i < Math.ceil(dimensions.content / Math.max(1, dimensions.height - 44)) + 1; i++) {
    const current = await page.evaluate(() => {
      const viewport = document.querySelector(".terminal-transcript")!.getBoundingClientRect();
      return Array.from(document.querySelectorAll(".markdown h1,.markdown h2,.markdown h3,.markdown h4,.markdown p,.markdown li,.markdown pre,.markdown table,.markdown img,.markdown .katex-display"))
        .flatMap((block, index) => { const rect = block.getBoundingClientRect(), middle = rect.top + rect.height / 2;
          return rect.height > 0 && middle >= viewport.top && middle <= viewport.bottom ? [index] : []; });
    });
    current.forEach(index => covered.add(index));
    expect((await fixedGeometry(page)).y).toBe(0);
    await page.getByRole("textbox", { name: "博客命令" }).press("PageDown");
  }
  expect(covered.size, "Every rendered article block must pass through the native terminal viewport").toBe(total);
  await reveal(page, page.getByText("END OF FILE", { exact: true }));
  await page.screenshot({ path: shots + "/terminal-end-of-file.png" });
  const lastToc = page.getByRole("navigation", { name: "文章目录" }).getByRole("link").last();
  const hash = await lastToc.getAttribute("href");
  await reveal(page, lastToc); await lastToc.click();
  const heading = page.locator(`[id="${decodeURIComponent(hash!.slice(1))}"]`);
  await expect.poll(() => withinScreen(page, heading)).toBe(true);
  expect(await scrollTop(page)).toBeGreaterThan(0);
  expect((await fixedGeometry(page)).y).toBe(0);
  const widths = await page.evaluate(() => {
    const viewport = document.querySelector(".terminal-transcript") as HTMLElement;
    return Array.from(document.querySelectorAll<HTMLElement>(".md-code,.md-table,.katex-display"))
      .map(element => ({ width: element.getBoundingClientRect().width, limit: viewport.clientWidth }));
  });
  for (const value of widths) expect(value.width).toBeLessThanOrEqual(value.limit + 1);
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
  await page.evaluate(() => {
    (window as unknown as { __hadesdIntroSamples: IntroSample[] }).__hadesdIntroSamples = [];
    (window as unknown as { __hadesdBootFrames: Record<string, BootFrame> }).__hadesdBootFrames = {};
  });
  await run(page, "reboot");
  await expect(stage).toHaveAttribute("data-stage-ready", "false");
  await expect(stage).toHaveAttribute("data-intro-phase", "boot");
  await expect(stage).toHaveAttribute("data-intro-progress", "0");
  await expect(stage).toHaveAttribute("data-reveal-step", "0");
  await expect(page.locator(".stage-boot-status")).toHaveCSS("clip-path", "inset(50%)");
  await expect.poll(async () => (await introGraphics(page))?.introPhase).toBe("boot");
  await expect(stage).toHaveAttribute("data-intro-phase", "pullback", { timeout: 15000 });
  await expect(stage).toHaveAttribute("data-boot-progress", "80");
  await expect(stage).toHaveAttribute("data-intro-phase", "hero", { timeout: 15000 });
  await saveBootFrames(page, "intro-reboot-boot");
  await travelForward(page);
  await expect(stage).toHaveAttribute("data-intro-phase", "journey");
  const partial = await waitForRevealingTerminal(page);
  const samples = await introSamples(page);
  // Typing reboot updates the ordinary transcript before the requested boot.
  // Keep strict sequence/timing assertions for the boot that follows that input.
  const bootStart = samples.findIndex(sample => sample.phase === "boot");
  expect(bootStart).toBeGreaterThanOrEqual(0);
  assertCompleteIntro(samples.slice(bootStart), false);
  await run(page, "pwd");
  await expect(page.locator(".terminal-output pre").last()).toHaveText("/home/guest");
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

test("keyboard avoids hidden jumps while reduced motion makes every intro phase accessible", async ({ page }) => {
  await mockIntroAccount(page);
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
        if (phase === "journey") await page.keyboard.press("PageDown");
        else await travelForward(page);
        await expect(stage).toHaveAttribute("data-intro-phase", phase, { timeout: 15000 });
      }
    }
    await expect(stage).toHaveAttribute("data-intro-phase", phase);
    await page.keyboard.press(index % 2 === 0 ? "Enter" : "Escape");
    await expect(stage).toHaveAttribute("data-stage-ready", "false");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(stage).toHaveAttribute("data-stage-ready", "true");
    await expect(stage).toHaveAttribute("data-reveal-step", "7");
    await expect(page.locator(".stage-content")).not.toHaveAttribute("inert");
    await expect(page.locator(".terminal-input")).toHaveCSS("visibility", "visible");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
  await page.waitForTimeout(2100);
  await expect(stage).toHaveAttribute("data-intro-phase", "terminal");
  await run(page, "pwd");
  await expect(page.locator(".terminal-output pre").last()).toHaveText("/home/guest");
});

test("display preferences migrate cleanly, restore themes on reload and preserve inline keyboard controls", async ({
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
  await expect(page.getByRole("region", { name: "DISPLAY / 显示设置" })).toHaveCount(0);
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
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("region", { name: "SEARCH / 快速访问" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "搜索页面或操作" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("[data-terminal-program]")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "SEARCH / 快速访问" })).toHaveCount(0);
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
