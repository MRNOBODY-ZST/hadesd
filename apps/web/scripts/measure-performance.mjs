import { chromium } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const origin = new URL(process.env.PERFORMANCE_BASE_URL || "http://127.0.0.1:18088").origin;
const reportPath = path.join(root, ".local/reports/performance.json");
const jsFiles = new Map(), contexts = [];
const browser = await chromium.launch();
const report = {
  architecture: "terminal-v4.1 / eight-stage boot + 5x16 opaque cylindrical ASCII Mac face tiles + system CRT + Three.js + React Three Fiber + WebGPURenderer + TSL",
  introPhases: ["boot", "pullback", "hero", "journey", "resume", "penetrate", "reveal", "terminal"],
  measuredAt: new Date().toISOString(), origin, browser: browser.version(),
  method: "Cold independent contexts record requested JavaScript response bodies, each gzipSync-compressed offline. Core is a saved CRT Off visit; GPU additional is the default Full visit minus core. Full/Low/Off terminal samples skip the intro after renderer initialization. A separate Full context reaches hero normally, advances via two real wheel events, and samples a settled journey at 50%; only that context owns an active GPU scene during its sample. Frames are actual __hadesdGraphics.frames increments after pipeline.render(), not WebGL draw calls or RAF callbacks.",
  limitations: [
    "Headless ANGLE/SwiftShader is software rendering; no physical GPU, mobile power or thermal performance claim.",
    "Other task-owned validation/recording browsers were closed before sampling. User-owned browsers may remain open; this is not a machine-exclusive or hardware-isolated benchmark.",
    "One pipeline frame performs several scene/bloom GPU draws. Pipeline frames, GPU draw calls and RAF callbacks are distinct.",
    "The system-wide CSS CRT sweep is outside the Three frame counter and JavaScript RAF instrumentation; this is not a compositor/paint profile.",
    "The two primary render targets are the terminal copy and scene pass; bloom allocates additional internal blur targets.",
    "Compression estimates exclude CSS, fonts and images. No production network or Core Web Vitals claim.",
    "Input/paging completion is an automation observation, not a calibrated input latency benchmark.",
    "The separate journey sample holds one scroll position; it does not measure moving-scroll frame pacing, other intro phases, GPU execution time, or a worst-case journey position.",
    "Journey panel topology is source-derived: 5 columns x 16 panels x 50 x 50 subdivisions = 400000 indexed triangles before clipping and face/depth rejection. It is not a GPU counter, visible-pixel count, or the total scene geometry.",
  ],
};
async function context(options = {}, preference) {
  const result = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference", ...options });
  contexts.push(result);
  if (preference) await result.addInitScript((crt) => localStorage.setItem("hadesd.display.v2", JSON.stringify({ theme: "amber", crt, reader: false })), preference);
  await result.addInitScript(() => {
    const state = { rafScheduled: 0, rafCallbacks: 0, pending: new Set(), frameTimes: [], surfaces: new Map(), started: performance.now() };
    window.__hadesdPerformance = state;
    const raf = requestAnimationFrame.bind(window), cancel = cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      state.rafScheduled++;
      let id;
      id = raf((time) => { state.pending.delete(id); state.rafCallbacks++; callback(time); });
      state.pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => { state.pending.delete(id); cancel(id); };
    let graphics;
    Object.defineProperty(window, "__hadesdGraphics", {
      configurable: true, get: () => graphics,
      set(value) {
        graphics = value;
        if (!value) return;
        let frames = value.frames;
        Object.defineProperty(value, "frames", {
          configurable: true, enumerable: true, get: () => frames,
          set(next) { if (next > frames) state.frameTimes.push(performance.now()); frames = next; },
        });
      },
    });
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      const canvas = this.canvas;
      // One full detached-canvas clear precedes each actual terminal text capture.
      // Sampling matches texture dimensions and excludes unrelated craft atlases.
      if (canvas instanceof HTMLCanvasElement && !canvas.isConnected && args[0] === 0 && args[1] === 0 && args[2] > 100 && args[3] > 100) {
        const times = state.surfaces.get(canvas) || [];
        times.push(performance.now()); state.surfaces.set(canvas, times);
      }
      return Reflect.apply(fillRect, this, args);
    };
  });
  return result;
}
function scripts(page) {
  const pending = [], observed = new Set();
  page.on("response", (response) => {
    if (response.request().resourceType() !== "script" || response.status() !== 200 || new URL(response.url()).origin !== origin) return;
    const pathname = new URL(response.url()).pathname;
    observed.add(pathname);
    pending.push((async () => {
      const body = await response.body();
      jsFiles.set(pathname, { path: pathname, rawBytes: body.length, gzipBytes: gzipSync(body).length, contentEncoding: response.headers()["content-encoding"] || "identity" });
    })());
  });
  return { async take() { await page.waitForLoadState("networkidle"); await Promise.all(pending); return [...observed].sort(); } };
}
function summarize(paths) {
  const files = paths.map((p) => jsFiles.get(p));
  return { files, rawBytes: files.reduce((sum, file) => sum + file.rawBytes, 0), gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0) };
}
async function release(page) {
  const response = await page.request.get(origin + "/release.json");
  return response.ok() ? response.json() : { status: response.status() };
}
async function ready(page) {
  const stage = page.locator(".terminal-stage");
  await page.waitForFunction(() => /^(WebGPU|WebGL2|DOM)$/.test(document.querySelector(".terminal-stage")?.getAttribute("data-renderer") || ""), null, { timeout: 40000 });
  if (await stage.getAttribute("data-stage-ready") !== "true") {
    await page.getByRole("button", { name: "跳过片头，进入终端", exact: true }).click();
  }
  await page.locator('.terminal-stage[data-stage-ready="true"]').waitFor({ timeout: 40000 });
  await page.waitForFunction(() => document.querySelector(".terminal-stage")?.getAttribute("data-renderer") === "DOM" || window.__hadesdGraphics?.introPhase === "terminal", null, { timeout: 10000 });
  await page.waitForLoadState("networkidle");
}
async function chooseCrt(page, name) {
  await page.getByRole("button", { name: "显示设置", exact: true }).click();
  await page.getByRole("group", { name: "CRT 氛围", exact: true }).getByRole("button", { name, exact: true }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
}
async function run(page, command) {
  const field = page.getByRole("textbox", { name: "博客命令" });
  await field.fill(command); await field.press("Enter");
}
async function sample(page, durationMs) {
  await page.evaluate(() => {
    const s = window.__hadesdPerformance;
    s.rafScheduled = 0; s.rafCallbacks = 0; s.frameTimes = []; s.started = performance.now();
  });
  // Bounded observation: measurement itself schedules neither RAF nor polling.
  await page.waitForTimeout(durationMs);
  return page.evaluate(() => {
    const s = window.__hadesdPerformance, stats = window.__hadesdGraphics;
    const elapsedMs = performance.now() - s.started, times = s.frameTimes;
    let start = 0, maxFramesInOneSecond = 0;
    for (let i = 0; i < times.length; i++) {
      while (times[i] - times[start] >= 1000) start++;
      maxFramesInOneSecond = Math.max(maxFramesInOneSecond, i - start + 1);
    }
    const surface = [...s.surfaces].find(([canvas]) => canvas.width === stats?.textureWidth && canvas.height === stats?.textureHeight);
    const glass = document.querySelector(".system-crt-glass");
    return {
      elapsedMs, pipelineFrames: times.length, averagePipelineFps: times.length / elapsedMs * 1000,
      maxFramesInOneSecond, frameOffsetsMs: times.map((time) => time - s.started),
      rafScheduled: s.rafScheduled, rafCallbacks: s.rafCallbacks, pendingRaf: s.pending.size,
      textSurfaceRepaints: surface ? surface[1].filter((time) => time >= s.started).length : 0,
      canvasCount: document.querySelectorAll(".stage-graphics canvas").length,
      systemGlass: glass ? { display: getComputedStyle(glass).display, opacity: getComputedStyle(glass).opacity, sweepAnimation: getComputedStyle(glass, "::after").animationName } : null,
      documentVisible: !document.hidden, stats: stats ? { ...stats } : null,
    };
  });
}
async function captureState(page) {
  return page.evaluate(() => {
    const stats = window.__hadesdGraphics, s = window.__hadesdPerformance;
    const surface = [...s.surfaces].find(([canvas]) => canvas.width === stats?.textureWidth && canvas.height === stats?.textureHeight);
    return { at: performance.now(), repaints: surface?.[1].length || 0, latestRepaintAt: surface?.[1].at(-1) || 0, frames: stats?.frames || 0, page: Number(document.querySelector(".screen-pager")?.getAttribute("data-page")), pages: Number(document.querySelector(".screen-pager")?.getAttribute("data-pages")) };
  });
}
async function observeCaptureChange(page, action) {
  const before = await captureState(page);
  await action();
  await page.waitForFunction((previous) => {
    const stats = window.__hadesdGraphics, s = window.__hadesdPerformance;
    const surface = [...s.surfaces].find(([canvas]) => canvas.width === stats?.textureWidth && canvas.height === stats?.textureHeight);
    return (surface?.[1].length || 0) > previous.repaints && (stats?.frames || 0) > previous.frames;
  }, before, { timeout: 10000, polling: 30 });
  const after = await captureState(page);
  return { before, after, repaints: after.repaints - before.repaints, pipelineFrames: after.frames - before.frames, observedCompletionMs: after.at - before.at, latestCaptureMs: after.latestRepaintAt - before.at };
}
async function journeyState(page) {
  return page.evaluate(() => ({
    graphics: window.__hadesdGraphics ? { ...window.__hadesdGraphics } : null,
    phase: document.querySelector(".terminal-stage")?.getAttribute("data-intro-phase"),
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, scrollY },
  }));
}
async function sampleJourney(page) {
  await page.goto(origin + "/?gpu=webgl");
  await page.waitForFunction(() => window.__hadesdGraphics?.backend === "WebGL2" && document.querySelector(".terminal-stage")?.getAttribute("data-intro-phase") === "hero", null, { timeout: 40000 });
  const delta = await page.evaluate(() => Math.max(1200, innerHeight * 2.1) * .25);
  // Separate the events so the per-wheel 45% clamp cannot merge them into 45%.
  for (const destination of [.25, .5]) {
    await page.mouse.wheel(0, delta);
    await page.waitForFunction((target) => Math.abs((window.__hadesdGraphics?.journey ?? -1) - target) < .002, destination, { timeout: 10000 });
  }
  await page.waitForTimeout(800);
  const before = await journeyState(page);
  const measured = await sample(page, 5000);
  const after = await journeyState(page);
  const validPosition = (state) => state.phase === "journey" && state.graphics?.backend === "WebGL2" && Math.abs(state.graphics.journey - .5) < .002 && state.graphics.asciiActive === true;
  return {
    method: "Full mode, independent 1440x900 context, real wheel input to 50%, 800ms settling then a 5s hold. The scroll position stays fixed; blink/CRT and the normal frame pipeline remain active.",
    topology: { source: "apps/web/app/effects/three/AsciiCarousel.tsx", columns: 5, panelsPerColumn: 16, subdivisionsX: 50, subdivisionsY: 50, panelTrianglesBeforeCulling: 400000, basis: "Source-derived topology, not GPU query results; hardware and postprocessing are additional." },
    before, ...measured, after,
    validSample: validPosition(before) && validPosition(after) && measured.pipelineFrames > 0,
  };
}
try {
  await mkdir(path.dirname(reportPath), { recursive: true });
  try {
    const previous = JSON.parse(await readFile(reportPath, "utf8"));
    if (!previous.architecture) await copyFile(reportPath, path.join(root, ".local/reports/terminal-v1-performance.json"));
    else if (previous.architecture.startsWith("terminal-v2")) await copyFile(reportPath, path.join(root, ".local/reports/terminal-v2-performance.json"));
    else if (previous.architecture.startsWith("terminal-v3")) await copyFile(reportPath, path.join(root, ".local/reports/terminal-v3-performance.json"));
    else if (previous.architecture.startsWith("terminal-v4 /")) await copyFile(reportPath, path.join(root, ".local/reports/terminal-v4-performance.json"));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const baseline = await (await context({}, "off")).newPage(), baselineScripts = scripts(baseline);
  const baselineErrors = []; baseline.on("pageerror", (error) => baselineErrors.push(error.message));
  const baselineResponse = await baseline.goto(origin + "/");
  await ready(baseline);
  const corePaths = await baselineScripts.take(), html = await baselineResponse.body();
  report.releaseAtHome = await release(baseline);
  report.home = { coreOff: summarize(corePaths), html: { rawBytes: html.length, gzipBytes: gzipSync(html).length }, viewport: { width: 1440, height: 900 }, devicePixelRatio: await baseline.evaluate(() => devicePixelRatio) };
  report.coldOff = await sample(baseline, 1500);
  await run(baseline, "open /posts/time-and-backpressure.md");
  await baseline.waitForURL((url) => url.pathname.replace(/\/$/, "") === "/posts/time-and-backpressure");
  await baseline.locator("article .markdown").waitFor();
  const readerPaths = await baselineScripts.take();
  report.reader = { route: "/posts/time-and-backpressure", additional: summarize(readerPaths.filter((p) => !corePaths.includes(p))) };
  const page = await (await context()).newPage(), desktopScripts = scripts(page);
  const desktopErrors = []; page.on("pageerror", (error) => desktopErrors.push(error.message));
  await page.goto(origin + "/?gpu=webgl");
  await ready(page);
  const fullPaths = await desktopScripts.take();
  report.home.defaultFull = summarize(fullPaths);
  report.home.gpuAdditional = summarize(fullPaths.filter((p) => !corePaths.includes(p)));
  report.webgl = await page.evaluate(() => {
    const canvas = document.querySelector(".stage-graphics canvas"), gl = canvas?.getContext("webgl2");
    if (!gl) return { available: false, stats: window.__hadesdGraphics };
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      available: true, renderer: gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
      vendor: gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
      bufferWidth: canvas.width, bufferHeight: canvas.height, bufferPixels: canvas.width * canvas.height,
      isContextLost: gl.isContextLost(), stats: { ...window.__hadesdGraphics },
    };
  });
  report.full = await sample(page, 5000);
  await chooseCrt(page, "轻微");
  report.low = await sample(page, 4500);
  report.captureInput = await observeCaptureChange(page, () => page.getByRole("textbox", { name: "博客命令" }).fill("cat README.md 中文"));
  await run(page, "open /posts/time-and-backpressure.md");
  await page.waitForURL((url) => url.pathname.replace(/\/$/, "") === "/posts/time-and-backpressure");
  await page.locator("article .markdown").waitFor();
  await page.waitForTimeout(800);
  report.capturePaging = await observeCaptureChange(page, () => page.getByRole("button", { name: "下一屏", exact: true }).click());
  report.geometry = await page.evaluate(() => ({ documentHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, scrollY, viewport: document.querySelector(".screen-viewport")?.getBoundingClientRect().toJSON() }));
  await chooseCrt(page, "关闭");
  report.off = await sample(page, 2500);
  const mobile = await (await context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, "off")).newPage(), mobileScripts = scripts(mobile);
  await mobile.goto(origin + "/"); await ready(mobile);
  report.mobileOff = {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...(await sample(mobile, 1800)),
    scripts: summarize(await mobileScripts.take()),
    inputAutoFocused: await mobile.evaluate(() => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName || "")),
    horizontalOverflow: await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    verticalOverflow: await mobile.evaluate(() => document.documentElement.scrollHeight > innerHeight),
  };
  // Existing public contexts are all Off before this one starts; close it before
  // visiting the admin page so neither another GPU scene nor its CSS competes.
  const journeyPage = await (await context()).newPage(), journeyErrors = [];
  journeyPage.on("pageerror", (error) => journeyErrors.push(error.message));
  report.journeyHold = await sampleJourney(journeyPage);
  await journeyPage.close();
  if (!report.journeyHold.validSample) throw new Error("Journey performance sample did not remain on the WebGL2 ASCII scene at 50%.");
  const admin = await (await context()).newPage(), adminScripts = scripts(admin);
  await admin.goto(origin + "/admin/");
  await admin.getByRole("heading", { name: "回到写作台", exact: true }).waitFor();
  report.adminLogin = summarize(await adminScripts.take());
  report.releaseAtEnd = await release(page);
  report.errors = { baseline: baselineErrors, desktop: desktopErrors, journey: journeyErrors };
  try {
    const webgpuArtifact = process.env.PERFORMANCE_WEBGPU_REPORT || ".local/reports/terminal-v4-1/webgpu-result.json";
    report.independentWebgpuValidation = {
      artifact: webgpuArtifact,
      measuredBy: "Separate renderer integration check; not the timed WebGL2 performance sample above.",
      adapter: "Chromium WebGPU API with SwiftShader software adapter; not physical hardware.",
      ...JSON.parse(await readFile(path.resolve(root, webgpuArtifact), "utf8")),
    };
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  report.budgetComparison = {
    legacyWholeHomeGzipBudgetBytes: 300 * 1024, coreOffGzipBytes: report.home.coreOff.gzipBytes,
    gpuAdditionalGzipBytes: report.home.gpuAdditional.gzipBytes, defaultFullGzipBytes: report.home.defaultFull.gzipBytes,
    defaultFullExceedsLegacyBudget: report.home.defaultFull.gzipBytes > 300 * 1024,
    interpretation: "The richer real 3D/TSL terminal replaces the overlay. Report the complete default download explicitly; core-only compliance does not imply default Full meets the old 300 KiB budget.",
  };
  report.checks = {
    stableRelease: report.releaseAtHome.releaseId === report.releaseAtEnd.releaseId,
    coreHasNoGpuScene: corePaths.every((p) => !/TerminalScene|three\.webgpu/.test(p)),
    fullDownloadsGpuAdditional: report.home.gpuAdditional.files.length > 0,
    publicHasNoAdminCode: fullPaths.every((p) => !p.startsWith("/admin/")),
    readerLoadsAdditionalCode: report.reader.additional.files.length > 0,
    genuineWebgl2AndTextTarget: report.webgl.stats?.backend === "WebGL2" && report.webgl.stats?.textTexture === true && report.webgl.stats?.renderTargets === 2,
    fullDrawsWithin30Fps: report.full.pipelineFrames > 0 && report.full.averagePipelineFps <= 30 && report.full.maxFramesInOneSecond <= 30,
    lowDemandApproximately2Fps: report.low.pipelineFrames > 0 && report.low.averagePipelineFps <= 2.5 && report.low.maxFramesInOneSecond <= 3 && report.low.systemGlass?.sweepAnimation === "none",
    idleDoesNotRecaptureText: report.low.textSurfaceRepaints === 0 && report.full.textSurfaceRepaints === 0,
    inputTriggersCaptureAndRender: report.captureInput.repaints > 0 && report.captureInput.pipelineFrames > 0,
    pagingTriggersCaptureAndRender: report.capturePaging.repaints > 0 && report.capturePaging.pipelineFrames > 0 && report.capturePaging.after.page === report.capturePaging.before.page + 1,
    offHasNoCanvasOrFrames: report.off.canvasCount === 0 && report.off.pipelineFrames === 0 && report.off.rafCallbacks === 0 && report.off.systemGlass?.display === "none",
    coldOffSkipsGraphics: report.coldOff.canvasCount === 0 && report.coldOff.pipelineFrames === 0 && report.coldOff.systemGlass?.display === "none",
    mobileOffSkipsGraphics: report.mobileOff.canvasCount === 0 && report.mobileOff.pipelineFrames === 0 && report.mobileOff.rafCallbacks === 0 && report.mobileOff.systemGlass?.display === "none",
    noDocumentScrolling: report.geometry.documentHeight <= report.geometry.viewportHeight && report.geometry.documentWidth <= report.geometry.viewportWidth && report.geometry.scrollY === 0,
    noPageErrors: baselineErrors.length === 0 && desktopErrors.length === 0 && journeyErrors.length === 0,
  };
  if (Object.values(report.checks).some((pass) => !pass)) process.exitCode = 1;
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ report: reportPath, checks: report.checks, budgetComparison: report.budgetComparison, full: report.full && { ...report.full, frameOffsetsMs: undefined }, low: report.low && { ...report.low, frameOffsetsMs: undefined }, off: report.off, journeyHold: report.journeyHold && { ...report.journeyHold, frameOffsetsMs: undefined }, captureInput: report.captureInput, capturePaging: report.capturePaging, failure: report.failure }, null, 2));
  for (const entry of contexts) await entry.close();
  await browser.close();
}
