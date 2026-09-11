import { expect, it } from "vitest";
import { createComputerGeometry, RETRO_COMPUTER_BOUNDS, RETRO_COMPUTER_FLOOR_Y,
  RETRO_GROUND_FOOTPRINTS } from "./computerGeometry";
import { fogVolumeLayout } from "./atmosphereVolume";

it("keeps the low volume below physical keys and the rear volume behind the complete computer", () => {
  const geometry = createComputerGeometry();
  try {
    geometry.keys.computeBoundingBox();
    for (const mobile of [false, true]) for (const level of ["full", "low"] as const) {
      const { low, rear } = fogVolumeLayout(level, mobile);
      expect(RETRO_COMPUTER_FLOOR_Y + low.center[1] + low.size[1] / 2)
        .toBeLessThan(geometry.keys.boundingBox!.min.y - .06);
      expect(rear.center[2] + rear.size[2] / 2).toBeLessThan(RETRO_COMPUTER_BOUNDS.min[2] - .3);
      expect(rear.center[1] + rear.size[1] / 2)
        .toBeGreaterThan(RETRO_COMPUTER_BOUNDS.max[1] - RETRO_COMPUTER_FLOOR_Y + .1);
      expect(low.center[1] - low.size[1] / 2).toBeGreaterThan(0);
    }
  } finally { Object.values(geometry).forEach(part => part.dispose()); }
});

it("retains three independent footprints and an open gap between keyboard and mouse", () => {
  expect(RETRO_GROUND_FOOTPRINTS.map(footprint => footprint.name).sort()).toEqual(["chassis", "keyboard", "mouse"]);
  const keyboard = RETRO_GROUND_FOOTPRINTS.find(footprint => footprint.name === "keyboard")!;
  const mouse = RETRO_GROUND_FOOTPRINTS.find(footprint => footprint.name === "mouse")!;
  const gapX = (keyboard.center[0] + keyboard.halfSize[0] + mouse.center[0] - mouse.halfSize[0]) / 2;
  const gapZ = (keyboard.center[1] + mouse.center[1]) / 2;
  for (const footprint of RETRO_GROUND_FOOTPRINTS) {
    const x = gapX - footprint.center[0], z = gapZ - footprint.center[1];
    const localX = x * Math.cos(footprint.yaw) - z * Math.sin(footprint.yaw);
    const localZ = x * Math.sin(footprint.yaw) + z * Math.cos(footprint.yaw);
    // The union must not turn the empty space into a single large cutout.
    expect(Math.hypot(Math.max(0, Math.abs(localX) - footprint.halfSize[0]),
      Math.max(0, Math.abs(localZ) - footprint.halfSize[1]))).toBeGreaterThan(.06);
  }
});

it("bounds ray steps and reduces both coverage and samples for mobile and Low", () => {
  const desktop = fogVolumeLayout("full", false), mobile = fogVolumeLayout("full", true);
  const low = fogVolumeLayout("low", false), mobileLow = fogVolumeLayout("low", true);
  expect(desktop.steps).toBeLessThanOrEqual(16);
  expect(mobile.steps).toBeLessThan(desktop.steps);
  expect(low.steps).toBeLessThanOrEqual(8);
  expect(mobileLow.steps).toBeLessThan(low.steps);
  expect(mobile.low.size[0] * mobile.low.size[2]).toBeLessThan(desktop.low.size[0] * desktop.low.size[2]);
  expect(mobile.rear.size[0] * mobile.rear.size[2]).toBeLessThan(desktop.rear.size[0] * desktop.rear.size[2]);
});
