import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, Group, MathUtils, MeshBasicNodeMaterial, PlaneGeometry, type Node } from "three/webgpu";
import { abs, attribute, cos, float, Fn, length, max, mix, positionLocal, sin, step, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import type { createAsciiFace } from "./asciiFace";
import { MAC_SCREEN_HANDOFF } from "./screenProjection";
import type { IntroPhase } from "../timeline";

type Face = ReturnType<typeof createAsciiFace>;
type Props = {
  width: number; height: number; face: Face; bootMaterial: MeshBasicNodeMaterial;
  progress: MutableRefObject<number>; phaseState: MutableRefObject<IntroPhase>;
};
const COUNT = 16, SEGMENT_ANGLE = Math.PI * 2 / COUNT;

/**
 * Cylinder deformation, rounded tile mask and five-column scroll layout adapted
 * from Filip Kantedal / Shader Development Studio's Skyworks, commit 2eb7ad3.
 * https://github.com/shader-sweden/skyworks/blob/2eb7ad3b4b861cbfc17adebff5e9fa8c861babeb/src/components/scenes/hero/cylinder-plane.tsx
 * HADESD shares geometry/materials, uses its Mac Face and joins the DOS stages.
 */
function cylinderPosition(height: number, radius: number, curvature: Node<"float">) {
  return Fn(() => {
    const p = positionLocal, rotation = attribute<"float">("panelAngle", "float");
    const angle = p.y.div(height).mul(SEGMENT_ANGLE).add(rotation);
    const curved = vec3(p.x, sin(angle).mul(radius), cos(angle).mul(radius));
    const flat = vec3(p.x, sin(rotation).mul(radius).add(cos(rotation).mul(p.y)),
      cos(rotation).mul(radius).sub(sin(rotation).mul(p.y)));
    return mix(flat, curved, curvature);
  })();
}

function tileMask(transition: Node<"float">) {
  const border = vec2(.02).mul(transition), corner = float(.03).mul(transition);
  const halfSize = vec2(.5).sub(border).sub(corner);
  const distance = length(max(abs(uv().sub(.5)).sub(halfSize), 0)).sub(corner);
  return step(distance, 0);
}

export function AsciiCarousel({ width, height, face, bootMaterial, progress, phaseState }: Props) {
  const main = useRef<Group>(null), center = useRef<Group>(null);
  const sides = useRef<Array<Group | null>>([]);
  const radius = height * COUNT / (Math.PI * 2);
  const firstCurvature = useMemo(() => uniform(0), []);
  const lastCurvature = useMemo(() => uniform(0), []);
  const resources = useMemo(() => {
    const planes = Array.from({ length: COUNT }, (_, index) => {
      const geometry = new PlaneGeometry(width, height, 50, 50);
      geometry.setAttribute("panelAngle", new BufferAttribute(new Float32Array(geometry.getAttribute("position").count).fill(index * SEGMENT_ANGLE), 1));
      return geometry;
    });
    const material = new MeshBasicNodeMaterial();
    material.name = "Skyworks cylinder / opaque rounded Mac Face tiles";
    material.positionNode = cylinderPosition(height, radius, float(1));
    // Black rounded borders write depth too. No transparent holes into the desk.
    material.colorNode = vec4(face.colorNode.mul(tileMask(float(1))), 1);
    const first = material.clone();
    first.name = "Mac screen / first flattening ASCII tile";
    first.positionNode = cylinderPosition(height, radius, firstCurvature);
    first.colorNode = vec4(face.colorNode.mul(tileMask(firstCurvature)), 1);
    const loading = bootMaterial.clone();
    loading.name = "DOS / final flattening cylinder tile";
    loading.transparent = false; loading.depthWrite = true;
    loading.positionNode = cylinderPosition(height, radius, lastCurvature);
    const bootColor = bootMaterial.colorNode as Node<"vec4">;
    loading.colorNode = vec4(bootColor.rgb.mul(bootColor.a).mul(tileMask(lastCurvature)), 1);
    const sideConfig = [-2, -1, 1, 2].map((column, i) => ({ x: width * column, rotation: MathUtils.seededRandom(i + 100) * Math.PI }));
    return { planes, material, first, loading, sideConfig };
  }, [width, height, radius, face, firstCurvature, lastCurvature, bootMaterial]);
  useEffect(() => () => {
    resources.planes.forEach(g => g.dispose());
    resources.material.dispose(); resources.first.dispose(); resources.loading.dispose();
  }, [resources]);

  useFrame(() => {
    const raw = progress.current;
    const visible = phaseState.current === "journey";
    // The Mac and first tile read the same frame's progress, even if the DOM's
    // rounded percent has not changed. At the boundary their UVs are identical.
    if (main.current) main.current.visible = visible && raw >= MAC_SCREEN_HANDOFF;
    if (!visible) return;
    const roll = MathUtils.smootherstep(raw, MAC_SCREEN_HANDOFF, 1);
    firstCurvature.value = MathUtils.clamp((raw - MAC_SCREEN_HANDOFF) / .1, 0, 1);
    lastCurvature.value = 1 - MathUtils.clamp((roll - .96) / .04, 0, 1);
    if (main.current) main.current.rotation.z = -Math.sin(roll * Math.PI) * .15;
    if (center.current) center.current.rotation.x = -roll * SEGMENT_ANGLE * 4;
    sides.current.forEach((group, i) => {
      if (group) group.rotation.x = -roll * Math.PI * .5 + resources.sideConfig[i]!.rotation;
    });
  }, -.5);

  return <group name="ascii-screen-carousel" ref={main} visible={false}>
    {resources.sideConfig.map((config, column) => <group key={config.x} ref={g => { sides.current[column] = g; }} position={[config.x, 0, -radius]}>
      {resources.planes.map((geometry, index) => <mesh key={index} frustumCulled={false} geometry={geometry} material={resources.material} />)}
    </group>)}
    <group ref={center} position={[0, 0, -radius]}>
      {resources.planes.map((geometry, index) => <mesh key={index} frustumCulled={false} geometry={geometry}
        material={index === 0 ? resources.first : index === 12 ? resources.loading : resources.material} />)}
    </group>
  </group>;
}
