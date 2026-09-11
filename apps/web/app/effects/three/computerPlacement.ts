type Bounds = { min: readonly [number, number, number]; max: readonly [number, number, number] };
type Rotation = { x: number; y: number; z: number; w: number };

/** Dolly as the lens widens, so the screen's handoff plane keeps its framing. */
export function computerLens(presentation: number) {
  const framed = Math.max(0, Math.min(1, presentation));
  const fov = 44 + 8 * framed;
  const distance = framed === 0 ? 11 : 11 * Math.tan(22 * Math.PI / 180) / Math.tan(fov * Math.PI / 360);
  return { fov, distance };
}

/** Lowest support of the transformed bounds, including pitch/roll if introduced later. */
export function computerGroundHeight(bounds: Bounds, worldY: number, q: Rotation, scale: number) {
  const rx = 2 * (q.x * q.y + q.w * q.z);
  const ry = 1 - 2 * (q.x * q.x + q.z * q.z);
  const rz = 2 * (q.y * q.z - q.w * q.x);
  return worldY + scale * (
    rx * bounds[rx < 0 ? "max" : "min"][0]
    + ry * bounds[ry < 0 ? "max" : "min"][1]
    + rz * bounds[rz < 0 ? "max" : "min"][2]
  );
}
