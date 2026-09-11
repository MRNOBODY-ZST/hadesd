import { BackSide, MeshBasicNodeMaterial, type Node } from "three/webgpu";
import { RaymarchingBox } from "three/addons/tsl/utils/Raymarching.js";
import { Fn, cameraPosition, float, floor, fract, length, max, mix, modelWorldMatrix,
  modelWorldMatrixInverse, positionGeometry, screenCoordinate, smoothstep, vec2, vec3, vec4 } from "three/tsl";
import type { CrtLevel } from "@hadesd/contracts";
import { RETRO_COMPUTER_BOUNDS, RETRO_COMPUTER_FLOOR_Y, RETRO_GROUND_FOOTPRINTS } from "./computerGeometry";

type Box = { center: [number, number, number]; size: [number, number, number] };

/** All dimensions are relative to the computer's ground origin and scale. */
export function fogVolumeLayout(level: CrtLevel, mobile: boolean): { steps: number; low: Box; rear: Box } {
  const rearDepth = mobile ? 4.7 : 5.3;
  const rearTop = RETRO_COMPUTER_BOUNDS.max[1] - RETRO_COMPUTER_FLOOR_Y + .22;
  return {
    steps: level === "full" ? (mobile ? 10 : 16) : (mobile ? 6 : 8),
    low: { center: [0, .085, 1.1], size: [mobile ? 12 : 20, .13, mobile ? 10 : 15] },
    rear: { center: [0, (rearTop + .1) / 2, RETRO_COMPUTER_BOUNDS.min[2] - .5 - rearDepth / 2],
      size: [mobile ? 10 : 16, rearTop - .1, rearDepth] },
  };
}

function footprintPosition(point: Node<"vec2">, footprint: typeof RETRO_GROUND_FOOTPRINTS[number]) {
  const p = point.sub(vec2(...footprint.center));
  const c = Math.cos(footprint.yaw), s = Math.sin(footprint.yaw);
  return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
}

/** Three independent supports, including the mouse's local yaw. */
export function classicContactShadow(point: Node<"vec2">) {
  let contact: Node<"float"> = float(0);
  for (const footprint of RETRO_GROUND_FOOTPRINTS) {
    const radius = length(footprintPosition(point, footprint).div(vec2(...footprint.halfSize)));
    const strength = footprint.name === "chassis" ? 1 : footprint.name === "keyboard" ? .82 : .72;
    contact = contact.max(float(1).sub(smoothstep(.38, 1.28, radius)).mul(strength));
  }
  return contact;
}

/** Leave the spaces between peripherals open instead of clearing one large box. */
export function classicFogClearance(point: Node<"vec2">) {
  let clearance: Node<"float"> = float(1);
  for (const footprint of RETRO_GROUND_FOOTPRINTS) {
    const outside = length(footprintPosition(point, footprint).abs().sub(vec2(...footprint.halfSize)).max(0));
    clearance = clearance.min(smoothstep(.015, footprint.name === "chassis" ? .24 : .15, outside));
  }
  return clearance;
}

// Polynomial hash avoids a sine for every corner of every ray sample.
const hash3 = Fn(([point]: [Node<"vec3">]) => {
  const p = fract(point.mul(vec3(.1031, .1030, .0973))).toVar();
  p.addAssign(p.dot(p.yzx.add(33.33)));
  return fract(p.x.add(p.y).mul(p.z));
}).setLayout({ name: "hadesdFogHash3", type: "float", inputs: [{ name: "point", type: "vec3" }] });

const noise3 = Fn(([point]: [Node<"vec3">]) => {
  const cell = floor(point).toVar(), f = fract(point).toVar();
  const w = f.mul(f).mul(float(3).sub(f.mul(2))).toVar();
  return mix(
    mix(mix(hash3(cell), hash3(cell.add(vec3(1, 0, 0))), w.x),
      mix(hash3(cell.add(vec3(0, 1, 0))), hash3(cell.add(vec3(1, 1, 0))), w.x), w.y),
    mix(mix(hash3(cell.add(vec3(0, 0, 1))), hash3(cell.add(vec3(1, 0, 1))), w.x),
      mix(hash3(cell.add(vec3(0, 1, 1))), hash3(cell.add(vec3(1, 1, 1))), w.x), w.y), w.z);
}).setLayout({ name: "hadesdFogNoise3", type: "float", inputs: [{ name: "point", type: "vec3" }] });

