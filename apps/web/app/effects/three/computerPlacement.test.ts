import { describe, expect, it } from "vitest";
import { Box3, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { computerGroundHeight, computerLens } from "./computerPlacement";

describe("computer support plane", () => {
  const bounds = { min: [-2.35, -1.62, -1.15], max: [2.35, 2.12, 2.65] } as const;
  it("keeps a yawing computer on its feet at every presentation scale", () => {
    for (const scale of [.36, .9, 1.25]) {
      const rotation = new Quaternion().setFromEuler(new Euler(0, -.43, 0));
      expect(computerGroundHeight(bounds, 1.2, rotation, scale)).toBeCloseTo(1.2 - 1.62 * scale);
    }
  });
  it("contains the entire transformed model when the view is tilted", () => {
    const position = new Vector3(2.8, .4, -.2), scale = .86;
    const rotation = new Quaternion().setFromEuler(new Euler(.11, -.6, .025));
    const world = new Matrix4().compose(position, rotation, new Vector3(scale, scale, scale));
    const expected = new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max)).applyMatrix4(world);
    expect(computerGroundHeight(bounds, position.y, rotation, scale)).toBeCloseTo(expected.min.y, 10);
    expect(computerGroundHeight(bounds, position.y, rotation, scale)).toBeLessThan(position.y + bounds.min[1] * scale);
  });
});

describe("wide computer lens", () => {
  it("returns to the original lens at the screen handoff", () => {
    expect(computerLens(0)).toEqual({ fov: 44, distance: 11 });
  });
  it("widens perspective without changing the z=0 screen framing", () => {
    const originalHeight = 2 * 11 * Math.tan(22 * Math.PI / 180);
    for (const progress of [.01, .2, .5, .9, 1]) {
      const { fov, distance } = computerLens(progress);
      expect(2 * distance * Math.tan(fov * Math.PI / 360)).toBeCloseTo(originalHeight, 10);
    }
    const wide = computerLens(1);
    expect(wide.fov).toBe(52);
    expect(wide.distance).toBeLessThan(10);
  });
});
