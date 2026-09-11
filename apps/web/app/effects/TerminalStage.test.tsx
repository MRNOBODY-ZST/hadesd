import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { TerminalStage } from "./TerminalStage";
import {
  BOOT_DURATION_MS,
  BOOT_CRT_WARMUP_MS,
  BOOT_GUI_START,
  PULLBACK_DURATION_MS,
  RESUME_DURATION_MS,
  PENETRATE_DURATION_MS,
} from "./timeline";

type SceneFrame = { phase: string; reactPhase: string; phaseProgress: number; boot: number; journey: number };
const graphicsMock = vi.hoisted(() => ({
  deferInitialization: false,
  initialize: null as ((backend: string) => void) | null,
  readFrame: null as (() => SceneFrame) | null,
}));
vi.mock("./three/TerminalScene", async () => {
  const { useEffect } = await import("react");
  return {
    default: ({
      onInitialized,
      onFailure,
      phase,
      phaseState,
      phaseProgress,
      bootProgress,
      progress,
      revealStep,
    }: {
      onInitialized: (name: string) => void;
      onFailure: () => void;
      phase: string;
      phaseState: { current: string };
      phaseProgress: { current: number };
      bootProgress: { current: number };
      progress: { current: number };
      revealStep: number;
    }) => {
      useEffect(() => {
        graphicsMock.initialize = onInitialized;
        if (!graphicsMock.deferInitialization) onInitialized("WebGL2");
        return () => { graphicsMock.initialize = null; };
      }, [onInitialized]);
      useEffect(() => {
        // A renderer can still invoke the last committed callback while React
        // batches the next phase. Its refs must already describe one coherent frame.
        graphicsMock.readFrame = () => ({
          phase: phaseState.current, reactPhase: phase,
          phaseProgress: phaseProgress.current,
          boot: bootProgress.current, journey: progress.current,
        });
        return () => { graphicsMock.readFrame = null; };
      }, [phase, phaseState, phaseProgress, bootProgress, progress]);
      return (
        <div data-testid="gpu-scene" data-phase={phase} data-reveal={revealStep}>
          <button onClick={onFailure} data-testid="gpu-failure">
            Simulate GPU loss
          </button>
        </div>
      );
    },
  };
});

let stylesheet: HTMLStyleElement;
beforeEach(() => {
  graphicsMock.deferInitialization = false;
  graphicsMock.initialize = null;
  graphicsMock.readFrame = null;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  stylesheet = document.createElement("style");
  stylesheet.textContent = readFileSync(resolve("app/effects/TerminalStage.css"), "utf8")
    + readFileSync(resolve("../../packages/ui/src/crt.css"), "utf8");
  document.head.append(stylesheet);
});
afterEach(() => {
  cleanup();
  stylesheet.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function advanceTime(ms: number) {
  // Flush each phase's React effect before advancing its successor's independent clock.
  while (ms > 0) {
    const chunk = Math.min(ms, 50);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(chunk);
    });
    ms -= chunk;
  }
}
function Content() {
  return (
    <div className="terminal-shell">
      <section className="terminal">
        <div className="terminal-session" data-testid="reveal-1">TTY 01</div>
        <div className="screen-content">
          <div className="home-page">
            <p className="terminal-identity" data-testid="reveal-2">Identity</p>
            <div className="terminal-files" data-testid="reveal-3"><a href="/posts">Posts</a></div>
            <div className="terminal-recent" data-testid="reveal-4">Recent files</div>
            <p className="terminal-welcome-hint" data-testid="reveal-5">Published article</p>
          </div>
        </div>
        <nav className="screen-paging" data-testid="reveal-6">SCREEN 01 / 01</nav>
        <form className="terminal-input" data-testid="reveal-7">
          <textarea aria-label="博客命令" defaultValue="search alpha" />
          <span data-terminal-cursor>█</span>
        </form>
      </section>
    </div>
  );
}
async function start() {
  const mounted = render(
    <TerminalStage theme="amber" level="full"><Content /></TerminalStage>,
  );
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return mounted.container.querySelector(".terminal-stage")!;
}
async function untilPhase(stage: Element, expected: string) {
  for (let elapsed = 0; elapsed < 10000; elapsed += 16) {
    if (stage.getAttribute("data-intro-phase") === expected) return;
    await advanceTime(16);
  }
  expect(stage.getAttribute("data-intro-phase")).toBe(expected);
}
async function toHero() {
  await advanceTime(BOOT_DURATION_MS + 50);
  await advanceTime(PULLBACK_DURATION_MS + 50);
}
function travelForward() {
  for (let step = 0; step < 9; step++) fireEvent.keyDown(window, { key: "PageDown" });
}
async function toReveal(stage: Element) {
  await toHero();
  travelForward();
  await untilPhase(stage, "resume");
  expect(stage.getAttribute("data-intro-phase")).toBe("resume");
  await advanceTime(RESUME_DURATION_MS + 50);
  expect(stage.getAttribute("data-intro-phase")).toBe("penetrate");
  await advanceTime(PENETRATE_DURATION_MS + 50);
  expect(stage.getAttribute("data-intro-phase")).toBe("reveal");
}

