import { expect, it, vi } from "vitest";
import { BackSide, PerspectiveCamera } from "three/webgpu";
import { createAtmosphereResources } from "./atmosphereResources";

it("constructs procedural atmosphere without a Canvas or uploaded bitmap", () => {
  const createElement = vi.spyOn(document, "createElement");
  const resources = createAtmosphereResources();
  expect(createElement).not.toHaveBeenCalled();
  expect(resources.background.colorNode).toBeDefined();
  expect(resources.ground.colorNode).toBeDefined();
  resources.dispose();
  createElement.mockRestore();
});

it("keeps the floor behind opaque geometry and out of the depth buffer", () => {
  const resources = createAtmosphereResources();
  expect(resources.ground.transparent).toBe(true);
  expect(resources.ground.depthTest).toBe(true);
  expect(resources.ground.depthWrite).toBe(false);
  expect(resources.background.transparent).toBe(false);
  expect(resources.background.depthTest).toBe(true);
  expect(resources.background.depthWrite).toBe(false);
  expect(resources.reflection.reflector.bounces).toBe(false);
  for (const volume of [resources.lowFog, resources.rearFog]) {
    expect(volume.side).toBe(BackSide);
    expect(volume.transparent).toBe(true);
    expect(volume.depthTest).toBe(true);
    expect(volume.depthWrite).toBe(false);
  }
  resources.dispose();
});

it("releases the real reflection render target and both materials", () => {
  const resources = createAtmosphereResources();
  const target = resources.reflection.reflector.getRenderTarget(new PerspectiveCamera());
  const targetDisposed = vi.fn(), backgroundDisposed = vi.fn(), floorDisposed = vi.fn();
  const lowDisposed = vi.fn(), rearDisposed = vi.fn();
  target.addEventListener("dispose", targetDisposed);
  resources.background.addEventListener("dispose", backgroundDisposed);
  resources.ground.addEventListener("dispose", floorDisposed);
  resources.lowFog.addEventListener("dispose", lowDisposed);
  resources.rearFog.addEventListener("dispose", rearDisposed);
  resources.dispose();
  expect(targetDisposed).toHaveBeenCalledOnce();
  expect(backgroundDisposed).toHaveBeenCalledOnce();
  expect(floorDisposed).toHaveBeenCalledOnce();
  expect(lowDisposed).toHaveBeenCalledOnce();
  expect(rearDisposed).toHaveBeenCalledOnce();
});
