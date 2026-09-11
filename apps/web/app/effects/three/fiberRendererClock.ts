import { REVISION } from "three/webgpu";

export interface FiberRendererClock {
  readonly owned: boolean;
  beginFrame(): void;
  endFrame(): void;
}

interface RendererInternals {
  _initialized: boolean;
  _animation: { stop(): void; getAnimationLoop(): unknown };
  _nodes: { nodeFrame: { frameId: number; update(): void } };
  _inspector: { isRunning: boolean; begin(): void; finish(): void };
  info: { autoReset: boolean; frame: number; reset(): void };
  xr: { enabled: boolean; isPresenting: boolean };
}

const clocks = new WeakMap<object, FiberRendererClock>();
const unmanaged: FiberRendererClock = { owned: false, beginFrame() {}, endFrame() {} };

/**
 * Three 0.186.0's Renderer.init starts Animation even with a null user loop.
 * Fiber already schedules this non-XR scene, so adopt the internal clock once
 * and advance FRAME nodes only when submitting an actual pipeline frame.
 * Keep this adapter pinned: audit common/Animation.js on every Three upgrade.
 * Call beginFrame before any offscreen or reflection passes, and endFrame in
 * finally. Renderer.dispose owns final cleanup; this adapter never restarts RAF.
 */
export function takeFiberClock(renderer: object): FiberRendererClock {
  const existing = clocks.get(renderer);
  if (existing) return existing;
  const candidate = renderer as Partial<RendererInternals>;
  if (
    REVISION !== "186" || candidate._initialized !== true ||
    candidate.xr?.enabled !== false || candidate.xr?.isPresenting !== false ||
    typeof candidate._animation?.stop !== "function" ||
    typeof candidate._animation?.getAnimationLoop !== "function" ||
    typeof candidate._nodes?.nodeFrame?.update !== "function" ||
    !Number.isFinite(candidate._nodes?.nodeFrame?.frameId) ||
    typeof candidate._inspector?.begin !== "function" ||
    typeof candidate._inspector?.finish !== "function" ||
    typeof candidate._inspector?.isRunning !== "boolean" ||
    typeof candidate.info?.reset !== "function" ||
    typeof candidate.info?.autoReset !== "boolean" ||
    !Number.isFinite(candidate.info?.frame) ||
    candidate._animation.getAnimationLoop() !== null
  ) return unmanaged;

  const { _animation, _nodes, _inspector, info } = candidate as RendererInternals;
  _animation.stop();
  const clock: FiberRendererClock = {
    owned: true,
    beginFrame() {
      if (_inspector.isRunning) _inspector.finish();
      if (info.autoReset) info.reset();
      _nodes.nodeFrame.update();
      info.frame = _nodes.nodeFrame.frameId;
      _inspector.begin();
    },
    endFrame() {
      if (_inspector.isRunning) _inspector.finish();
    },
  };
  clocks.set(renderer, clock);
  return clock;
}

export const createFiberRendererClock = takeFiberClock;
