import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, InstancedBufferAttribute, MathUtils, MeshBasicNodeMaterial, PlaneGeometry, type Node } from "three/webgpu";
import { abs, attribute, float, length, max, step, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { createCurledPanelPosition, type createAsciiFace } from "./asciiFace";
import { MAC_SCREEN_HANDOFF } from "./screenProjection";
import type { IntroPhase } from "../timeline";

type Face = ReturnType<typeof createAsciiFace>;
type Props = {
  width: number; height: number; face: Face; bootMaterial: MeshBasicNodeMaterial;
  progress: MutableRefObject<number>; phaseState: MutableRefObject<IntroPhase>;
};
const COUNT = 16, SEGMENT_ANGLE = Math.PI * 2 / COUNT;

/** Curvature only varies along Y; extra columns cannot improve its silhouette. */
export function createCarouselGeometry(width: number, height: number) {
  return new PlaneGeometry(width, height, 1, 32);
}

function tileMask(transition: Node<"float">) {
  const border = vec2(.02).mul(transition), corner = float(.03).mul(transition);
  const halfSize = vec2(.5).sub(border).sub(corner);
  const distance = length(max(abs(uv().sub(.5)).sub(halfSize), 0)).sub(corner);
  return step(distance, 0);
}

/**
 * Cylinder and rounded tile layout adapted from Filip Kantedal / Shader
 * Development Studio's Skyworks, commit 2eb7ad3. Four draw calls share one
 * atlas: every tile carries the same Mac, with animated backgrounds, plus the
 * two exact flat-screen handoffs. The final handoff remains the DOS screen.
 * https://github.com/shader-sweden/skyworks/blob/2eb7ad3b4b861cbfc17adebff5e9fa8c861babeb/src/components/scenes/hero/cylinder-plane.tsx
 */
export function AsciiCarousel({ width, height, face, bootMaterial, progress, phaseState }: Props) {
  const main = useRef<Group>(null);
  const radius = height * COUNT / (Math.PI * 2);
  const motion = useMemo(() => ({ rotation: uniform(0), first: uniform(0), last: uniform(0) }), []);
  const resources = useMemo(() => {
    const plane = createCarouselGeometry(width, height);
    const sides = plane.clone();
    const sidePlacement = [-2, -1, 1, 2].flatMap((column, i) => {
      const rotation = MathUtils.seededRandom(i + 100) * Math.PI;
      return Array.from({ length: COUNT }, (_, index) => [index * SEGMENT_ANGLE - rotation, column]).flat();
    });
    sides.setAttribute("panelPlacement", new InstancedBufferAttribute(new Float32Array(sidePlacement), 2));
    const center = plane.clone();
    const centerPlacement = Array.from({ length: COUNT }, (_, index) => index)
      .filter(index => index !== 0 && index !== 12).flatMap(index => [index * SEGMENT_ANGLE, 0]);
    center.setAttribute("panelPlacement", new InstancedBufferAttribute(new Float32Array(centerPlacement), 2));
    const placement = attribute<"vec2">("panelPlacement", "vec2");
    const position = (angle: Node<"float">, curvature: Node<"float">, column: Node<"float"> = float(0)) =>
      createCurledPanelPosition({ height, radius, angle: angle.add(motion.rotation), curvature })
        .add(vec3(column.mul(width), 0, -radius));

    const material = new MeshBasicNodeMaterial();
    material.name = "cylinder / instanced Mac Face tiles";
    material.positionNode = position(placement.x, float(1), placement.y);
    // Black rounded borders write depth too, maintaining an opaque screen field.
    material.colorNode = vec4(face.colorNode.mul(tileMask(float(1))), 1);
    const sideMaterial = new MeshBasicNodeMaterial();
    sideMaterial.name = "cylinder / instanced Mac faces with random backgrounds";
    sideMaterial.positionNode = position(placement.x, float(1), placement.y);
    sideMaterial.colorNode = vec4(face.sampleColor(uv(), placement.x.add(placement.y.mul(19))).mul(tileMask(float(1))), 1);
    const first = new MeshBasicNodeMaterial();
    first.name = "Mac screen / first flattening ASCII tile";
    first.positionNode = position(float(0), motion.first);
    first.colorNode = vec4(face.colorNode.mul(tileMask(motion.first)), 1);
    const loading = bootMaterial.clone();
    loading.name = "DOS / final flattening cylinder tile";
    loading.transparent = false; loading.depthWrite = true;
    loading.positionNode = position(float(12 * SEGMENT_ANGLE), motion.last);
    const bootColor = bootMaterial.colorNode as Node<"vec4">;
    loading.colorNode = vec4(bootColor.rgb.mul(bootColor.a).mul(tileMask(motion.last)), 1);
    return { plane, sides, center, material, sideMaterial, first, loading };
  }, [width, height, radius, face, motion, bootMaterial]);
  useEffect(() => () => {
    resources.plane.dispose(); resources.sides.dispose(); resources.center.dispose();
    resources.material.dispose(); resources.sideMaterial.dispose(); resources.first.dispose(); resources.loading.dispose();
  }, [resources]);

  useFrame(() => {
    const raw = progress.current;
    const visible = phaseState.current === "journey";
    if (main.current) main.current.visible = visible && raw >= MAC_SCREEN_HANDOFF;
    if (!visible) return;
    const roll = MathUtils.smootherstep(raw, MAC_SCREEN_HANDOFF, 1);
    motion.first.value = MathUtils.clamp((raw - MAC_SCREEN_HANDOFF) / .1, 0, 1);
    motion.last.value = 1 - MathUtils.clamp((roll - .96) / .04, 0, 1);
    // A negative group X rotation adds to the (sin θ, cos θ) cylinder angle.
    // At roll=1 the final index12 reaches 2π, exactly the original tangent plane.
    motion.rotation.value = roll * SEGMENT_ANGLE * 4;
    if (main.current) main.current.rotation.z = -Math.sin(roll * Math.PI) * .15;
  }, -.5);

  return <group name="ascii-screen-carousel" ref={main} visible={false}>
    <instancedMesh name="scrambling-side-tiles" args={[resources.sides, resources.sideMaterial, COUNT * 4]} frustumCulled={false} />
    <instancedMesh name="mac-face-tiles" args={[resources.center, resources.material, COUNT - 2]} frustumCulled={false} />
    <mesh name="first-mac-handoff-tile" geometry={resources.plane} material={resources.first} frustumCulled={false} />
    <mesh name="final-dos-handoff-tile" geometry={resources.plane} material={resources.loading} frustumCulled={false} />
  </group>;
}
