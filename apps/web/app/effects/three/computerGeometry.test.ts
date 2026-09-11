import { Box3, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { RETRO_MAC_SCREEN } from "./RetroMac";
import { createComputerGeometry, RETRO_COMPUTER_BOUNDS, RETRO_COMPUTER_FLOOR_Y, RETRO_GROUND_FOOTPRINTS } from "./computerGeometry";

describe("classic compact computer geometry", () => {
  it("preserves the screen contract used by the camera and first carousel tile", () => {
    expect(RETRO_MAC_SCREEN).toEqual({ center: [0, .65, 1.06], width: 2.7, height: 2.05,
      bounds: { left: -1.35, right: 1.35, bottom: -.375, top: 1.675 } });
  });

  it("grounds the chassis, detached keyboard and mouse on the same physical plane", () => {
    const geometries = createComputerGeometry();
    try {
      expect(RETRO_COMPUTER_FLOOR_Y).toBe(-2.375);
      for (const [name, geometry] of Object.entries(geometries)) {
        geometry.computeBoundingBox();
        expect(geometry.boundingBox!.min.y, name).toBeGreaterThanOrEqual(RETRO_COMPUTER_FLOOR_Y - 1e-6);
      }
      for (const name of ["feet", "keyboardCase", "mouseCase"] as const) {
        expect(geometries[name].boundingBox!.min.y, name).toBeCloseTo(RETRO_COMPUTER_FLOOR_Y, 6);
      }
      expect(geometries.keys.boundingBox!.min.y).toBeGreaterThan(RETRO_COMPUTER_FLOOR_Y + .20);
    } finally { Object.values(geometries).forEach(geometry => geometry.dispose()); }
  });

  it("exposes the complete physical bounds including the raised peripherals and cables", () => {
    const geometries = createComputerGeometry();
    try {
      const bounds = new Box3();
      for (const geometry of Object.values(geometries)) {
        geometry.computeBoundingBox(); bounds.union(geometry.boundingBox!);
      }
      for (const [index, axis] of ["x", "y", "z"].entries()) {
        expect(bounds.min[axis as "x" | "y" | "z"]).toBeCloseTo(RETRO_COMPUTER_BOUNDS.min[index]!, 5);
        expect(bounds.max[axis as "x" | "y" | "z"]).toBeCloseTo(RETRO_COMPUTER_BOUNDS.max[index]!, 5);
      }
    } finally { Object.values(geometries).forEach(geometry => geometry.dispose()); }
  });

  it("keeps every CRT sample clear of the original open chassis and recessed bezel", () => {
    const geometries = createComputerGeometry();
    const material = new MeshBasicMaterial({ side: DoubleSide });
    try {
      for (const geometry of Object.values(geometries)) {
        const mesh = new Mesh(geometry, material);
        for (const x of [-1.24, 0, 1.24]) for (const y of [-.27, .65, 1.57]) {
          const ray = new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1), 0, 2 - RETRO_MAC_SCREEN.center[2]);
          expect(ray.intersectObject(mesh)).toHaveLength(0);
        }
      }
    } finally { material.dispose(); Object.values(geometries).forEach(geometry => geometry.dispose()); }
  });

  it("keeps classic exterior surfaces facing outward and the keyboard detached", () => {
    const geometries = createComputerGeometry();
    const material = new MeshBasicMaterial();
    try {
      for (const [name, origin, direction, axis, sign] of [
        ["chassis", [0, 4, 0], [0, -1, 0], "y", 1],
        ["chassis", [3, .65, 0], [-1, 0, 0], "x", 1],
        ["rear", [0, .65, -3], [0, 0, 1], "z", -1],
        ["keyboardCase", [-.34, 1, 2.03], [0, -1, 0], "y", 1],
        ["mouseCase", [1.86, 1, 1.8], [0, -1, 0], "y", 1],
      ] as const) {
        const hit = new Raycaster(new Vector3(...origin), new Vector3(...direction))
          .intersectObject(new Mesh(geometries[name], material))[0];
        expect(hit, name).toBeDefined();
        expect(hit!.face!.normal[axis] * sign, name).toBeGreaterThan(.5);
      }
      geometries.base.computeBoundingBox(); geometries.keyboardCase.computeBoundingBox();
      expect(geometries.keyboardCase.boundingBox!.min.z - geometries.base.boundingBox!.max.z).toBeGreaterThan(.1);
    } finally { material.dispose(); Object.values(geometries).forEach(geometry => geometry.dispose()); }
  });

  it("shares conservative oriented footprints containing each physical peripheral", () => {
    const geometries = createComputerGeometry();
    try {
      expect(RETRO_GROUND_FOOTPRINTS.map(part => part.name)).toEqual(["chassis", "keyboard", "mouse"]);
      for (const footprint of RETRO_GROUND_FOOTPRINTS) {
        const names = footprint.name === "chassis" ? ["chassis", "rear", "bezel", "base", "feet"] as const
          : footprint.name === "keyboard" ? ["keyboardCase", "keywell", "keys", "keyboardLed"] as const
          : ["mouseCase", "mouseButton", "mouseSeam"] as const;
        for (const name of names) {
          const positions = geometries[name].getAttribute("position");
          for (let i = 0; i < positions.count; i++) {
            const point = new Vector3(positions.getX(i) - footprint.center[0], 0, positions.getZ(i) - footprint.center[1])
              .applyAxisAngle(new Vector3(0, 1, 0), -footprint.yaw);
            expect(Math.abs(point.x), name).toBeLessThanOrEqual(footprint.halfSize[0] + 1e-6);
            expect(Math.abs(point.z), name).toBeLessThanOrEqual(footprint.halfSize[1] + 1e-6);
          }
        }
      }
    } finally { Object.values(geometries).forEach(geometry => geometry.dispose()); }
  });
});