it("pauses DOS at 80%, pulls back before enabling the hero, and waits for user travel", async () => {
  const stage = await start();
  expect(stage.getAttribute("data-intro-phase")).toBe("boot");
  await advanceTime(BOOT_DURATION_MS + 50);
  expect(stage.getAttribute("data-intro-phase")).toBe("pullback");
  expect(stage.getAttribute("data-boot-progress")).toBe("80");
  expect(stage.getAttribute("data-stage-ready")).toBe("false");
  expect(stage.querySelector("[data-native-image-layer]")).toBeNull();
  const hero = screen.getByRole("region", { name: "个人计算机介绍", hidden: true });
  expect(hero.hasAttribute("inert")).toBe(true);
  expect(Number(hero.style.opacity)).toBe(0);
  fireEvent.wheel(window, { deltaY: 800 });
  await advanceTime(PULLBACK_DURATION_MS * 0.7);
  expect(Number(hero.style.opacity)).toBeGreaterThan(0);
  expect(stage.getAttribute("data-intro-progress")).toBe("0");
  await advanceTime(PULLBACK_DURATION_MS * 0.3 + 50);
  expect(stage.getAttribute("data-intro-phase")).toBe("hero");
  expect(hero.hasAttribute("inert")).toBe(false);
  await advanceTime(10000);
  expect(stage.getAttribute("data-boot-progress")).toBe("80");
  expect(stage.getAttribute("data-intro-progress")).toBe("0");
  fireEvent.wheel(window, { deltaY: 500 });
  await advanceTime(1800);
  expect(stage.getAttribute("data-intro-phase")).toBe("journey");
  const stationary = stage.getAttribute("data-intro-progress");
  await advanceTime(2000);
  expect(stage.getAttribute("data-intro-progress")).toBe(stationary);
  fireEvent.keyDown(window, { key: "Home" });
  await advanceTime(1800);
  expect(stage.getAttribute("data-intro-phase")).toBe("hero");
  fireEvent.keyDown(window, { key: "PageDown" });
  await advanceTime(1800);
  expect(stage.getAttribute("data-intro-progress")).toBe("12");
});

