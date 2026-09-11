import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
// This public measurement deliberately does not read .env or credentials.
const output = path.resolve(process.env.PERFORMANCE_OUTPUT_DIR || path.join(homedir(), '.codex/visualizations/hadesd-performance'));
const reportPath = path.resolve(process.env.PERFORMANCE_REPORT || path.join(output, 'performance.json'));
const origin = new URL(process.env.PERFORMANCE_BASE_URL || 'http://127.0.0.1:18088').origin;
const sampleMs = Math.max(1000, Number(process.env.PERFORMANCE_SAMPLE_MS) || 4000);
const channel = process.env.PERFORMANCE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
const headless = process.env.PERFORMANCE_HEADLESS !== 'false';
await mkdir(output, {
  recursive: true
});
const browser = await chromium.launch({
  channel,
  headless
});
const system = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
const result = {
  measuredAt: new Date().toISOString(),
  origin,
  browser: browser.version(),
  channel: channel || 'bundled-chromium',
  headless,
  browserPath: 'Regular Playwright; Browser plugin not available',
  gpu: {
    devices: system.gpu.devices,
    renderer: system.gpu.auxAttributes?.glRenderer,
    displayType: system.gpu.auxAttributes?.displayType,
    featureStatus: system.gpu.featureStatus
  },
  method: 'Sequential fresh contexts with real wheel input, independent desktop/mobile, reduced-motion, CRT Off/Low and unavailable-GPU states. Frames are submitted pipeline frames; WebGL draw calls and triangle primitives are counted separately. The open command is validated as an in-terminal Vim buffer, not an article route.',
  limitations: ['Headless RAF scheduling is not physical display refresh. Mobile emulation does not measure phone GPU, power or heat. Other applications may share hardware.', 'CPU render duration measures JavaScript submission, not GPU execution time or utilization. Capture RAF duration includes DOM/layout/Canvas2D paint and its update notification.', 'WebGL counts include instanced triangle submissions. WebGPU uses renderer.info counters when exposed, never a source-derived topology estimate.', 'GPU execution time, compositor/CSS CRT cost and GPU utilization are not measured. Maximizing utilization is not the objective.', 'Instrumentation adds overhead. Concurrent Vite HMR invalidates stable before/after timing. No production bundle budget or Core Web Vitals claim is made from this dev-server run.'],
  samples: [],
  checks: [],
  errors: []
};
const variants = [{
  name: 'desktop-full',
  width: 1440,
  height: 900,
  mode: 'full',
  motion: 'no-preference',
  interaction: true
}, {
  name: 'desktop-webgl',
  width: 1440,
  height: 900,
  mode: 'full',
  motion: 'no-preference',
  webgl: true
}, {
  name: 'mobile-full',
  width: 390,
  height: 844,
  mode: 'full',
  motion: 'no-preference'
}, {
  name: 'desktop-low',
  width: 1440,
  height: 900,
  mode: 'low',
  motion: 'no-preference',
  interaction: true
}, {
  name: 'desktop-reduced',
  width: 1440,
  height: 900,
  mode: 'full',
  motion: 'reduce'
}, {
  name: 'desktop-off',
  width: 1440,
  height: 900,
  mode: 'off',
  motion: 'no-preference'
}, {
  name: 'mobile-off',
  width: 390,
  height: 844,
  mode: 'off',
  motion: 'no-preference'
}, {
  name: 'gpu-unavailable',
  width: 1440,
  height: 900,
  mode: 'full',
  motion: 'no-preference',
  disableGpu: true
}];
const selected = process.env.PERFORMANCE_SCENARIOS?.split(',');
if (selected?.some(name => !variants.some(variant => variant.name === name))) {
  await browser.close();
  throw new Error('PERFORMANCE_SCENARIOS contains an unknown scenario.');
}
for (const variant of variants.filter(v => !selected || selected.includes(v.name))) {
  const context = await browser.newContext({
    viewport: {
      width: variant.width,
      height: variant.height
    },
    deviceScaleFactor: variant.width < 500 ? 2 : 1,
    isMobile: variant.width < 500,
    hasTouch: variant.width < 500,
    reducedMotion: variant.motion
  });
  await context.addInitScript(({
    mode,
    disableGpu
  }) => {
    localStorage.setItem('hadesd.display.v2', JSON.stringify({
      theme: 'amber',
      crt: mode,
      reader: false
    }));
    const state = window.__perf = {
      frames: [],
      renderStats: [],
      calls: 0,
      triangles: 0,
      raf: 0,
      captures: [],
      current: null,
      longTasks: [],
      adapters: [],
      imageUploads: [],
      uploadCounterSupported: typeof globalThis.GPUQueue?.prototype.copyExternalImageToTexture === 'function'
    };
    if (state.uploadCounterSupported) {
      const copy = GPUQueue.prototype.copyExternalImageToTexture;
      GPUQueue.prototype.copyExternalImageToTexture = function (...args) {
        const source = args[0]?.source;
        state.imageUploads.push({ width: source?.width ?? null, height: source?.height ?? null, kind: source?.constructor?.name ?? 'unknown' });
        return Reflect.apply(copy, this, args);
      };
    }
    if (navigator.gpu && !disableGpu) {
      const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
      navigator.gpu.requestAdapter = async options => {
        const adapter = await requestAdapter(options);
        const info = adapter?.info;
        state.adapters.push({
          powerPreference: options?.powerPreference ?? 'default',
          available: !!adapter,
          vendor: info?.vendor ?? null,
          architecture: info?.architecture ?? null,
          device: info?.device ?? null,
          description: info?.description ?? null,
          isFallbackAdapter: info?.isFallbackAdapter ?? adapter?.isFallbackAdapter ?? null
        });
        return adapter;
      };
    }
    let graphics;
    Object.defineProperty(window, '__hadesdGraphics', {
      configurable: true,
      get: () => graphics,
      set(value) {
        graphics = value;
        if (!value) return;
        let count = value.frames;
        Object.defineProperty(value, 'frames', {
          configurable: true,
          enumerable: true,
          get: () => count,
          set(next) {
            if (next > count) {
              state.frames.push(performance.now());
              state.renderStats.push({
                drawCalls: value.drawCalls,
                triangles: value.triangles,
                renderCpuMs: value.renderCpuMs
              });
            }
            count = next;
          }
        });
      }
    });
    const raf = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(t => {
      state.raf++;
      const before = performance.now();
      const marker = {
        canvas: null
      };
      state.current = marker;
      try {
        cb(t);
      } finally {
        if (marker.canvas) state.captures.push({
          at: before,
          ms: performance.now() - before,
          canvas: marker.canvas
        });
        state.current = null;
      }
    });
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      if (!this.canvas.isConnected && args[0] === 0 && args[1] === 0 && args[2] > 100 && args[3] > 100 && state.current) state.current.canvas = this.canvas;
      return Reflect.apply(fill, this, args);
    };
    for (const proto of [globalThis.WebGL2RenderingContext?.prototype, globalThis.WebGLRenderingContext?.prototype].filter(Boolean)) {
      for (const [method, countIndex, instanceIndex] of [['drawArrays', 2, null], ['drawElements', 1, null], ['drawArraysInstanced', 2, 3], ['drawElementsInstanced', 1, 4]]) {
        const fn = proto[method];
        if (!fn) continue;
        proto[method] = function (...args) {
          state.calls++;
          const triangles = args[0] === 4 ? args[countIndex] / 3 : [5, 6].includes(args[0]) ? Math.max(0, args[countIndex] - 2) : 0;
          state.triangles += triangles * (instanceIndex === null ? 1 : args[instanceIndex]);
          return Reflect.apply(fn, this, args);
        };
      }
    }
    try {
      new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(entry => ({
        at: entry.startTime,
        ms: entry.duration
      })))).observe({
        type: 'longtask',
        buffered: true
      });
    } catch {}
    if (disableGpu) {
      try {
        Object.defineProperty(navigator, 'gpu', {
          configurable: true,
          value: undefined
        });
      } catch {}
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return ['webgl', 'webgl2', 'experimental-webgl', 'webgpu'].includes(type) ? null : Reflect.apply(get, this, [type, ...args]);
      };
    }
  }, variant);
  const page = await context.newPage(),
    errors = [],
    messages = new Map(),
    network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (!['warning', 'error'].includes(message.type())) return;
    const text = message.text().slice(0, 700), key = `${message.type()}:${text}`;
    const existing = messages.get(key);
    if (existing) existing.count++;
    else messages.set(key, { type: message.type(), text, count: 1 });
  });
  page.on('response', response => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    network.push({ url: url.origin + url.pathname, status: response.status() });
  });
  try {
    await page.goto(`${origin}/${variant.webgl ? '?gpu=webgl' : ''}`);
    await page.waitForFunction(() => /^(WebGPU|WebGL2|DOM)$/.test(document.querySelector('.terminal-stage')?.dataset.renderer || ''), null, {
      timeout: 50000
    });
    const animated = variant.mode !== 'off' && variant.motion === 'no-preference' && !variant.disableGpu;
    if (animated) await page.waitForFunction(() => ['hero', 'terminal'].includes(document.querySelector('.terminal-stage')?.dataset.introPhase), null, {
      timeout: 40000
    });
    const introState = () => page.evaluate(() => ({
      phase: document.querySelector('.terminal-stage')?.dataset.introPhase,
      progress: window.__hadesdGraphics?.journey ?? Number(document.querySelector('.terminal-stage')?.dataset.introProgress) / 100
    }));
    const seekJourney = async target => {
      // Infer current wheel sensitivity from an uncapped, real user input. This
      // remains independent of timeline.ts and never changes application state.
      const before = await introState();
      if (!['hero', 'journey'].includes(before.phase)) throw new Error(`Cannot sample journey: scene entered ${before.phase}`);
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(1100);
      const after = await introState(),
        delta = after.progress - before.progress;
      if (!(delta > 0)) throw new Error('Real wheel input did not advance the introduction.');
      const pixelsPerJourney = 100 / delta;
      for (let attempt = 0; attempt < 25; attempt++) {
        const current = await introState();
        if (Math.abs(current.progress - target) < .002) return;
        if (!['hero', 'journey'].includes(current.phase)) throw new Error(`Journey left the GPU scene at ${current.progress}`);
        await page.mouse.wheel(0, Math.max(-.05, Math.min(.05, target - current.progress)) * pixelsPerJourney);
        await page.waitForTimeout(1100);
      }
      throw new Error(`Real wheel input did not reach journey ${target}`);
    };
    const finishIntro = async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const state = await introState();
        if (state.phase === 'terminal') return;
        if (['hero', 'journey'].includes(state.phase)) await page.keyboard.press('PageDown');
        await page.waitForTimeout(300);
      }
      await page.waitForFunction(() => document.querySelector('.terminal-stage')?.dataset.stageReady === 'true', null, {
        timeout: 20000
      });
    };
    const take = async phase => {
      await page.evaluate(() => {
        const s = window.__perf;
        s.frames = [];
        s.renderStats = [];
        s.calls = s.triangles = s.raf = 0;
        s.captures = [];
        s.imageUploads = [];
        s.start = performance.now();
        s.startGraphics = window.__hadesdGraphics;
        s.startFrame = window.__hadesdGraphics?.frames;
        s.startPreset = window.__hadesdGraphics?.macPreset;
      });
      await page.waitForTimeout(sampleMs);
      // One atomic browser snapshot: a frame cannot advance between the numerator
      // and denominator used for per-frame counters and CPU distributions.
      const sample = await page.evaluate(() => {
        const s = window.__perf,
          g = window.__hadesdGraphics,
          dt = performance.now() - s.start;
        const stats = values => {
          const v = values.filter(Number.isFinite).sort((a, b) => a - b);
          return v.length ? {
            count: v.length,
            total: v.reduce((a, b) => a + b, 0),
            mean: v.reduce((a, b) => a + b, 0) / v.length,
            p95: v[Math.floor((v.length - 1) * .95)],
            max: v.at(-1)
          } : null;
        };
        const interval = s.frames.slice(1).map((time, i) => time - s.frames[i]).sort((a, b) => a - b);
        const captures = s.captures.filter(c => c.canvas.width === g?.textureWidth && c.canvas.height === g?.textureHeight);
        const rendererTotal = key => s.renderStats.length && s.renderStats.every(frame => Number.isFinite(frame[key])) ? s.renderStats.reduce((sum, frame) => sum + frame[key], 0) : null;
        const backend = document.querySelector('.terminal-stage')?.dataset.renderer;
        const calls = backend === 'WebGPU' ? rendererTotal('drawCalls') : s.calls;
        const triangles = backend === 'WebGPU' ? rendererTotal('triangles') : s.triangles;
        const measurementContinuous = backend === 'DOM' || s.startGraphics === g && typeof Object.getOwnPropertyDescriptor(g, 'frames')?.get === 'function' && g.frames - s.startFrame === s.frames.length;
        return {
          phase: document.querySelector('.terminal-stage')?.dataset.introPhase,
          backend,
          webgpuAdapters: s.adapters,
          externalImageUploads: s.uploadCounterSupported ? s.imageUploads : null,
          startPreset: s.startPreset,
          measurementContinuous,
          durationMs: dt,
          frames: s.frames.length,
          fps: s.frames.length / dt * 1000,
          drawCalls: calls,
          triangles,
          drawsPerFrame: calls === null ? null : calls / Math.max(1, s.frames.length),
          trianglesPerFrame: triangles === null ? null : triangles / Math.max(1, s.frames.length),
          frameIntervalP50: interval[Math.floor(interval.length * .5)],
          frameIntervalP95: interval[Math.floor(interval.length * .95)],
          rafCallbacks: s.raf,
          captureCount: captures.length,
          captureCpuMs: captures.reduce((sum, c) => sum + c.ms, 0),
          captureCpuDistributionMs: stats(captures.map(c => c.ms)),
          renderSubmitCpuMs: stats(s.renderStats.map(frame => frame.renderCpuMs)),
          rendererDrawCalls: rendererTotal('drawCalls'),
          rendererTriangles: rendererTotal('triangles'),
          longTasks: s.longTasks.filter(entry => entry.at >= s.start),
          canvasCount: document.querySelectorAll('.stage-graphics canvas').length,
          graphics: g || null,
          overflow: document.documentElement.scrollWidth > innerWidth
        };
      });
      sample.drawCounterSource = sample.backend === 'WebGL2' ? 'WebGL submitted draw commands' : sample.backend === 'WebGPU' ? 'renderer.info per pipeline frame' : 'no GPU scene';
      const screenshot = path.join(output, `${variant.name}-${phase}.png`);
      result.samples.push({
        variant: variant.name,
        label: phase,
        screenshot,
        ...sample
      });
      console.log(JSON.stringify(result.samples.at(-1)));
      await page.screenshot({
        path: screenshot
      });
      result.checks.push({
        variant: variant.name,
        phase,
        check: 'measurement remains continuous without hot replacement',
        pass: sample.measurementContinuous
      });
    };
    await take('hero-or-fallback');
    if (variant.name === 'desktop-full' && result.samples.at(-1).backend === 'WebGPU') {
      const seconds = await page.evaluate(() => window.__hadesdGraphics?.macScreenSeconds ?? null);
      if (seconds !== null) {
        // Straddle the next real eight-second preset transition; do not force
        // application uniforms or replace the scene's own playlist clock.
        await page.waitForTimeout(Math.max(0, (8 - seconds % 8) * 1000 - sampleMs / 2));
        await take('preset-change');
        const sample = result.samples.at(-1);
        result.checks.push({ variant: variant.name, check: 'preset changes without Canvas repaint or external texture upload',
          pass: sample.startPreset !== sample.graphics?.macPreset && sample.captureCount === 0 && sample.externalImageUploads?.length === 0 });
      }
    }
    if (animated) {
      await seekJourney(.5);
      await take('journey50');
      result.checks.push({
        variant: variant.name,
        check: 'journey remains on GPU at 50%',
        pass: result.samples.at(-1).frames > 0 && result.samples.at(-1).phase === 'journey' && Math.abs((result.samples.at(-1).graphics?.journey ?? -1) - .5) < .003
      });
    }
    await finishIntro();
    await page.waitForTimeout(500);
    await take('terminal-idle');
    if (variant.mode === 'low') {
      const sample = result.samples.at(-1);
      result.checks.push({ variant: variant.name, check: 'Low submits final terminal pose and 2 Hz cursor frames',
        pass: sample.graphics?.introPhase === 'terminal' && sample.graphics.phaseProgress === 1 && sample.fps >= 1 && sample.fps <= 3.5 });
    }
    if (variant.interaction) {
      await page.evaluate(() => { window.__perf.captures = []; });
      const input = page.getByRole('textbox', {
        name: '博客命令',
        exact: true
      });
      await input.fill('open /about.md');
      await input.press('Enter');
      const editor = page.getByRole('region', {
        name: 'Vim 编辑器',
        exact: true
      });
      await editor.waitFor();
      await page.waitForFunction(() => {
        const state = window.__perf, graphics = window.__hadesdGraphics;
        const capture = state.captures.findLast(c => c.canvas.width === graphics?.textureWidth && c.canvas.height === graphics?.textureHeight);
        return capture && state.frames.at(-1) >= capture.at;
      });
      result.checks.push({
        variant: variant.name,
        check: 'open enters Vim without route navigation',
        pass: (await editor.getAttribute('data-vim-mode')) === 'NORMAL' && new URL(page.url()).pathname === '/'
      });
      await take('vim-idle');
      await page.evaluate(() => {
        window.__perf.captures = [];
        window.__perf.start = performance.now();
      });
      await page.getByRole('button', {
        name: 'Vim 下一屏',
        exact: true
      }).click();
      await page.waitForFunction(() => {
        const state = window.__perf, graphics = window.__hadesdGraphics;
        const capture = state.captures.findLast(c => c.canvas.width === graphics?.textureWidth && c.canvas.height === graphics?.textureHeight);
        return capture && state.frames.at(-1) >= capture.at;
      });
      await page.waitForTimeout(600);
      result.checks.push({
        variant: variant.name,
        check: 'Vim page input captured and submitted to GPU',
        pass: await page.evaluate(() => window.__perf.captures.length > 0),
        captureCpuMs: await page.evaluate(() => window.__perf.captures.map(c => c.ms))
      });
      await page.getByRole('button', {
        name: '[ :q 退出 ]',
        exact: true
      }).click();
      await editor.waitFor({
        state: 'detached'
      });
      await input.fill('display');
      await input.press('Enter');
      await page.getByRole('group', {
        name: 'CRT 氛围',
        exact: true
      }).getByRole('button', {
        name: '轻微',
        exact: true
      }).click();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      await take('terminal-low');
      await input.fill('display');
      await input.press('Enter');
      await page.getByRole('group', { name: 'CRT 氛围', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.terminal-stage')?.dataset.renderer === 'DOM' && !document.querySelector('.stage-graphics canvas'));
      await page.waitForTimeout(500);
      await take('terminal-off');
      const off = result.samples.at(-1);
      result.checks.push({ variant: variant.name, check: 'Off transition releases canvas and frame scheduling', pass: off.canvasCount === 0 && off.frames === 0 && off.rafCallbacks === 0 && off.graphics === null });
    }
    const health = await page.evaluate(() => ({
      meaningful: !!document.title && (document.querySelector('.terminal-stage')?.textContent || '').trim().length > 40,
      noOverlay: !document.querySelector('vite-error-overlay,nextjs-portal'),
      noOverflow: document.documentElement.scrollWidth <= innerWidth,
      ready: document.querySelector('.terminal-stage')?.dataset.stageReady === 'true'
    }));
    result.checks.push({
      variant: variant.name,
      check: 'page identity content overlay geometry ready',
      pass: Object.values(health).every(Boolean),
      ...health
    });
    if (variant.mode === 'off' || variant.disableGpu) result.checks.push({
      variant: variant.name,
      check: 'fallback does not render GPU frames',
      pass: result.samples.filter(s => s.variant === variant.name).every(s => s.frames === 0 && s.canvasCount === 0)
    });
  } catch (error) {
    result.samples.push({
      variant: variant.name,
      error: error.message
    });
    console.log(JSON.stringify(result.samples.at(-1)));
  }
  result.errors.push({
    variant: variant.name,
    pageErrors: errors,
    console: [...messages.values()],
    network
  });
  result.checks.push({
    variant: variant.name,
    check: 'no page errors',
    pass: errors.length === 0
  });
  await context.close();
}
await browser.close();
result.finishedAt = new Date().toISOString();
result.result = result.samples.some(s => s.error) || result.checks.some(c => !c.pass) ? 'FAIL' : 'PASS';
await mkdir(path.dirname(reportPath), {
  recursive: true
});
await writeFile(reportPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  report: reportPath,
  result: result.result,
  gpuRenderer: result.gpu.renderer
}));
if (result.result === 'FAIL') process.exitCode = 1;
