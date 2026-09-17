import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { CrtLevel, Theme } from "@hadesd/contracts";
import {
  clampProgress,
  bootProgressAt,
  bootSegmentsAt,
  easeJourney,
  createRevealSchedule,
  isTimedPhase,
  nextTimedPhase,
  REVEAL_GROUP_COUNT,
  revealStepAt,
  timedPhaseDuration,
  keyStep,
  phaseForJourney,
  touchStep,
  wheelStep,
  type IntroPhase,
} from "./timeline";
import "./TerminalStage.css";
import { NativeImageLayer } from "./NativeImageLayer";
import { ForegroundPreview, previewModeFromSearch, type PreviewMode } from "./ForegroundPreview";
import { portalShapeFromSearch, type PortalShape } from "./three/foreground/portalShapes";

const Scene = lazy(() => import("./three/TerminalScene"));
class GraphicsBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function TerminalStage({
  children,
  theme,
  level,
  siteTitle = "HADESD",
  heroTitle,
}: {
  children: ReactNode;
  theme: Theme;
  level: CrtLevel;
  siteTitle?: string;
  heroTitle?: string | null;
}) {
  const heroLines = (heroTitle?.trim() || "让想象，\n接通现实。").split(/\r?\n/u).filter(Boolean);
  const [mounted, setMounted] = useState(false);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const [renderer, setRenderer] = useState("initializing");
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<IntroPhase>("boot");
  const [percent, setPercent] = useState(0);
  const [bootPercent, setBootPercent] = useState(0);
  const [phasePercent, setPhasePercent] = useState(0);
  const [revealStep, setRevealStep] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [previewMode, setPreviewMode] = useState<PreviewMode | null>(null);
  const [portalShape, setPortalShape] = useState<PortalShape>("star");
  const previewStarted = useRef(false);
  const signalPortal = useRef(false);
  const portalRevealStarted = useRef<number | null>(null);
  const phaseRef = useRef<IntroPhase>("boot");
  const bootProgress = useRef(0);
  const phaseProgress = useRef(0);
  const revealSchedule = useRef<number[]>([]);
  const progress = useRef(0);
  const destination = useRef(0);
  const animation = useRef<number | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const hero = useRef<HTMLElement>(null);
  const initialized = useRef(false);
  const enabled = mounted && level !== "off" && !failed;
  const activeRenderer =
    mounted && (level === "off" || failed) ? "DOM" : renderer;
  const ready = phase === "terminal";
  const changePhase = useCallback((next: IntroPhase) => {
    if (phaseRef.current === next) return;
    phaseProgress.current = 0;
    setPhasePercent(0);
    if (next === "reveal") {
      // The portal already displays this live surface. Keep its revealed groups
      // and clock when the camera passes through, without a second black frame.
      if (!signalPortal.current || portalRevealStarted.current === null) {
        revealSchedule.current = createRevealSchedule();
        setRevealStep(0);
        if (signalPortal.current) portalRevealStarted.current = performance.now();
      }
    }
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const resetPortalReveal = useCallback(() => {
    if (portalRevealStarted.current === null) return;
    portalRevealStarted.current = null;
    revealSchedule.current = [];
    if (phaseRef.current !== "terminal") setRevealStep(0);
  }, []);
  const updatePortalReveal = useCallback((journey: number, now: number) => {
    if (!signalPortal.current) return;
    if (journey < .5) {
      resetPortalReveal();
    } else if (journey >= .52 && portalRevealStarted.current === null) {
      portalRevealStarted.current = now;
      revealSchedule.current = createRevealSchedule();
      setRevealStep(0);
    }
  }, [resetPortalReveal]);
  const finish = useCallback(() => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
    destination.current = 1;
    progress.current = 1;
    bootProgress.current = 1;
    setPercent(100);
    setBootPercent(100);
    changePhase("terminal");
    phaseProgress.current = 1;
    setPhasePercent(100);
    setRevealStep(REVEAL_GROUP_COUNT);
  }, [changePhase]);
  useEffect(() => {
    if (ready) window.dispatchEvent(new Event("hadesd:boot-ready"));
  }, [ready]);
  const fail = useCallback(() => {
    setFailed(true);
    setRenderer("DOM");
    finish();
  }, [finish]);
  const onInitialized = useCallback((name: string) => {
    initialized.current = true;
    setRenderer(name);
  }, []);
  useLayoutEffect(() => {
    if (enabled) {
      // Reset before paint and before a newly mounted scene reports initialization.
      // This also suspends the composited glass during Off → Full adapter acquisition.
      initialized.current = false;
      setRenderer("initializing");
    }
  }, [enabled]);
  const animateJourney = useCallback(() => {
    if (animation.current !== null) return;
    let previous = performance.now();
    const tick = (now: number) => {
      animation.current = null;
      if (phaseRef.current !== "hero" && phaseRef.current !== "journey")
        return;
      const next = easeJourney(
        progress.current,
        destination.current,
        now - previous,
      );
      previous = now;
      progress.current = next;
      setPercent(Math.floor(next * 100));
      updatePortalReveal(next, now);
      changePhase(phaseForJourney(next, signalPortal.current));
      if (next === 1) return;
      if (next !== destination.current)
        animation.current = requestAnimationFrame(tick);
    };
    animation.current = requestAnimationFrame(tick);
  }, [changePhase, updatePortalReveal]);
  const advance = useCallback(
    (delta: number) => {
      if (phaseRef.current !== "hero" && phaseRef.current !== "journey") return;
      destination.current = clampProgress(destination.current + delta);
      animateJourney();
    },
    [animateJourney],
  );

  const seekPreview = useCallback((value: number) => {
    if (!import.meta.env.DEV || !initialized.current || failed || reducedMotion) return;
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
    const next = Math.min(signalPortal.current ? 1 : .98, clampProgress(value));
    if (next < 1 && (phaseRef.current === "terminal" || phaseRef.current === "reveal")) resetPortalReveal();
    destination.current = progress.current = next;
    bootProgress.current = .8;
    setBootPercent(80);
    setPercent(Math.round(next * 1000) / 10);
    updatePortalReveal(next, performance.now());
    changePhase(phaseForJourney(next, signalPortal.current));
  }, [changePhase, failed, reducedMotion, resetPortalReveal, updatePortalReveal]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      const mode = previewModeFromSearch(window.location.search);
      signalPortal.current = mode === "circuit";
      setPreviewMode(mode);
      setPortalShape(portalShapeFromSearch(window.location.search));
    }
  }, []);
  useEffect(() => {
    if (previewMode && !previewStarted.current && phase === "hero" && renderer !== "initializing") {
      previewStarted.current = true;
      seekPreview(.55);
    }
  }, [previewMode, phase, renderer, seekPreview]);
  const selectPreview = (mode: PreviewMode) => {
    const changed = mode !== previewMode;
    if (changed) resetPortalReveal();
    signalPortal.current = mode === "circuit";
    if (changed && phaseRef.current === "reveal") {
      revealSchedule.current = createRevealSchedule();
      setRevealStep(0);
      if (signalPortal.current) portalRevealStarted.current = performance.now();
      // Replace the outgoing mode's pending reveal RAF with a fresh clock.
      setEpoch(value => value + 1);
    }
    setPreviewMode(mode);
    const url = new URL(window.location.href);
    url.searchParams.set("effects", mode);
    window.history.replaceState(window.history.state, "", url);
  };
  const selectPortalShape = (shape: PortalShape) => {
    setPortalShape(shape);
    const url = new URL(window.location.href);
    url.searchParams.set("shape", shape);
    window.history.replaceState(window.history.state, "", url);
  };

  useEffect(() => {
    if (!enabled || reducedMotion || renderer === "initializing" || previewMode !== "circuit" || (phase !== "hero" && phase !== "journey")) return;
    let frame = 0;
    const tick = (now: number) => {
      if (!signalPortal.current || (phaseRef.current !== "hero" && phaseRef.current !== "journey")) return;
      // Reveal timing is independent of scroll easing; only the portal's pose
      // is scrubbed. Below the entry threshold it can start a fresh boot again.
      updatePortalReveal(progress.current, now);
      if (portalRevealStarted.current !== null) {
        setRevealStep(revealStepAt(now - portalRevealStarted.current, revealSchedule.current));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled, reducedMotion, renderer, previewMode, phase, updatePortalReveal]);

  useEffect(() => {
    setMounted(true);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    let pointerFrame: number | null = null;
    let pointerPosition = { x: 0, y: 0 };
    const move = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / innerWidth) * 2 - 1;
      pointer.current.y = 1 - (event.clientY / innerHeight) * 2;
      pointerPosition = { x: event.clientX, y: event.clientY };
      if (media.matches || pointerFrame !== null || !hero.current || progress.current >= 0.32) return;
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = null;
        const glyphs = [...hero.current?.querySelectorAll<HTMLElement>(".stage-hero-glyph") || []];
        const bounds = glyphs.map(glyph => glyph.getBoundingClientRect());
        glyphs.forEach((glyph, index) => {
          const rect = bounds[index]!;
          const dx = pointerPosition.x - rect.left - rect.width / 2;
          const dy = pointerPosition.y - rect.top - rect.height / 2;
          const proximity = Math.max(0, 1 - Math.hypot(dx, dy) / 280);
          glyph.style.setProperty("--glyph-x", `${(Math.max(-5, Math.min(5, dx * 0.045)) * proximity).toFixed(2)}px`);
          glyph.style.setProperty("--glyph-y", `${(Math.max(-4, Math.min(4, dy * 0.045)) * proximity).toFixed(2)}px`);
          glyph.style.setProperty("--glyph-tilt", `${(Math.max(-2, Math.min(2, dx * 0.018)) * proximity).toFixed(2)}deg`);
          glyph.style.setProperty("--glyph-glow", (0.16 + proximity * 0.4).toFixed(2));
        });
      });
    };
    const reboot = () => {
      if (animation.current !== null) cancelAnimationFrame(animation.current);
      animation.current = null;
      destination.current = 0;
      progress.current = 0;
      bootProgress.current = 0;
      phaseProgress.current = 0;
      portalRevealStarted.current = null;
      revealSchedule.current = [];
      setRevealStep(0);
      setPhasePercent(0);
      setPercent(0);
      setBootPercent(0);
      changePhase("boot");
      setEpoch((value) => value + 1);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("hadesd:reboot", reboot);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("hadesd:reboot", reboot);
      if (animation.current !== null) cancelAnimationFrame(animation.current);
      if (pointerFrame !== null) cancelAnimationFrame(pointerFrame);
    };
  }, [changePhase]);

  useEffect(() => {
    if (!mounted) return;
    if (level === "off" || failed || reducedMotion) {
      finish();
      return;
    }
    if (!isTimedPhase(phase) || renderer === "initializing") return;
    const started = phase === "reveal" && signalPortal.current && portalRevealStarted.current !== null
      ? portalRevealStarted.current
      : performance.now();
    const duration = timedPhaseDuration(phase, revealSchedule.current);
    let frame = 0;
    const tick = (now: number) => {
      if (phaseRef.current !== phase) return;
      const elapsed = now - started;
      const next = clampProgress(elapsed / duration);
      phaseProgress.current = next;
      setPhasePercent(Math.floor(next * 100));
      if (phase === "boot" || phase === "resume") {
        const boot = phase === "boot" ? bootProgressAt(elapsed) : 0.8 + next * 0.2;
        bootProgress.current = boot;
        setBootPercent(Math.floor(boot * 100));
      }
      if (phase === "reveal") {
        setRevealStep(revealStepAt(elapsed, revealSchedule.current));
      }
      if (next === 1) {
        if (phase === "reveal") finish();
        else changePhase(nextTimedPhase(phase));
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    mounted,
    renderer,
    epoch,
    failed,
    reducedMotion,
    finish,
    level,
    phase,
    changePhase,
  ]);

  useEffect(() => {
    if (!enabled || renderer !== "initializing") return;
    const timeout = window.setTimeout(() => {
      if (!initialized.current) fail();
    }, 14000);
    return () => clearTimeout(timeout);
  }, [enabled, renderer, fail]);

  useEffect(() => {
    const isPreviewControl = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-foreground-preview]");
    const wheel = (event: WheelEvent) => {
      if (isPreviewControl(event.target)) return;
      if (phaseRef.current !== "hero" && phaseRef.current !== "journey") return;
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      advance(wheelStep(event.deltaY, event.deltaMode, innerHeight));
    };
    let previousTouch: number | null = null;
    const touchStart = (event: TouchEvent) => {
      previousTouch =
        !isPreviewControl(event.target) && event.touches.length === 1 ? event.touches[0]!.clientY : null;
    };
    const touchMove = (event: TouchEvent) => {
      if (
        (phaseRef.current !== "hero" && phaseRef.current !== "journey") ||
        previousTouch === null ||
        event.touches.length !== 1
      )
        return;
      const next = event.touches[0]!.clientY;
      event.preventDefault();
      event.stopPropagation();
      advance(touchStep(previousTouch - next, innerHeight));
      previousTouch = next;
    };
    const touchEnd = () => {
      previousTouch = null;
    };
    const keyboard = (event: KeyboardEvent) => {
      if (isPreviewControl(event.target)) return;
      if (phaseRef.current === "terminal" || event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.key === "Tab")
        return;
      const control =
        event.target instanceof Element &&
        event.target.closest("button,a,input,textarea,select");
      if (control && (event.key === "Enter" || event.key === " ")) return;
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const delta = keyStep(event.key, event.shiftKey);
      if (delta !== null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        advance(delta);
        return;
      }
      // Hidden terminal content cannot receive printable commands during the introduction.
      if (event.key.length === 1) event.stopImmediatePropagation();
    };
    window.addEventListener("wheel", wheel, { passive: false, capture: true });
    window.addEventListener("touchstart", touchStart, { passive: true });
    window.addEventListener("touchmove", touchMove, {
      passive: false,
      capture: true,
    });
    window.addEventListener("touchend", touchEnd);
    window.addEventListener("keydown", keyboard, true);
    return () => {
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("touchstart", touchStart);
      window.removeEventListener("touchmove", touchMove, true);
      window.removeEventListener("touchend", touchEnd);
      window.removeEventListener("keydown", keyboard, true);
    };
  }, [advance]);

  const heroOpacity = phase === "pullback"
    ? clampProgress((phasePercent / 100 - 0.5) / 0.5)
    : Math.max(0, 1 - percent / 32);
  const heroVisible = ["pullback", "hero", "journey"].includes(phase);
  const heroInteractive = phase !== "pullback" && percent < 32;
  return (
    <div
      className="terminal-stage"
      data-stage-ready={ready ? "true" : "false"}
      data-intro-phase={phase}
      data-intro-progress={percent}
      data-boot-progress={bootPercent}
      data-boot-segment={phase === "boot" ? bootSegmentsAt(phasePercent / 100).segment : undefined}
      data-phase-progress={phasePercent}
      data-reveal-step={revealStep}
      data-renderer={activeRenderer}
      data-graphics={enabled && renderer !== "initializing" ? "true" : "false"}
      data-stage-theme={theme}
      data-foreground-effect={previewMode ?? "binary"}
      data-portal-shape={previewMode === "circuit" ? portalShape : undefined}
    >
      <div className="stage-ambient" aria-hidden="true" />
      <div className="stage-crt-startup" aria-hidden="true"><div className="stage-crt-startup-screen" /></div>
      <div className="stage-masthead" style={previewMode === "circuit" && phase === "journey" ? { opacity: 1 - clampProgress((percent / 100 - .83) / .1) } : undefined}>
        <span>
          {siteTitle}
        </span>
      </div>
      <div
        className="stage-content"
        ref={setSurface}
        data-terminal-reveal-step={mounted ? revealStep : undefined}
        inert={mounted && !ready ? true : undefined}
      >
        {children}
      </div>
      {enabled && surface && (
        <GraphicsBoundary onFailure={fail}>
          <Suspense fallback={null}>
            <Scene
              surface={surface}
              theme={theme}
              level={level}
              ready={ready}
              phase={phase}
              phaseState={phaseRef}
              bootProgress={bootProgress}
              phaseProgress={phaseProgress}
              revealStep={revealStep}
              progress={progress}
              pointer={pointer}
              reducedMotion={reducedMotion}
              foregroundMode={previewMode ?? "binary"}
              portalShape={portalShape}
              onInitialized={onInitialized}
              onFailure={fail}
            />
          </Suspense>
        </GraphicsBoundary>
      )}
      {enabled && renderer !== "initializing" && surface && (phase === "reveal" || ready) && (
        <NativeImageLayer surface={surface} />
      )}
      {(phase === "boot" || phase === "resume") && (
        <div className="stage-boot-status" role="status" aria-live="polite">
          <span>
            {renderer === "initializing"
              ? "正在初始化显示设备"
              : bootPercent < 45
                ? "正在检查内存与硬件"
                : bootPercent < 85
                  ? `正在加载 ${siteTitle}`
                  : "系统就绪"}
          </span>
          <span aria-hidden="true">
            {String(bootPercent).padStart(3, "0")}%
          </span>
        </div>
      )}
      {heroVisible && (
        <section
          ref={hero}
          className="stage-hero"
          aria-label="个人计算机介绍"
          style={{
            opacity: heroOpacity,
            transform: `translateY(${phase === "pullback" ? (1 - heroOpacity) * 14 : -Math.min(percent, 32)}px)`,
          }}
          inert={!heroInteractive ? true : undefined}
        >
          <h1 aria-label={heroLines.join("")} data-custom-title={Boolean(heroTitle?.trim()) || undefined}>
            {heroLines.map((line, row) => (
              <span className="stage-hero-line" aria-hidden="true" key={row}>
                {[...line].map((character, index) => (
                  <span className="stage-hero-glyph" key={index} style={{ "--glyph-order": row * 4 + index } as CSSProperties}>
                    {character}
                  </span>
                ))}
              </span>
            ))}
          </h1>
          <p className="stage-scroll-hint">
            <span>滚动进入这台电脑</span>
            <svg className="stage-scroll-arrow" aria-hidden="true" focusable="false" viewBox="0 0 20 36">
              <path d="M10 2C9 11 11 20 10 32M3 24L10 32L17 24" />
            </svg>
          </p>
        </section>
      )}
      {["pullback", "resume", "penetrate", "reveal"].includes(phase) && (
        <p className="stage-phase-status" role="status" aria-live="polite">
          {phase === "pullback" ? "正在展开个人计算机"
            : phase === "resume" ? `继续启动 ${siteTitle}`
              : phase === "penetrate" ? "正在进入显示屏"
                : `正在建立终端 ${revealStep} / ${REVEAL_GROUP_COUNT}`}
        </p>
      )}
      {import.meta.env.DEV && previewMode && <ForegroundPreview
        mode={previewMode}
        shape={portalShape}
        onShape={selectPortalShape}
        percent={percent}
        available={enabled && renderer !== "initializing" && !reducedMotion}
        onMode={selectPreview}
        onSeek={seekPreview}
        onReplay={() => { previewStarted.current = true; window.dispatchEvent(new Event("hadesd:reboot")); }}
      />}
      <noscript>
        <style>{`.terminal-stage{position:relative!important;height:auto!important;overflow:visible!important;padding:30px!important}.stage-content{position:relative!important;inset:auto!important;opacity:1!important;pointer-events:auto!important}.stage-phase-status,.stage-boot-status,.stage-hero,.stage-scroll-hint,.stage-masthead,.stage-ambient,.stage-graphics,.stage-crt-startup{display:none!important}html,body{height:auto!important;overflow:auto!important}`}</style>
      </noscript>
    </div>
  );
}