it("resumes the remaining boot only after travel, penetrates, then reveals seven real DOM groups before ready", async () => {
  const stage = await start();
  const surface = stage.querySelector(".stage-content")!;
  const readyEvents = vi.fn();
  window.addEventListener("hadesd:boot-ready", readyEvents);
  const mutations: string[] = [];
  const observer = new MutationObserver(() => mutations.push(surface.getAttribute("data-terminal-reveal-step")!));
  observer.observe(surface, { attributes: true, attributeFilter: ["data-terminal-reveal-step"] });
  await toHero();
  travelForward();
  await untilPhase(stage, "resume");
  expect(stage.getAttribute("data-intro-phase")).toBe("resume");
  expect(stage.getAttribute("data-intro-progress")).toBe("100");
  expect(Number(stage.getAttribute("data-boot-progress"))).toBeLessThan(90);
  await advanceTime(RESUME_DURATION_MS / 2);
  expect(Number(stage.getAttribute("data-boot-progress"))).toBeGreaterThan(88);
  expect(stage.getAttribute("data-stage-ready")).toBe("false");
  await untilPhase(stage, "penetrate");
  expect(stage.getAttribute("data-boot-progress")).toBe("100");
  await untilPhase(stage, "reveal");
  expect(stage.getAttribute("data-reveal-step")).toBe("0");
  expect(stage.querySelector("[data-native-image-layer]")).not.toBeNull();
  for (let step = 1; step <= 7; step++) {
    expect(getComputedStyle(screen.getByTestId(`reveal-${step}`)).visibility, `group ${step} hidden at reveal 0`).toBe("hidden");
  }
  for (let step = 1; step <= 7; step++) {
    await advanceTime(step === 1 ? 110 : 95);
    expect(stage.getAttribute("data-reveal-step")).toBe(String(step));
    expect(screen.getByTestId("gpu-scene").getAttribute("data-reveal")).toBe(String(step));
    for (let group = 1; group <= 7; group++) {
      expect(getComputedStyle(screen.getByTestId(`reveal-${group}`)).visibility).toBe(group <= step ? "visible" : "hidden");
    }
    expect(stage.getAttribute("data-stage-ready")).toBe("false");
    expect(surface.hasAttribute("inert")).toBe(true);
  }
  expect(mutations).toEqual(expect.arrayContaining(["1", "2", "3", "4", "5", "6", "7"]));
  expect(readyEvents).not.toHaveBeenCalled();
  await advanceTime(150);
  expect(stage.getAttribute("data-intro-phase")).toBe("terminal");
  expect(readyEvents).toHaveBeenCalledTimes(1);
  expect(surface.hasAttribute("inert")).toBe(false);
  expect((screen.getByRole("textbox", { name: "博客命令" }) as HTMLTextAreaElement).value).toBe("search alpha");
  fireEvent.wheel(window, { deltaY: -2000 });
  fireEvent.keyDown(window, { key: "Home" });
  await advanceTime(500);
  expect(stage.getAttribute("data-intro-phase")).toBe("terminal");
  observer.disconnect();
  window.removeEventListener("hadesd:boot-ready", readyEvents);
});

it("hands the renderer a new phase with its reset progress before React commits the next timed stage", async () => {
  const stage = await start();
  await toHero();
  travelForward();
  await untilPhase(stage, "resume");
  const crossBoundary = async (from: string, to: string) => {
    while (graphicsMock.readFrame!().phaseProgress < 0.8) await advanceTime(16);
    const committedFrame = graphicsMock.readFrame!;
    expect(committedFrame().phase).toBe(from);
    expect(committedFrame().reactPhase).toBe(from);
    let boundary: SceneFrame | undefined;
    act(() => {
      for (let frame = 0; frame < 30; frame++) {
        vi.advanceTimersByTime(16);
        const candidate = committedFrame();
        if (candidate.phase !== from) {
          boundary = candidate;
          // Assert inside the batch: the DOM/React prop still describes the old
          // stage, precisely where pairing it with reset progress caused a flash.
          expect(screen.getByTestId("gpu-scene").getAttribute("data-phase")).toBe(from);
          break;
        }
      }
    });
    expect(boundary).toEqual({
      phase: to, reactPhase: from, phaseProgress: 0, boot: 1, journey: 1,
    });
    expect(stage.getAttribute("data-intro-phase")).toBe(to);
    expect(graphicsMock.readFrame!().phase).toBe(to);
  };
  await crossBoundary("resume", "penetrate");
  await crossBoundary("penetrate", "reveal");
  expect(stage.getAttribute("data-stage-ready")).toBe("false");
  expect(stage.querySelector(".stage-content")?.hasAttribute("inert")).toBe(true);
});

