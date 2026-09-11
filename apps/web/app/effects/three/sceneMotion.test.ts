import { expect, it } from "vitest";
import { sceneMotion, scenePixelRatio } from "./sceneMotion";
import { MAC_SCREEN_HANDOFF } from "./screenProjection";

it("keeps the physical screen and material continuous at timed boundaries", () => {
  expect(sceneMotion("boot", 1, 0).framed).toBe(sceneMotion("pullback", 0, 0).framed);
  const end = sceneMotion("pullback", 1, 0), hero = sceneMotion("hero", 0, 0);
  expect(end.framed).toBe(hero.framed);
  expect(end.bootMix).toBe(hero.bootMix);
  expect(sceneMotion("journey", 0, MAC_SCREEN_HANDOFF).framed).toBe(0);
});
it("overlaps the boot light with terminal acquisition and settles without an effect jump", () => {
  expect(sceneMotion("journey", 0, 1).bootMix).toBe(1);
  expect(sceneMotion("resume", 0, 1).bootMix).toBe(1);
  for (let i = 0; i <= 100; i++) {
    const s = sceneMotion("penetrate", i / 100, 1);
    expect(s.bootMix).toBe(1);
    expect(s.bootAlpha + s.terminalAlpha).toBeGreaterThanOrEqual(.95);
    expect(s.burst).toBeGreaterThanOrEqual(0);
    expect(s.burst).toBeLessThanOrEqual(1);
  }
  expect(sceneMotion("penetrate", 1, 1).terminalAlpha).toBe(1);
  expect(sceneMotion("reveal", 0, 1).terminalAlpha).toBe(1);
  expect(sceneMotion("terminal", 1, 1).burst).toBe(0);
});
it("bounds physical render pixels on HiDPI and ultrawide screens", () => {
  for (const [w, h, dpr] of [[3840, 2160, 2], [1440, 900, 1.5], [390, 844, 3]]) {
    const ratio = scenePixelRatio(w!, h!, dpr!);
    expect(w! * h! * ratio * ratio).toBeLessThanOrEqual(2_300_001);
    expect(ratio).toBeLessThanOrEqual(dpr!);
    expect(ratio).toBeGreaterThan(0);
  }
});
it("enters the returning screen monotonically without a squeeze or glitch burst", () => {
  let previousDepth = 0;
  for (let i = 0; i <= 100; i++) {
    const motion = sceneMotion("penetrate", i / 100, 1);
    expect(motion.entryDepth).toBeGreaterThanOrEqual(previousDepth);
    expect(motion.entryDepth).toBeLessThan(11);
    expect(motion.burst).toBe(0);
    previousDepth = motion.entryDepth;
  }
  expect(previousDepth).toBeGreaterThan(9);
});
it("fades the world into pure black around full-screen CRT stages", () => {
  for (const phase of ["boot", "resume", "penetrate", "reveal", "terminal"] as const) {
    expect(sceneMotion(phase, .5, 1).worldAlpha).toBe(0);
  }
  expect(sceneMotion("pullback", 0, 0).worldAlpha).toBe(0);
  expect(sceneMotion("pullback", 1, 0).worldAlpha).toBe(1);
  expect(sceneMotion("journey", 0, 0).worldAlpha).toBe(1);
  expect(sceneMotion("journey", 0, MAC_SCREEN_HANDOFF).worldAlpha).toBe(0);
  expect(sceneMotion("journey", 0, 1).worldAlpha).toBe(0);
});