interface FogUniforms {
  clock: Node<"float">; opacity: Node<"float">; computer: Node<"vec3">;
  heading: Node<"vec2">; floorHeight: Node<"float">; steps: Node<"float">;
}

/** Two boxes share this bounded raymarch graph, with no offscreen scene pass.
 * Three r186 RaymarchingBox intersects the unit box and steps at most `steps`
 * times. Its helper uses modelWorldMatrixInverse/cameraPosition, so parallax
 * and the reflected camera both integrate their own actual ray through fog.
 */
export function createFogVolumeMaterial(kind: "low" | "rear", u: FogUniforms) {
  const material = new MeshBasicNodeMaterial();
  material.name = `World volume / ${kind} drifting fog`;
  material.transparent = true;
  material.side = BackSide;
  material.depthTest = true;
  material.depthWrite = false;
  material.colorNode = Fn(() => {
    const transmittance = float(1).toVar(), radiance = vec3(0).toVar();
    const origin = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
    const direction = positionGeometry.sub(origin).normalize().toVar();
    // Matches RaymarchingBox's step interval. @types/three 185 omits stepSize
    // from its callback type although the pinned r186 implementation passes it.
    const stepSize = max(direction.x.abs(), max(direction.y.abs(), direction.z.abs())).reciprocal().div(u.steps).toVar();
    const opticalStep = length(modelWorldMatrix.mul(vec4(direction.mul(stepSize), 0)).xyz).div(u.computer.z.max(.05)).toVar();
    const jitter = hash3(vec3(screenCoordinate, 17)).mul(.75).add(.125).toVar();
    RaymarchingBox(u.steps, ({ positionRay }) => {
      const sample = positionRay.add(direction.mul(stepSize).mul(jitter)).toVar();
      const world = modelWorldMatrix.mul(vec4(sample, 1)).xyz;
      const p = world.sub(vec3(u.computer.x, u.floorHeight, u.computer.y)).div(u.computer.z.max(.05)).toVar();
      const drift = vec3(u.clock.mul(p.y.mul(.045).add(.10)), u.clock.mul(.014),
        u.clock.mul(p.z.mul(.004).add(.033)));
      // Flatten the density cells vertically, not the volume itself: the ray
      // still travels through independent world depths and moving strata.
      const domain = p.mul(vec3(.50, kind === "low" ? 6.2 : 2.6, .79)).add(drift);
      const broad = noise3(domain).toVar();
      const middle = noise3(domain.mul(vec3(1.73, 2.13, 1.81))
        .add(vec3(broad.mul(.36), broad.sub(.5).mul(.64), 19))).toVar();
      const fine = noise3(domain.mul(vec3(3.61, 4.37, 3.23))
        .add(vec3(31, middle.sub(.5).mul(.78), broad.mul(.42)))).toVar();
      const density = smoothstep(.36, .77, broad.mul(.22).add(middle.mul(.43)).add(fine.mul(.35)))
        .mul(smoothstep(.20, .70, middle));
      const edge = float(1).sub(smoothstep(.12, .50, max(sample.x.abs(), sample.z.abs())))
        .mul(float(1).sub(smoothstep(.12, .50, sample.y.abs())));
      const localXZ = vec2(p.x.mul(u.heading.x).sub(p.z.mul(u.heading.y)),
        p.x.mul(u.heading.y).add(p.z.mul(u.heading.x)));
      const clearance = classicFogClearance(localXZ);
      const extinction = density.mul(edge).mul(clearance).mul(kind === "low" ? 1.65 : .46);
      const stepAlpha = float(1).sub(extinction.mul(opticalStep).negate().exp());
      const light = mix(vec3(.158, .140, .128), vec3(.131, .121, .148), fine)
        .mul(float(.56).add(middle.mul(.54)));
      radiance.addAssign(light.mul(stepAlpha).mul(transmittance));
      transmittance.mulAssign(float(1).sub(stepAlpha));
    });
    const alpha = float(1).sub(transmittance);
    // A hard alpha ceiling made denser regions equally opaque, erasing their
    // structure into bright sheets. Preserve the continuous optical depth.
    return vec4(radiance.div(alpha.max(.0001)), alpha.mul(kind === "low" ? .78 : .72).mul(u.opacity));
  })();
  return material;
}