it("blocks direct jump shortcuts and hidden commands while normal travel and reboot stay accessible", async () => {
  const stage = await start();
  const commands = vi.fn();
  window.addEventListener("keydown", commands);
  for (const key of ["Enter", "Escape", "x"]) fireEvent.keyDown(window, { key });
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(stage.getAttribute("data-intro-phase")).toBe("boot");
  expect(commands).not.toHaveBeenCalled();
  window.removeEventListener("keydown", commands);
  await toReveal(stage);
  await advanceTime(2200);
  expect(stage.getAttribute("data-intro-phase")).toBe("terminal");
  expect(stage.getAttribute("data-reveal-step")).toBe("7");
  fireEvent(window, new Event("hadesd:reboot"));
  expect(stage.getAttribute("data-intro-phase")).toBe("boot");
  expect(stage.getAttribute("data-boot-progress")).toBe("0");
  expect(stage.getAttribute("data-phase-progress")).toBe("0");
  expect(stage.getAttribute("data-intro-progress")).toBe("0");
  expect(stage.getAttribute("data-reveal-step")).toBe("0");
  await toReveal(stage);
  await advanceTime(500);
  expect(stage.getAttribute("data-reveal-step")).toBe("5");
  expect(screen.queryByRole("button", { name: "跳过片头，进入终端" })).toBeNull();
  await advanceTime(4000);
  expect(stage.getAttribute("data-intro-phase")).toBe("terminal");
  expect(stage.getAttribute("data-reveal-step")).toBe("7");
  expect(getComputedStyle(screen.getByTestId("reveal-7")).visibility).toBe("visible");
});

it("CRT off bypasses every stage and exposes the complete DOM immediately", async () => {
  const { container } = render(<TerminalStage theme="paper" level="off"><Content /></TerminalStage>);
  await advanceTime(1);
  const stage = container.querySelector(".terminal-stage")!;
  expect(stage.getAttribute("data-intro-phase")).toBe("terminal");
  expect(stage.getAttribute("data-renderer")).toBe("DOM");
  expect(stage.getAttribute("data-reveal-step")).toBe("7");
  expect(getComputedStyle(screen.getByTestId("reveal-7")).visibility).toBe("visible");
  expect(screen.queryByTestId("gpu-scene")).toBeNull();
  expect(stage.querySelector("[data-native-image-layer]")).toBeNull();
});

it("uses touch travel and restores all terminal groups when the GPU fails during reveal", async () => {
  const stage = await start();
  await toHero();
  fireEvent.touchStart(window, { touches: [{ clientY: 500 }] });
  fireEvent.touchMove(window, { touches: [{ clientY: 300 }] });
  fireEvent.touchEnd(window);
  await advanceTime(1800);
  expect(stage.getAttribute("data-intro-phase")).toBe("journey");
  expect(Number(stage.getAttribute("data-intro-progress"))).toBeGreaterThan(0);
  travelForward();
  await untilPhase(stage, "resume");
  await advanceTime(RESUME_DURATION_MS + 50);
  await advanceTime(PENETRATE_DURATION_MS + 50);
  expect(stage.getAttribute("data-intro-phase")).toBe("reveal");
  fireEvent.click(screen.getByTestId("gpu-failure"));
  expect(stage.getAttribute("data-intro-phase")).toBe("terminal");
  expect(stage.getAttribute("data-renderer")).toBe("DOM");
  expect(stage.getAttribute("data-reveal-step")).toBe("7");
  expect(stage.querySelector(".stage-content")?.hasAttribute("inert")).toBe(false);
  expect(fireEvent.wheel(window, { deltaY: -800 })).toBe(true);
  await advanceTime(5000);
  expect(stage.getAttribute("data-intro-progress")).toBe("100");
});

it("respects reduced motion by bypassing the whole sequence including progressive reveal", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const stage = await start();
  expect(stage.getAttribute("data-stage-ready")).toBe("true");
  expect(stage.getAttribute("data-intro-phase")).toBe("terminal");
  expect(stage.getAttribute("data-reveal-step")).toBe("7");
  expect(screen.queryByRole("region", { name: "个人计算机介绍" })).toBeNull();
});

it("server HTML keeps the entire article available without client reveal gates", () => {
  const html = renderToString(<TerminalStage theme="amber" level="full"><Content /></TerminalStage>);
  expect(html).toContain("Published article");
  expect(html).toContain('href="/posts"');
  expect(html).not.toContain("data-terminal-reveal-step=");
  expect(html).not.toContain('inert=""');
});

