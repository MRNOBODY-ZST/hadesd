import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CrtLevel, Theme } from "@hadesd/contracts";
import {
  clampProgress,
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
}: {
  children: ReactNode;
  theme: Theme;
  level: CrtLevel;
}) {
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
  const phaseRef = useRef<IntroPhase>("boot");
  const bootProgress = useRef(0);
  const phaseProgress = useRef(0);
  const revealSchedule = useRef<number[]>([]);
  const progress = useRef(0);
  const destination = useRef(0);
  const animation = useRef<number | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
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
      revealSchedule.current = createRevealSchedule();
      setRevealStep(0);
    }
    phaseRef.current = next;
    setPhase(next);
  }, []);
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
      changePhase(phaseForJourney(next));
      if (next === 1) return;
      if (next !== destination.current)
        animation.current = requestAnimationFrame(tick);
    };
    animation.current = requestAnimationFrame(tick);
  }, [changePhase]);
  const advance = useCallback(
    (delta: number) => {
      if (phaseRef.current !== "hero" && phaseRef.current !== "journey") return;
      destination.current = clampProgress(destination.current + delta);
      animateJourney();
    },
    [animateJourney],
  );

  useEffect(() => {
    setMounted(true);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    const move = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / innerWidth) * 2 - 1;
      pointer.current.y = 1 - (event.clientY / innerHeight) * 2;
    };
    const reboot = () => {
      if (animation.current !== null) cancelAnimationFrame(animation.current);
      animation.current = null;
      destination.current = 0;
      progress.current = 0;
      bootProgress.current = 0;
      phaseProgress.current = 0;
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
    };
  }, [changePhase]);

  useEffect(() => {
    if (!mounted) return;
    if (level === "off" || failed || reducedMotion) {
      finish();
      return;
    }
    if (!isTimedPhase(phase) || renderer === "initializing") return;
    const started = performance.now();
    const duration = timedPhaseDuration(phase, revealSchedule.current);
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = now - started;
      const next = clampProgress(elapsed / duration);
      phaseProgress.current = next;
      setPhasePercent(Math.floor(next * 100));
      if (phase === "boot" || phase === "resume") {
        const boot = phase === "boot" ? next * 0.8 : 0.8 + next * 0.2;
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
    const wheel = (event: WheelEvent) => {
      if (phaseRef.current !== "hero" && phaseRef.current !== "journey") return;
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      advance(wheelStep(event.deltaY, event.deltaMode, innerHeight));
    };
    let previousTouch: number | null = null;
    const touchStart = (event: TouchEvent) => {
      previousTouch =
        event.touches.length === 1 ? event.touches[0]!.clientY : null;
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
      if (phaseRef.current === "terminal" || event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        finish();
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
        finish();
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
  }, [advance, finish]);

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
      data-phase-progress={phasePercent}
      data-reveal-step={revealStep}
      data-renderer={activeRenderer}
      data-graphics={enabled && renderer !== "initializing" ? "true" : "false"}
      data-stage-theme={theme}
    >
      <div className="stage-ambient" aria-hidden="true" />
      <div className="stage-masthead">
        <span>
          HADESD<span className="stage-dot">®</span>
        </span>
        <span>PERSONAL COMPUTING / EST. 2026</span>
      </div>
      <div className="stage-physical-frame" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
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
                  ? "正在加载 HADESD 系统"
                  : "系统就绪"}
          </span>
          <span aria-hidden="true">
            {String(bootPercent).padStart(3, "0")}%
          </span>
        </div>
      )}
      {heroVisible && (
        <section
          className="stage-hero"
          aria-label="个人计算机介绍"
          style={{
            opacity: heroOpacity,
            transform: `translateY(${phase === "pullback" ? (1 - heroOpacity) * 14 : -Math.min(percent, 32)}px)`,
          }}
          inert={!heroInteractive ? true : undefined}
        >
          <p className="stage-hero-eyebrow">PERSONAL COMPUTING</p>
          <h1>
            从一行代码，
            <br />
            到一个完整世界。
          </h1>
          <p className="stage-hero-copy">
            拆开硬件，理解每一次运转。
            <br />
            写下软件，让想法在现实中发生。
          </p>
          <button className="stage-enter" onClick={() => advance(1)}>
            进入终端 <span aria-hidden="true">↗</span>
          </button>
        </section>
      )}
      {heroVisible && (
        <p
          className="stage-scroll-hint"
          style={{ opacity: heroOpacity }}
          inert={!heroInteractive ? true : undefined}
        >
          <span aria-hidden="true">↓</span> 滚动进入这台电脑{" "}
          <span className="stage-scroll-keys">/ SCROLL TO EXPLORE</span>
        </p>
      )}
      {phase === "journey" && (
        <div className="stage-journey-status" aria-live="off">
          <span>
            {percent < 35
              ? "靠近个人计算机"
              : percent < 75
                ? "穿过电路与指令"
                : "返回启动屏幕"}
          </span>
          <span>{String(percent).padStart(3, "0")} / 100</span>
        </div>
      )}
      {["pullback", "resume", "penetrate", "reveal"].includes(phase) && (
        <p className="stage-phase-status" role="status" aria-live="polite">
          {phase === "pullback" ? "正在展开个人计算机"
            : phase === "resume" ? "继续启动 HADESD 系统"
              : phase === "penetrate" ? "正在进入显示屏"
                : `正在建立终端 ${revealStep} / ${REVEAL_GROUP_COUNT}`}
        </p>
      )}
      {!ready && (
        <button
          className="stage-skip"
          onClick={finish}
          aria-label="跳过片头，进入终端"
        >
          SKIP INTRO <span aria-hidden="true">↵</span>
        </button>
      )}
      <div className="stage-base" aria-hidden="true">
        <span>
          <i />{" "}
          {ready
            ? "SYSTEM ONLINE"
            : phase === "boot" || phase === "resume"
              ? "BOOTING HADESD"
              : "BUILT WITH CURIOSITY"}
        </span>
        <span>{ready ? "A PERSONAL DAEMON." : "HARDWARE × SOFTWARE"}</span>
        <span>
          {activeRenderer === "initializing"
            ? "DISPLAY INIT"
            : activeRenderer.toUpperCase()}
        </span>
      </div>
      <noscript>
        <style>{`.terminal-stage{position:relative!important;height:auto!important;overflow:visible!important;padding:30px!important}.stage-content{position:relative!important;inset:auto!important;opacity:1!important;pointer-events:auto!important}.stage-phase-status,.stage-boot-status,.stage-hero,.stage-scroll-hint,.stage-journey-status,.stage-skip,.stage-physical-frame,.stage-masthead,.stage-base,.stage-ambient,.stage-graphics{display:none!important}html,body{height:auto!important;overflow:auto!important}`}</style>
      </noscript>
    </div>
  );
}
