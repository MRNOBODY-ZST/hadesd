import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending, CanvasTexture, Group, InstancedBufferAttribute, InstancedMesh,
  LinearFilter, MathUtils, MeshBasicNodeMaterial, NoColorSpace, PlaneGeometry, Vector2,
} from "three/webgpu";
import { attribute, float, Fn, fract, mix, positionLocal, sin, smoothstep, step, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { createBinaryStreamLayout } from "./binaryStreams";

type Pointer = MutableRefObject<{ x: number; y: number }>;
const STREAM_COUNT = 48;
const CELL_WIDTH = 32, CELL_HEIGHT = 44;

function binaryAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = CELL_WIDTH * 2;
  canvas.height = CELL_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Binary streams require a 2D glyph atlas.");
  context.font = "500 36px 'Courier New', monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "white";
  context.fillText("0", CELL_WIDTH * .5, CELL_HEIGHT * .5);
  context.fillText("1", CELL_WIDTH * 1.5, CELL_HEIGHT * .5);
  const atlas = new CanvasTexture(canvas);
  atlas.name = "binary-streams / immutable 0 1 atlas";
  atlas.colorSpace = NoColorSpace;
  atlas.minFilter = atlas.magFilter = LinearFilter;
  atlas.generateMipmaps = false;
  return atlas;
}

/** One draw call: scroll moves stable lanes; the GPU clock only changes their digits. */
export function HardwareField({ progress, pointer, reducedMotion }: {
  progress: MutableRefObject<number>; pointer: Pointer; reducedMotion: boolean;
}) {
  const { camera, size } = useThree();
  const field = useRef<Group>(null);
  const streams = useRef<InstancedMesh>(null);
  const resources = useMemo(() => {
    const atlas = binaryAtlas();
    const geometry = new PlaneGeometry(1, 1);
    const layout = createBinaryStreamLayout(STREAM_COUNT);
    geometry.setAttribute("streamOrigin", new InstancedBufferAttribute(new Float32Array(layout.flatMap(stream => [stream.x, stream.y, stream.depth])), 3));
    geometry.setAttribute("streamData", new InstancedBufferAttribute(new Float32Array(layout.flatMap(stream => [stream.characters, stream.seed])), 2));
    const uniforms = {
      time: uniform(0), progress: uniform(0), opacity: uniform(0),
      pointer: uniform(new Vector2()), projection: uniform(new Vector2(1, 1)), cameraZ: uniform(11),
    };
    const origin = attribute<"vec3">("streamOrigin", "vec3");
    const data = attribute<"vec2">("streamData", "vec2");
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    material.name = "binary-streams / GPU glyph scrambling";
    material.positionNode = Fn(() => {
      const travel = uniforms.progress.sub(.285).div(.54).clamp(0, 1);
      const direction = step(0, origin.x).mul(2).sub(1);
      const depth = origin.z.add(travel.mul(2));
      const distance = uniforms.cameraZ.sub(depth).max(.1);
      const glyphHeight = origin.z.mul(.006).add(.038);
      // Font dimensions stay in screen pixels as the carousel camera pulls back.
      const height = glyphHeight.mul(distance).mul(uniforms.projection.y);
      const width = height.mul(CELL_WIDTH / CELL_HEIGHT).mul(data.x);
      const lane = vec2(origin.x.add(travel.sub(.5).mul(direction).mul(.65)),
        origin.y.add(travel.sub(.5).mul(sin(data.y)).mul(.2)))
        .add(uniforms.pointer.mul(depth.mul(.009).add(.012)));
      return vec3(lane.mul(uniforms.projection).mul(distance).add(vec2(positionLocal.x.mul(width), positionLocal.y.mul(height))), depth);
    })();
    material.colorNode = Fn(() => {
      const cellPosition = uv().x.mul(data.x);
      const cell = cellPosition.floor();
      const tick = uniforms.time.mul(data.y.fract().mul(3).add(4)).add(data.y).floor();
      const hash = fract(sin(cell.mul(127.1).add(data.y.mul(311.7)).add(tick.mul(19.19))).mul(43758.5453));
      const digit = step(.5, hash);
      const atlasUv = vec2(digit.mul(CELL_WIDTH).add(fract(cellPosition).mul(CELL_WIDTH - 1)).add(.5).div(CELL_WIDTH * 2),
        uv().y.mul(CELL_HEIGHT - 1).add(.5).div(CELL_HEIGHT));
      const ink = texture(atlas, atlasUv).a;
      const ends = smoothstep(0, .08, uv().x).mul(float(1).sub(smoothstep(.87, 1, uv().x)));
      const energy = mix(.32, .85, hash).mul(uniforms.opacity).mul(ends);
      return vec4(vec3(.78, .94, 1).mul(2.35), ink.mul(energy));
    })();
    return { atlas, geometry, material, uniforms };
  }, []);
  useEffect(() => () => {
    resources.atlas.dispose(); resources.geometry.dispose(); resources.material.dispose();
  }, [resources]);

  useFrame(({ clock }, delta) => {
    if (!field.current || !streams.current) return;
    const p = Number.isFinite(progress.current) ? MathUtils.clamp(progress.current, 0, 1) : 1;
    field.current.visible = !reducedMotion && p > .285 && p < .825;
    if (!field.current.visible) { field.current.userData.visibleStreamCount = 0; return; }
    streams.current.count = size.width < 700 ? 24 : STREAM_COUNT;
    field.current.userData.visibleStreamCount = streams.current.count;
    const u = resources.uniforms;
    u.time.value = clock.elapsedTime;
    u.progress.value = p;
    u.opacity.value = MathUtils.smoothstep(p, .285, .335) * (1 - MathUtils.smoothstep(p, .755, .825));
    u.cameraZ.value = camera.position.z;
    u.projection.value.set(1 / camera.projectionMatrix.elements[0]!, 1 / camera.projectionMatrix.elements[5]!);
    const easing = 1 - Math.exp(-Math.min(delta, .1) * 8);
    u.pointer.value.x = MathUtils.lerp(u.pointer.value.x, MathUtils.clamp(pointer.current.x || 0, -1, 1), easing);
    u.pointer.value.y = MathUtils.lerp(u.pointer.value.y, MathUtils.clamp(pointer.current.y || 0, -1, 1), easing);
  }, -.4);

  return <group ref={field} visible={false} name="hardware-components-field">
    <instancedMesh ref={streams} name="luminous-binary-streams" args={[resources.geometry, resources.material, STREAM_COUNT]} frustumCulled={false} />
  </group>;
}
