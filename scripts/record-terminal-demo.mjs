#!/usr/bin/env node
/**
 * Record the real web terminal with public fixture data, entirely on loopback.
 * Run from any directory: node scripts/record-terminal-demo.mjs
 * Requires the existing workspace dependencies, Playwright Chromium, and
 * Python 3 with Pillow. No ffmpeg or application backend is needed.
 * Options: DEMO_PORT=18473 PYTHON=python3 DEMO_KEEP_FRAMES=1
 * The GIF uses real screenshots with edited pauses, not simulated UI output.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(root, "apps/web");
const webRequire = createRequire(join(webRoot, "package.json"));
const fixturePath = join(root, "scripts/fixtures/terminal-demo.snapshot.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const outputPath = join(root, "docs/assets/terminal-demo.gif");
const port = Number(process.env.DEMO_PORT || 18473);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535, "Invalid DEMO_PORT");
const origin = `http://127.0.0.1:${port}`;
const python = process.env.PYTHON || "python3";
execFileSync(python, ["-c", "from PIL import Image; print('Pillow ready')"], { stdio: "inherit" });

const temporary = await realpath(await mkdtemp(join(tmpdir(), "hadesd-terminal-demo-")));
const previousCwd = process.cwd();
const frames = [];
const errors = [];
const warnings = [];
const blockedRequests = [];
const apiRequests = [];
const warmupErrors = [];
let browser;
let server;

try {
  // Vite and React Router both honor this empty envDir. Never load .env,
  // production releases, browser profiles, local storage, or an API backend.
  const envDir = join(temporary, "empty-env");
  await mkdir(envDir);
  process.env.HADESD_SNAPSHOT = fixturePath;
  process.env.HADESD_BUILD_DIR = join(temporary, "build");
  process.env.SITE_ORIGIN = origin;
  process.chdir(webRoot);
  const { createServer } = await import(pathToFileURL(webRequire.resolve("vite")).href);
  const configPath = join(temporary, "vite.config.mjs");
  // The config compiler resolves packages relative to its temporary file.
  await symlink(join(webRoot, "node_modules"), join(temporary, "node_modules"), "dir");
  const config = {
    root: webRoot,
    envDir,
    cacheDir: join(temporary, "vite-cache"),
    server: { host: "127.0.0.1", port, strictPort: true, open: false, hmr: false },
    logLevel: "warn",
  };
  await writeFile(configPath, `import { reactRouter } from ${JSON.stringify(pathToFileURL(webRequire.resolve("@react-router/dev/vite")).href)};\nexport default { ...${JSON.stringify(config)}, plugins: [reactRouter()] };\n`);
  server = await createServer({ configFile: configPath });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1000, height: 760 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "dark",
    locale: "zh-CN",
    timezoneId: "UTC",
    serviceWorkers: "block",
  });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || request.method() !== "GET") {
      blockedRequests.push(`${request.method()} ${url.href}`);
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    apiRequests.push(url.pathname);
    if (url.pathname === "/api/v1/auth/session") return route.fulfill({ json: { user: null } });
    const content = fixture.contents.find(item => url.pathname === `/api/v1/public/contents/${item.id}`);
    if (content) return route.fulfill({ json: content });
    blockedRequests.push(`Unexpected fixture API: ${url.pathname}`);
    return route.abort("blockedbyclient");
  });
  await context.addInitScript(() => {
    localStorage.setItem("hadesd.display.v2", JSON.stringify({ theme: "amber", crt: "off", reader: false }));
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning") warnings.push(message.text());
  });
  // The first navigation warms a fresh, isolated dependency cache. Vite can
  // invalidate its initial module URLs during that crawl; reload before the
  // verified recording, and report these startup diagnostics separately.
  await page.goto(origin, { waitUntil: "networkidle" });
  if (errors.length && errors.every(error => error.includes("504 (Outdated Optimize Dep)"))) {
    warmupErrors.push(...errors.splice(0));
    await page.reload({ waitUntil: "networkidle" });
  }
  await expect(page).toHaveTitle(/HADESD/);
  assert.equal(new URL(page.url()).origin, origin);
  await expect(page.locator(".terminal-stage")).toHaveAttribute("data-stage-ready", "true");
  await expect(page.locator("html")).toHaveAttribute("data-crt", "off");
  await expect(page.locator(".terminal-banner")).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const input = page.getByRole("textbox", { name: "博客命令", exact: true });
  await input.focus();

  async function frame(duration, label) {
    // Wait for the real React state and browser paint before capturing it.
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const path = join(temporary, `${String(frames.length).padStart(3, "0")}.png`);
    await page.screenshot({ path, animations: "allow" });
    frames.push({ path, duration, ...(label ? { label } : {}) });
  }
  async function command(text) {
    await expect(input).toHaveValue("");
    for (const character of text) {
      await input.pressSequentially(character);
      await frame(100);
    }
    await frame(250);
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect(page.locator(".terminal-record .terminal-echo").last()).toContainText(text);
  }

  await frame(1600, "home");
  await command("help");
  await expect(page.locator(".command-help")).toContainText("open");
  await frame(1800, "help");
  // Ctrl+L is the terminal's real clear-screen shortcut.
  await input.press("Control+l");
  await expect(page.locator(".command-help")).toHaveCount(0);
  await frame(300);
  await command("ls");
  await expect(page.locator(".terminal-record").last()).toContainText("posts/");
  await frame(1200, "directories");
  await command("cd posts");
  await expect(page.locator(".terminal-input .prompt")).toContainText("~/posts");
  await frame(500);
  await command("ls");
  await expect(page.locator(".terminal-record").last()).toContainText("hello-world.md");
  await frame(1300, "posts");
  await command("open hello-world.md");
  const document = page.locator(".terminal-document").last();
  await expect(document.getByRole("heading", { name: "Hello, terminal.", exact: true })).toBeVisible();
  await expect(document).toContainText("以命令行的方式");
  await frame(3300, "markdown-top");
  await input.press("PageDown");
  await expect(document.getByRole("heading", { name: "为阅读而造", exact: true })).toBeVisible();
  await frame(2800, "markdown-bottom");

  assert.deepEqual(errors, [], "Browser errors occurred");
  assert.deepEqual(blockedRequests, [], "Unexpected network requests occurred");
  assert(apiRequests.includes("/api/v1/public/contents/demo-hello-world"), "Markdown was not read from the fixture API");
  await writeFile(join(temporary, "frames.json"), JSON.stringify(frames, null, 2));
  await mkdir(dirname(outputPath), { recursive: true });
  const result = execFileSync(python, ["-c", `
import json, os, sys
from PIL import Image, ImageSequence
directory, output = sys.argv[1:]
with open(os.path.join(directory, 'frames.json')) as source:
    manifest = json.load(source)
images = [Image.open(frame['path']).convert('RGB') for frame in manifest]
# Share one palette across the clip, retaining the original browser pixels.
atlas = Image.new('RGB', (250 * 8, 190 * ((len(images) + 7) // 8)))
for index, image in enumerate(images):
    atlas.paste(image.resize((250, 190)), ((index % 8) * 250, (index // 8) * 190))
palette = atlas.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
frames = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in images]
frames[0].save(output, save_all=True, append_images=frames[1:],
    duration=[frame['duration'] for frame in manifest], loop=0,
    optimize=True, disposal=1,
    comment=b'Real HADESD UI; public demo fixture; edited pauses; CRT off.')
with Image.open(output) as gif:
    duration = sum(frame.info.get('duration', 0) for frame in ImageSequence.Iterator(gif))
    assert 8000 <= duration <= 20000, duration
    assert gif.n_frames >= 30, gif.n_frames
    assert gif.size == (1000, 760), gif.size
    assert gif.info.get('loop') == 0
    size = os.path.getsize(output)
    assert size < 5 * 1024 * 1024, size
    print(json.dumps({'path': output, 'width': gif.width, 'height': gif.height,
        'frames': gif.n_frames, 'durationMs': duration, 'bytes': size}))
`, temporary, outputPath], { encoding: "utf8" });
  console.log(result.trim());
  const warmup = warmupErrors.length ? { message: warmupErrors[0], count: warmupErrors.length, recoveredByReload: true } : null;
  console.log(JSON.stringify({ origin, errors, warnings, warmup, apiRequests, blockedRequests, fixture: fixturePath }));
  if (process.env.DEMO_KEEP_FRAMES === "1") console.log(`Frames and evidence: ${temporary}`);
} catch (error) {
  console.error(JSON.stringify({ errors, warnings, blockedRequests, apiRequests, temporary }));
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  process.chdir(previousCwd);
  if (process.env.DEMO_KEEP_FRAMES !== "1") await rm(temporary, { recursive: true, force: true });
}
