#!/usr/bin/env node
/** Isolated visual regression check: fixture API only, no .env or real backend.
 * node apps/web/scripts/check-terminal-legibility.mjs [--baseline]
 * Screenshots/metrics: .local/reports/terminal-legibility/{before,after}/
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const webRoot = join(root, "apps/web"), requireWeb = createRequire(join(webRoot, "package.json"));
const fixturePath = join(root, "scripts/fixtures/terminal-demo.snapshot.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const baseline = process.argv.includes("--baseline");
const output = join(root, ".local/reports/terminal-legibility", baseline ? "before" : "after");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "hadesd-legibility-")));
const origin = "http://127.0.0.1:18474";
const results = [], blockedRequests = [];
const previousCwd = process.cwd();
let server, browser;

try {
  await mkdir(output, { recursive: true });
  const envDir = join(temporary, "empty-env");
  await mkdir(envDir);
  process.env.HADESD_SNAPSHOT = fixturePath;
  process.env.HADESD_BUILD_DIR = join(temporary, "build");
  process.env.SITE_ORIGIN = origin;
  process.chdir(webRoot);
  const { createServer } = await import(pathToFileURL(requireWeb.resolve("vite")).href);
  await symlink(join(webRoot, "node_modules"), join(temporary, "node_modules"), "dir");
  const configPath = join(temporary, "vite.config.mjs");
  const config = {
    root: webRoot, envDir, cacheDir: join(temporary, "vite-cache"),
    resolve: { dedupe: ["react", "react-dom", "three"] },
    optimizeDeps: { include: ["@react-three/fiber", "three/webgpu", "three/tsl", "three/addons/tsl/display/BloomNode.js", "three/addons/geometries/RoundedBoxGeometry.js"] },
    server: { host: "127.0.0.1", port: 18474, strictPort: true, open: false, hmr: false },
    logLevel: "warn",
  };
  await writeFile(configPath, `import { reactRouter } from ${JSON.stringify(pathToFileURL(requireWeb.resolve("@react-router/dev/vite")).href)};\nexport default { ...${JSON.stringify(config)}, plugins: [reactRouter()] };\n`);
  server = await createServer({ configFile: configPath });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const device of [
    { name: "desktop", viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
    { name: "mobile", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ]) {
    for (const crt of ["off", "full"]) {
      const { name, ...options } = device;
      const context = await browser.newContext({ ...options, reducedMotion: "reduce", serviceWorkers: "block", locale: "zh-CN", timezoneId: "UTC" });
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin || request.method() !== "GET") {
          blockedRequests.push(`${request.method()} ${url.href}`);
          return route.abort("blockedbyclient");
        }
        if (!url.pathname.startsWith("/api/")) return route.continue();
        if (url.pathname === "/api/v1/auth/session") return route.fulfill({ json: { user: null } });
        const content = fixture.contents.find(item => url.pathname === `/api/v1/public/contents/${item.id}`);
        if (content) return route.fulfill({ json: content });
        blockedRequests.push(`Unexpected fixture API: ${url.pathname}`);
        return route.abort("blockedbyclient");
      });
      await context.addInitScript(level => {
        localStorage.setItem("hadesd.display.v2", JSON.stringify({ theme: "amber", crt: level, reader: false }));
      }, crt);
      const page = await context.newPage(), errors = [], warnings = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => {
        if (message.type() === "error") errors.push(message.text());
        if (message.type() === "warning") warnings.push(message.text());
      });
      await page.goto(`${origin}/?gpu=webgl`, { waitUntil: "networkidle" });
      if (errors.length && errors.every(error => error.includes("504 (Outdated Optimize Dep)"))) {
        errors.length = 0;
        await page.reload({ waitUntil: "networkidle" });
      }
      const stage = page.locator(".terminal-stage");
      await expect(stage).toHaveAttribute("data-stage-ready", "true");
      await expect(stage).toHaveAttribute("data-renderer", crt === "off" ? "DOM" : "WebGL2", { timeout: 20000 });
      await page.evaluate(() => document.fonts.ready);
      // Wait for capture, upload and GPU composition after font/layout changes.
      const settle = () => page.evaluate(() => new Promise(done => {
        let left = 5; const tick = () => --left ? requestAnimationFrame(tick) : done(); requestAnimationFrame(tick);
      }));
      await settle();
      const metrics = await page.locator(".terminal-banner").evaluate(element => {
        const style = getComputedStyle(element), node = element.firstChild, range = document.createRange();
        let offset = 0;
        const rows = element.textContent.split("\n").map(line => {
          range.setStart(node, offset); range.setEnd(node, offset + line.length); offset += line.length + 1;
          const rect = range.getBoundingClientRect();
          return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, fragments: range.getClientRects().length };
        });
        const ctx = document.createElement("canvas").getContext("2d"); ctx.font = style.font;
        return {
          fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), fontFamily: style.fontFamily,
          whiteSpace: style.whiteSpace, availableWidth: element.clientWidth,
          widths: ["█", "║", "═", " ", "M"].map(glyph => ctx.measureText(glyph).width), rows,
        };
      });
      if (!baseline) {
        assert.equal(metrics.rows.length, 6);
        assert.equal(metrics.whiteSpace, "pre");
        assert(Math.abs(metrics.lineHeight - metrics.fontSize) < .02, "ASCII row advance must equal its font size");
        assert(Math.max(...metrics.widths) - Math.min(...metrics.widths) < .02, "ASCII blocks, box drawing and spaces must share cell widths");
        for (let row = 0; row < metrics.rows.length; row++) {
          assert.equal(metrics.rows[row].fragments, 1, "ASCII rows must not wrap");
          assert(metrics.rows[row].width <= metrics.availableWidth, "ASCII must fit the mobile viewport");
          if (row) assert(Math.abs(metrics.rows[row].top - metrics.rows[row - 1].top - metrics.lineHeight) < .04, "ASCII rows must remain contiguous");
        }
      }
      await page.screenshot({ path: join(output, `${name}-${crt}-home.png`) });
      const banner = await page.locator(".terminal-banner").boundingBox();
      // Crop the composed page, not a DOM-only clone, so CRT text is verified too.
      const bannerPng = await page.screenshot({ path: join(output, `${name}-${crt}-banner.png`), clip: { x: banner.x, y: banner.y - 2, width: banner.width, height: banner.height + 4 } });
      const ink = await page.evaluate(async data => {
        const image = new Image(); image.src = data; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let colored = 0, fringed = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const [r, g, b] = pixels.slice(i, i + 3);
          if (Math.max(r, g, b) < 40 || Math.max(r, g, b) - Math.min(r, g, b) < 12) continue;
          colored++;
          // Amber ink has R/G near 1.26. A red-only or green-leading edge is
          // channel separation, not the intended gold phosphor/gray antialiasing.
          if (g > r * 1.12 || r > g * 1.65) fringed++;
        }
        return { colored, fringed, fringeRatio: fringed / Math.max(1, colored) };
      }, `data:image/png;base64,${bannerPng.toString("base64")}`);
      if (!baseline) {
        assert(ink.colored > 1000, "The composed banner must contain visible ink");
        assert(ink.fringeRatio < .01, "CRT must preserve amber glyph edges without red/green ghosting");
      }
      const input = page.getByRole("textbox", { name: "博客命令", exact: true });
      await input.fill("open /posts/hello-world.md"); await input.press("Enter");
      await expect(page.locator(".terminal-document")).toContainText("Hello, terminal.");
      await expect(input).toHaveValue("");
      await settle();
      await page.screenshot({ path: join(output, `${name}-${crt}-article.png`) });
      assert.deepEqual(errors, [], "Browser must not report rendering errors");
      results.push({ device: name, crt, metrics, ink, graphics: await page.evaluate(() => window.__hadesdGraphics ?? null), errors, warnings });
      await context.close();
    }
  }
  assert.deepEqual(blockedRequests, [], "Only fixture data and local frontend assets may be accessed");
  await writeFile(join(output, "results.json"), JSON.stringify({ fixture: fixturePath, origin, baseline, blockedRequests, results }, null, 2));
  console.log(JSON.stringify({ output, checked: results.map(({ device, crt, metrics, ink, graphics, errors }) => ({ device, crt, fontSize: metrics.fontSize, lineHeight: metrics.lineHeight, renderer: graphics?.backend ?? "DOM", fringeRatio: ink.fringeRatio, errors })), blockedRequests }));
} finally {
  await browser?.close(); await server?.close(); process.chdir(previousCwd);
  await rm(temporary, { recursive: true, force: true });
}