it("keeps the readable slogan and decorative scroll cue together without creating a jump control", async () => {
  const stage = await start();
  await toHero();
  const introduction = screen.getByRole("region", { name: "个人计算机介绍" });
  const title = screen.getByRole("heading", { name: "让想象，接通现实。" });
  const cue = screen.getByText("滚动进入这台电脑", { exact: true });
  expect(introduction.contains(cue)).toBe(true);
  expect(title.nextElementSibling?.contains(cue)).toBe(true);
  expect(getComputedStyle(title).fontFamily).toContain("SimSun");
  expect(getComputedStyle(title).fontWeight).toBe("400");
  const arrow = introduction.querySelector(".stage-scroll-arrow");
  expect(arrow?.getAttribute("aria-hidden")).toBe("true");
  expect(cue.closest("a,button,[tabindex]")).toBeNull();
  fireEvent.click(cue);
  await advanceTime(1000);
  expect(stage.getAttribute("data-intro-phase")).toBe("hero");
  expect(stage.getAttribute("data-intro-progress")).toBe("0");
  expect(screen.queryByText(/PERSONAL COMPUTING|EST\. 2026|SYSTEM ONLINE|HARDWARE × SOFTWARE|SKIP INTRO/)).toBeNull();
  expect(screen.queryByRole("button", { name: "进入终端" })).toBeNull();
  expect(stage.querySelector(".stage-base")).toBeNull();
  const glyph = stage.querySelector<HTMLElement>(".stage-hero-glyph")!;
  fireEvent(window, new MouseEvent("pointermove", { clientX: 10, clientY: 10 }));
  await advanceTime(20);
  expect(Number.parseFloat(glyph.style.getPropertyValue("--glyph-x"))).toBeGreaterThan(0);
  expect(screen.getByRole("heading", { name: "让想象，接通现实。" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "ArrowDown" });
  await advanceTime(1800);
  expect(stage.getAttribute("data-intro-progress")).toBe("4");
});

it("keeps a borderless rounded black CRT visible before the graphics adapter initializes", async () => {
  graphicsMock.deferInitialization = true;
  const stage = await start();
  const fallback = stage.querySelector<HTMLElement>(".stage-crt-startup")!;
  expect(fallback).not.toBeNull();
  expect(getComputedStyle(fallback).display).not.toBe("none");
  expect(getComputedStyle(fallback).borderTopWidth).toBe("0px");
  expect(getComputedStyle(fallback).boxShadow).toBe("none");
  expect(getComputedStyle(fallback).borderRadius).toBe("2% / 3%");
  expect(stage.querySelector(".stage-physical-frame")).toBeNull();
  expect(fallback.getAttribute("aria-hidden")).toBe("true");
  act(() => graphicsMock.initialize!("WebGL2"));
  expect(getComputedStyle(fallback).opacity).toBe("0");
});

it("blends the completed CRT aperture into a black surround without an inset light ring", async () => {
  const stage = await start();
  fireEvent.click(screen.getByTestId("gpu-failure"));
  expect(stage.getAttribute("data-intro-phase")).toBe("terminal");
  expect(getComputedStyle(stage.querySelector(".stage-ambient")!).backgroundColor).toBe("rgb(0, 0, 0)");
  const glass = document.createElement("div");
  glass.className = "system-crt-glass";
  stage.append(glass);
  expect(getComputedStyle(glass).boxShadow).toBe("inset 0 0 9vw 1vw #0007");
});

it("waits for the first GPU frame and a CRT-only warmup before any boot text or loading progress", async () => {
  graphicsMock.deferInitialization = true;
  const stage = await start();
  const fallback = stage.querySelector<HTMLElement>(".stage-crt-startup")!;
  expect(fallback.textContent).toBe("");
  expect(fallback.querySelector("i")).toBeNull();
  expect(stage.getAttribute("data-boot-segment")).toBe("warmup");
  expect(getComputedStyle(stage.querySelector(".stage-boot-status")!).clipPath).toBe("inset(50%)");
  await advanceTime(1000);
  expect(stage.getAttribute("data-phase-progress")).toBe("0");
  act(() => graphicsMock.initialize!("WebGL2"));
  await advanceTime(BOOT_CRT_WARMUP_MS - 16);
  expect(stage.getAttribute("data-boot-segment")).toBe("warmup");
  expect(stage.getAttribute("data-boot-progress")).toBe("0");
  await advanceTime(48);
  expect(stage.getAttribute("data-boot-segment")).toBe("post");
  await advanceTime(BOOT_GUI_START * BOOT_DURATION_MS - BOOT_CRT_WARMUP_MS + 50);
  expect(stage.getAttribute("data-boot-segment")).toBe("gui");
  expect(Number(stage.getAttribute("data-boot-progress"))).toBeGreaterThan(0);
});

it("shares the near-fullscreen geometry with the native hit layer and removes terminal chrome overlap", async () => {
  const mounted = render(<TerminalStage theme="paper" level="off"><Content /></TerminalStage>);
  await advanceTime(1);
  const stage = mounted.container.querySelector(".terminal-stage")!;
  const frame = getComputedStyle(stage);
  expect(frame.getPropertyValue("--screen-x").trim()).toBe("1vw");
  expect(frame.getPropertyValue("--screen-top").trim()).toBe("2dvh");
  expect(frame.getPropertyValue("--screen-bottom").trim()).toBe("2dvh");
  expect(getComputedStyle(stage.querySelector(".stage-masthead")!).visibility).toBe("hidden");
  expect(stage.querySelector(".stage-content")?.contains(screen.getByRole("textbox", { name: "博客命令" }))).toBe(true);
});

it("reinitializes graphics on Off to Full, delaying the composited glass until the new adapter succeeds", async () => {
  const display = (level: "off" | "full") => <>
    <TerminalStage theme="amber" level={level}><Content /></TerminalStage>
    <div className="system-crt-glass" data-testid="whole-page-glass" />
  </>;
  const mounted = render(display("full"));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const stage = mounted.container.querySelector(".terminal-stage")!;
  expect(stage.getAttribute("data-renderer")).toBe("WebGL2");
  mounted.rerender(display("off"));
  expect(stage.getAttribute("data-renderer")).toBe("DOM");
  expect(screen.queryByTestId("gpu-scene")).toBeNull();
  graphicsMock.deferInitialization = true;
  mounted.rerender(display("full"));
  expect(stage.getAttribute("data-renderer")).toBe("initializing");
  expect(stage.getAttribute("data-graphics")).toBe("false");
  expect(getComputedStyle(screen.getByTestId("whole-page-glass")).display).toBe("none");
  expect(stage.getAttribute("data-stage-ready")).toBe("true");
  expect(getComputedStyle(screen.getByTestId("reveal-7")).visibility).toBe("visible");
  await advanceTime(900);
  expect(stage.getAttribute("data-renderer")).toBe("initializing");
  act(() => { graphicsMock.initialize!("WebGPU"); });
  expect(stage.getAttribute("data-renderer")).toBe("WebGPU");
  expect(stage.getAttribute("data-graphics")).toBe("true");
  expect(getComputedStyle(screen.getByTestId("whole-page-glass")).display).not.toBe("none");
  await advanceTime(14500);
  expect(stage.getAttribute("data-renderer")).toBe("WebGPU");
});

it("does not reuse an old success flag when a renewed renderer hangs, restoring DOM after 14 seconds", async () => {
  const display = (level: "off" | "full") => <TerminalStage theme="amber" level={level}><Content /></TerminalStage>;
  const mounted = render(display("full"));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const stage = mounted.container.querySelector(".terminal-stage")!;
  expect(stage.getAttribute("data-renderer")).toBe("WebGL2");
  mounted.rerender(display("off"));
  graphicsMock.deferInitialization = true;
  mounted.rerender(display("full"));
  expect(stage.getAttribute("data-renderer")).toBe("initializing");
  await advanceTime(13900);
  expect(stage.getAttribute("data-renderer")).toBe("initializing");
  await advanceTime(150);
  expect(stage.getAttribute("data-renderer")).toBe("DOM");
  expect(stage.getAttribute("data-stage-ready")).toBe("true");
  expect(stage.getAttribute("data-reveal-step")).toBe("7");
  expect(screen.queryByTestId("gpu-scene")).toBeNull();
  expect(getComputedStyle(screen.getByTestId("reveal-7")).visibility).toBe("visible");
});
