import { afterEach, describe, expect, it, vi } from "vitest";
import { InspectorBase, Node, NodeFrame, NodeUpdateType } from "three/webgpu";
import Info from "three/src/renderers/common/Info.js";
// This pinned internal module has no declaration in @types/three 0.185.4.
// @ts-expect-error Three's internal animation is intentionally untyped.
import Animation from "three/src/renderers/common/Animation.js";
import { takeFiberClock } from "./fiberRendererClock";

function fixture() {
  const scheduled = new Map<number, FrameRequestCallback>();
  let next = 0;
  const renderer = {
    _initialized: true,
    _inspector: new InspectorBase() as InspectorBase & { isRunning: boolean },
    _nodes: { nodeFrame: new NodeFrame() as NodeFrame & { lastTime: number } },
    info: new Info(),
    xr: { enabled: false, isPresenting: false },
    _animation: null as unknown as InstanceType<typeof Animation>,
  };
  renderer._animation = new Animation(renderer, renderer._nodes, renderer.info);
  renderer._animation.setContext({
    requestAnimationFrame(callback: FrameRequestCallback) {
      scheduled.set(++next, callback);
      return next;
    },
    cancelAnimationFrame(id: number) { scheduled.delete(id); },
  });
  renderer._animation.start();
  return { renderer, scheduled };
}

afterEach(() => vi.restoreAllMocks());

describe("Fiber renderer clock", () => {
  it("removes the otherwise idle Three RAF and never advances nodes without a submitted frame", () => {
    const { renderer, scheduled } = fixture();
    expect(scheduled.size).toBe(1);
    renderer._animation.setAnimationLoop(null);
    expect(scheduled.size).toBe(1);
    const frameId = renderer._nodes.nodeFrame.frameId;
    const clock = takeFiberClock(renderer);
    expect(clock.owned).toBe(true);
    expect(scheduled.size).toBe(0);
    expect(renderer._inspector.isRunning).toBe(false);
    expect(takeFiberClock(renderer)).toBe(clock);
    expect(renderer._nodes.nodeFrame.frameId).toBe(frameId);
  });

  it("keeps FRAME nodes current across pipeline frames without updating twice inside one frame", () => {
    const { renderer } = fixture();
    const clock = takeFiberClock(renderer);
    const node = new Node();
    node.updateType = NodeUpdateType.FRAME;
    let updates = 0;
    node.update = () => { updates++; };
    const nodeFrame = renderer._nodes.nodeFrame;
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    nodeFrame.lastTime = 900;
    const initial = nodeFrame.frameId;
    for (let index = 0; index < 2; index++) {
      renderer.info.render.drawCalls = 25;
      clock.beginFrame();
      expect(renderer.info.render.drawCalls).toBe(0);
      expect(renderer.info.frame).toBe(initial + index + 1);
      expect(renderer._inspector.isRunning).toBe(true);
      nodeFrame.updateNode(node);
      nodeFrame.updateNode(node);
      expect(updates).toBe(index + 1);
      clock.endFrame();
      expect(renderer._inspector.isRunning).toBe(false);
      now += 100;
    }
    expect(nodeFrame.deltaTime).toBeCloseTo(0.1);
    expect(nodeFrame.time).toBeGreaterThanOrEqual(0.2);
  });

  it("preserves explicit accumulated counters and leaves an uninitialized renderer available for later adoption", () => {
    const { renderer, scheduled } = fixture();
    renderer._initialized = false;
    expect(takeFiberClock(renderer).owned).toBe(false);
    expect(scheduled.size).toBe(1);
    renderer._initialized = true;
    renderer.info.autoReset = false;
    renderer.info.render.drawCalls = 25;
    const clock = takeFiberClock(renderer);
    clock.beginFrame();
    expect(renderer.info.render.drawCalls).toBe(25);
    clock.endFrame();
    expect(scheduled.size).toBe(0);
  });

  it("leaves XR, user animation loops and unsupported private shapes on the original scheduler", () => {
    for (const change of [
      (renderer: ReturnType<typeof fixture>["renderer"]) => { renderer.xr.enabled = true; },
      (renderer: ReturnType<typeof fixture>["renderer"]) => { renderer._animation.setAnimationLoop(() => {}); },
      (renderer: ReturnType<typeof fixture>["renderer"]) => { Object.assign(renderer._nodes, { nodeFrame: {} }); },
    ]) {
      const { renderer, scheduled } = fixture();
      change(renderer);
      const clock = takeFiberClock(renderer);
      expect(clock.owned).toBe(false);
      clock.beginFrame();
      clock.endFrame();
      expect(scheduled.size).toBe(1);
      renderer._animation.stop();
    }
  });
});
