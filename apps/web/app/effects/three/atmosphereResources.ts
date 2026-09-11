import { MeshBasicNodeMaterial, Vector2, Vector3 } from "three/webgpu";
import { float, length, mix, positionWorld, reflector, smoothstep, uniform, vec2, vec3, vec4 } from "three/tsl";
import { mistNoise } from "./crtNodes";
import { classicContactShadow, createFogVolumeMaterial } from "./atmosphereVolume";
import { RETRO_GROUND_FOOTPRINTS } from "./computerGeometry";

export interface ComputerGround { x: number; z: number; scale: number; yaw?: number }

/** Static node graphs. Animation changes uniforms, never a Canvas or bitmap. */
export function createAtmosphereResources() {
  const clock = uniform(0);
  const opacity = uniform(1), computer = uniform(new Vector3(0, 0, 1));
  const heading = uniform(new Vector2(1, 0));
  const floorHeight = uniform(-3), steps = uniform(14);
  const uniforms = { clock, opacity, computer, heading, floorHeight, steps };
  const background = new MeshBasicNodeMaterial();
  background.name = "Charcoal / distant subdued atmosphere";
  background.depthWrite = false;
  background.depthTest = true;
  // This far field supplies only the dark background. Visible cloud structure
  // comes from the two world-space volumes, never from viewport-aligned noise.
  const distant = mistNoise(positionWorld.xy.mul(.025).add(vec2(clock.mul(.002), 0)));
  background.colorNode = vec4(vec3(.008, .0075, .0085)
    .add(vec3(.008, .007, .008).mul(distant.pow(2))).mul(opacity), 1);

  // The virtual camera samples the real scene and its live CRT material. Mips
  // spread its light across a matte surface instead of duplicating a sharp Mac.
  const reflection = reflector({ resolutionScale: .4, bounces: false, generateMipmaps: true });
  const ground = new MeshBasicNodeMaterial();
  ground.name = "Matte charcoal / soft contact and restrained live reflection";
  ground.transparent = true;
  ground.depthTest = true;
  ground.depthWrite = false;
  const world = positionWorld.xz;
  const offset = world.sub(computer.xy).div(computer.z.max(.05));
  const local = vec2(offset.x.mul(heading.x).sub(offset.y.mul(heading.y)),
    offset.x.mul(heading.y).add(offset.y.mul(heading.x)));
  const contact = classicContactShadow(local);
  const matte = vec3(.016, .0145, .0165);
  const chassis = RETRO_GROUND_FOOTPRINTS.find(footprint => footprint.name === "chassis")!;
  const keyboard = RETRO_GROUND_FOOTPRINTS.find(footprint => footprint.name === "keyboard")!;
  const reflectionPatch = float(1).sub(smoothstep(.45, 1.6,
    length(local.sub(vec2(chassis.center[0], keyboard.center[1] + .7))
      .div(vec2(chassis.halfSize[0] * 1.35, keyboard.halfSize[1] + 1.6)))));
  const reflected = reflection.level(float(3.5)).rgb;
  const color = mix(matte, matte.mul(.27), contact.mul(.85))
    .add(reflected.mul(.085).mul(reflectionPatch));
  // The distant plane dissolves into the same charcoal as the backdrop.
  const extent = float(1).sub(smoothstep(12, 55, length(world.sub(computer.xy))));
  ground.colorNode = vec4(color, opacity.mul(extent));

  const lowFog = createFogVolumeMaterial("low", uniforms), rearFog = createFogVolumeMaterial("rear", uniforms);
  return { background, ground, reflection, lowFog, rearFog, uniforms, dispose() {
    background.dispose(); ground.dispose(); reflection.dispose(); lowFog.dispose(); rearFog.dispose();
  } };
}
