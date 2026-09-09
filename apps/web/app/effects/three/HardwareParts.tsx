import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BoxGeometry,
  CanvasTexture,
  Group,
  LinearFilter,
  MathUtils,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

type Pointer = MutableRefObject<{ x: number; y: number }>;
type PathPoint = readonly [number, number, number];
type HardwarePass = {
  name: string;
  start: number;
  end: number;
  points: readonly [PathPoint, PathPoint, PathPoint, PathPoint];
  scale: number;
  rotationFrom: PathPoint;
  rotationTo: PathPoint;
  desktopOnly?: boolean;
};

/**
 * First two coordinates are viewport-relative [-1, 1], the third is real depth.
 * Each package passes the lens once; it never wraps or restarts on a timer.
 */
const HARDWARE_PASSES: readonly HardwarePass[] = [
  {
    name: "capacitor-leading-pass", start: 0.285, end: 0.560, scale: 0.72,
    points: [[-1.15, -0.58, 0.80], [-0.62, -0.30, 2.2], [0.48, 0.05, 4.4], [1.45, 0.61, 7.2]],
    rotationFrom: [0.40, -0.35, -0.20], rotationTo: [0.10, 0.45, 0.38],
  },
  {
    name: "qfp-crossing-pass", start: 0.345, end: 0.605, scale: 0.64,
    points: [[1.20, 0.72, 0.80], [0.60, 0.42, 1.9], [-0.30, 0.08, 4.1], [-1.50, -0.36, 6.7]],
    rotationFrom: [0.25, 0.38, -0.12], rotationTo: [-0.12, -0.34, 0.30],
  },
  {
    name: "resistor-upper-pass", start: 0.315, end: 0.575, scale: 0.69,
    points: [[-1.22, 0.87, 1.0], [-0.64, 0.76, 2.4], [0.45, 0.56, 4.0], [1.50, 0.07, 6.0]],
    rotationFrom: [0.40, -0.50, 0.35], rotationTo: [-0.22, 0.48, -0.38],
  },
  {
    name: "pcb-diagonal-pass", start: 0.395, end: 0.745, scale: 0.73,
    points: [[1.22, -0.80, 0.75], [0.72, -0.56, 2.0], [-0.27, -0.15, 4.0], [-1.50, 0.56, 7.0]],
    rotationFrom: [0.24, -0.40, -0.22], rotationTo: [-0.28, 0.40, 0.40],
  },
  {
    name: "resistor-lower-pass", start: 0.525, end: 0.775, scale: 0.48, desktopOnly: true,
    points: [[-1.20, -0.82, 0.95], [-0.45, -0.57, 2.4], [0.66, -0.39, 4.1], [1.48, 0.31, 6.8]],
    rotationFrom: [-0.10, 0.24, 0.42], rotationTo: [0.20, -0.50, -0.10],
  },
  {
    name: "capacitor-trailing-pass", start: 0.565, end: 0.820, scale: 0.59,
    points: [[1.15, 0.83, 1.0], [0.68, 0.35, 2.2], [-0.22, -0.30, 4.4], [-1.46, -0.80, 7.1]],
    rotationFrom: [0.30, 0.28, 0.15], rotationTo: [-0.05, -0.38, -0.40],
  },
];

function samplePass(points: HardwarePass["points"], t: number, position: Vector3, tangent: Vector3) {
  const a = 1 - t;
  const w0 = a * a * a, w1 = 3 * a * a * t, w2 = 3 * a * t * t, w3 = t * t * t;
  position.set(
    points[0][0] * w0 + points[1][0] * w1 + points[2][0] * w2 + points[3][0] * w3,
    points[0][1] * w0 + points[1][1] * w1 + points[2][1] * w2 + points[3][1] * w3,
    points[0][2] * w0 + points[1][2] * w1 + points[2][2] * w2 + points[3][2] * w3,
  );
  tangent.set(
    3 * a * a * (points[1][0] - points[0][0]) + 6 * a * t * (points[2][0] - points[1][0]) + 3 * t * t * (points[3][0] - points[2][0]),
    3 * a * a * (points[1][1] - points[0][1]) + 6 * a * t * (points[2][1] - points[1][1]) + 3 * t * t * (points[3][1] - points[2][1]),
    0,
  );
}

function makeLabel(lines: string[], color: string, width = 512, height = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, width, height);
    context.fillStyle = color; context.textAlign = "center";
    context.font = `600 ${lines.length > 2 ? 44 : 78}px monospace`;
    const lineHeight = height / (lines.length + 0.7);
    lines.forEach((line, i) => context.fillText(line, width / 2, lineHeight * (i + 0.9)));
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createMaterials() {
  const opaque = (color: string, metalness: number, roughness: number) => new MeshStandardMaterial({ color, metalness, roughness, transparent: true, opacity: 0 });
  return {
    aluminum: opaque("#c5c8bf", 0.86, 0.28),
    tin: opaque("#aeb9b4", 0.95, 0.22),
    darkTin: opaque("#5c6965", 0.65, 0.37),
    sleeve: opaque("#185b59", 0.18, 0.47),
    stripe: opaque("#a9b9a8", 0.26, 0.41),
    ceramic: opaque("#d5d0bb", 0.08, 0.63),
    carbon: opaque("#252a26", 0.08, 0.65),
    chip: opaque("#29302c", 0.07, 0.60),
    solderMask: opaque("#1d5946", 0.24, 0.52),
    boardEdge: opaque("#4c7852", 0.12, 0.69),
    copper: opaque("#c5a363", 0.78, 0.34),
    silk: opaque("#b4c8a9", 0.04, 0.78),
  };
}

function qfpPinGeometry() {
  const pieces: BoxGeometry[] = [];
  for (let side = 0; side < 4; side += 1) {
    for (let pin = 0; pin < 10; pin += 1) {
      const y = -0.47 + pin * 0.104;
      for (const [x, z, w, d] of [[0.67, -0.018, 0.18, 0.04], [0.755, -0.092, 0.039, 0.17], [0.835, -0.162, 0.195, 0.04]]) {
        const part = new BoxGeometry(w, 0.041, d);
        part.translate(x, y, z); part.rotateZ(side * Math.PI / 2); pieces.push(part);
      }
    }
  }
  const geometry = mergeGeometries(pieces, false)!;
  for (const piece of pieces) piece.dispose();
  return geometry;
}

function fade(start: number, end: number, value: number) {
  const t = MathUtils.clamp((value - start) / (end - start), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Scroll-scrubbed package fly-bys: depth and orientation have no clock dependency. */
export function HardwareField({ progress, pointer, reducedMotion }: { progress: MutableRefObject<number>; pointer: Pointer; reducedMotion: boolean }) {
  const { size, camera } = useThree();
  const field = useRef<Group>(null);
  const parts = useRef<(Group | null)[]>([]);
  const vectors = useMemo(() => ({ position: new Vector3(), tangent: new Vector3(), camera: new Vector3(), ray: new Vector3() }), []);
  const resources = useMemo(() => {
    const capMap = makeLabel(["470", "6.3V", "POLYMER"], "#d3e0cf");
    const resistorMap = makeLabel(["103"], "#bfc8b9");
    const chipMap = makeLabel(["HADESD", "HD32 • A0", "026  /  MCU"], "#aebcab");
    const boardMap = makeLabel(["CONTROL", "REV. 01"], "#c1d2b5");
    const labelMaterial = (map: CanvasTexture) => new MeshBasicMaterial({ map, transparent: true, opacity: 0, depthWrite: false });
    const materials = createMaterials();
    const labels = [capMap, resistorMap, chipMap, boardMap].map(labelMaterial);
    return {
      materials,
      rounded: new RoundedBoxGeometry(1, 1, 1, 2, 0.055),
      pins: qfpPinGeometry(),
      maps: [capMap, resistorMap, chipMap, boardMap],
      labels,
      fadeMaterials: [...Object.values(materials), ...labels],
    };
  }, []);
  useEffect(() => () => {
    for (const material of Object.values(resources.materials)) material.dispose();
    for (const map of resources.maps) map.dispose();
    for (const material of resources.labels) material.dispose();
    resources.rounded.dispose(); resources.pins.dispose();
  }, [resources]);

  useFrame(() => {
    if (!field.current) return;
    const raw = progress.current;
    const p = Number.isFinite(raw) ? MathUtils.clamp(raw, 0, 1) : 1;
    field.current.visible = !reducedMotion && p > 0.285 && p < 0.825;
    if (!field.current.visible) return;
    const mobile = size.width < 700;
    const opacity = fade(0.285, 0.32, p) * (1 - fade(0.755, 0.825, p));
    for (const material of resources.fadeMaterials) material.opacity = opacity;
    const px = MathUtils.clamp(pointer.current.x || 0, -1, 1), py = MathUtils.clamp(pointer.current.y || 0, -1, 1);
    camera.getWorldPosition(vectors.camera);
    HARDWARE_PASSES.forEach((trajectory, index) => {
      const part = parts.current[index];
      if (!part) return;
      part.visible = p >= trajectory.start && p <= trajectory.end && !(mobile && trajectory.desktopOnly);
      if (!part.visible) return;
      const travel = MathUtils.clamp((p - trajectory.start) / (trajectory.end - trajectory.start), 0, 1);
      samplePass(trajectory.points, travel, vectors.position, vectors.tangent);
      const z = vectors.position.z;
      // Unproject view-space lanes at a true world depth, preserving shape on portrait screens.
      const parallax = 0.006 * (1 - fade(0.55, 1, travel));
      vectors.ray.set(vectors.position.x + px * parallax, vectors.position.y + py * parallax, 0)
        .unproject(camera).sub(vectors.camera);
      if (Math.abs(vectors.ray.z) < 0.000001) { part.visible = false; return; }
      const depth = (z - vectors.camera.z) / vectors.ray.z;
      part.position.copy(vectors.camera).addScaledVector(vectors.ray, depth);
      const turn = fade(0.05, 0.95, travel);
      const bank = Math.atan2(vectors.tangent.y, vectors.tangent.x) * 0.12;
      part.rotation.set(
        MathUtils.lerp(trajectory.rotationFrom[0], trajectory.rotationTo[0], turn),
        MathUtils.lerp(trajectory.rotationFrom[1], trajectory.rotationTo[1], turn),
        MathUtils.lerp(trajectory.rotationFrom[2], trajectory.rotationTo[2], turn) + bank,
      );
      // Keep the intended lens pass readable while the ASCII carousel camera pulls back.
      // Comparing depth-plane distances, rather than camera.z alone, preserves the
      // original z≈1 → z≈7 perspective growth without enlarging portrait packages.
      const referenceDistance = Math.max(0.1, 11 - z);
      const cameraCompensation = MathUtils.clamp((vectors.camera.z - z) / referenceDistance, 0.5, 8);
      part.scale.setScalar(trajectory.scale * (mobile ? 0.70 : 1)
        * (0.86 + 0.14 * fade(0, 0.58, travel)) * cameraCompensation);
    });
  });

  const m = resources.materials;
  const mark = (width: number, height: number, z: number, material: Material) => <mesh position={[0, 0, z]} material={material}><planeGeometry args={[width, height]} /></mesh>;
  const capacitor = <group name="solid-polymer-aluminum-capacitor">
    <mesh material={m.sleeve}><cylinderGeometry args={[0.258, 0.258, 0.79, 28]} /></mesh>
    <mesh position={[0, 0.425, 0]} material={m.aluminum}><cylinderGeometry args={[0.254, 0.265, 0.075, 28]} /></mesh>
    <mesh position={[0, -0.423, 0]} material={m.darkTin}><cylinderGeometry args={[0.257, 0.245, 0.053, 24]} /></mesh>
    <mesh position={[0, 0.464, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.darkTin}><torusGeometry args={[0.218, 0.006, 5, 28]} /></mesh>
    {[Math.PI / 4, -Math.PI / 4].map(angle => <mesh key={angle} position={[0, 0.465, 0]} rotation={[0, angle, 0]} material={m.darkTin}><boxGeometry args={[0.28, 0.003, 0.008]} /></mesh>)}
    <mesh rotation={[0, 2.35, 0]} material={m.stripe}><cylinderGeometry args={[0.26, 0.26, 0.735, 12, 1, true, 0, 0.43]} /></mesh>
    {[-0.103, 0.103].map(x => <mesh key={x} position={[x, -0.65, 0]} material={m.tin}><cylinderGeometry args={[0.029, 0.029, 0.47, 8]} /></mesh>)}
    <group position={[0, 0.04, 0]}>{mark(0.42, 0.45, 0.263, resources.labels[0]!)}</group>
  </group>;
  const resistor = <group name="0805-thick-film-resistor">
    <mesh geometry={resources.rounded} scale={[1.18, 0.49, 0.24]} material={m.ceramic} />
    <mesh position={[0, 0, 0.107]} geometry={resources.rounded} scale={[0.78, 0.452, 0.060]} material={m.carbon} />
    {[-0.493, 0.493].map(x => <mesh key={x} position={[x, 0, 0.006]} geometry={resources.rounded} scale={[0.205, 0.50, 0.258]} material={m.tin} />)}
    {mark(0.60, 0.30, 0.14, resources.labels[1]!)}
  </group>;
  const chip = <group name="qfp-40-microcontroller">
    <mesh geometry={resources.pins} material={m.tin} />
    <mesh geometry={resources.rounded} scale={[1.22, 1.22, 0.26]} material={m.chip} />
    <mesh position={[-0.45, 0.44, 0.135]} material={m.darkTin}><circleGeometry args={[0.055, 14]} /></mesh>
    <mesh position={[-0.45, 0.44, 0.137]} material={m.carbon}><circleGeometry args={[0.039, 14]} /></mesh>
    {mark(0.88, 0.64, 0.137, resources.labels[2]!)}
  </group>;
  const pcb = <group name="controller-pcb">
    <mesh geometry={resources.rounded} scale={[1.83, 1.19, 0.077]} material={m.boardEdge} />
    <mesh position={[0, 0, 0.041]} geometry={resources.rounded} scale={[1.79, 1.15, 0.014]} material={m.solderMask} />
    {[-0.77, 0.77].flatMap(x => [-0.455, 0.455].map(y => <group key={`${x}-${y}`} position={[x, y, 0.058]}>
      <mesh material={m.carbon}><circleGeometry args={[0.058, 16]} /></mesh>
      <mesh material={m.copper}><torusGeometry args={[0.060, 0.012, 5, 16]} /></mesh>
    </group>))}
    <mesh position={[0.15, 0.11, 0.121]} geometry={resources.rounded} scale={[0.59, 0.53, 0.16]} material={m.chip} />
    {Array.from({ length: 7 }, (_, i) => <group key={i}>
      <mesh position={[-0.10 + i * 0.079, 0.41, 0.079]} material={m.tin}><boxGeometry args={[0.043, 0.115, 0.045]} /></mesh>
      <mesh position={[-0.10 + i * 0.079, -0.19, 0.079]} material={m.tin}><boxGeometry args={[0.043, 0.115, 0.045]} /></mesh>
      <mesh position={[-0.813, -0.30 + i * 0.096, 0.057]} material={m.copper}><boxGeometry args={[0.16, 0.066, 0.018]} /></mesh>
      <mesh position={[-0.475, -0.30 + i * 0.096, 0.055]} material={m.copper}><boxGeometry args={[0.46, 0.015, 0.010]} /></mesh>
    </group>)}
    {[0, 1, 2].map(i => <group key={i} position={[0.625, -0.30 + i * 0.21, 0.081]}>
      <mesh material={m.carbon}><boxGeometry args={[0.18, 0.087, 0.061]} /></mesh>
      {[-0.092, 0.092].map(x => <mesh key={x} position={[x, 0, 0.002]} material={m.tin}><boxGeometry args={[0.056, 0.094, 0.067]} /></mesh>)}
    </group>)}
    <mesh position={[0.045, -0.407, 0.06]} material={resources.labels[3]!}><planeGeometry args={[0.83, 0.18]} /></mesh>
    <mesh position={[0.15, 0.11, 0.205]} material={resources.labels[2]!}><planeGeometry args={[0.46, 0.34]} /></mesh>
    {[[-0.47, -0.44], [0.42, 0.49], [-0.60, 0.41]].map(([x, y], i) => <mesh key={i} position={[x!, y!, 0.058]} material={m.copper}><torusGeometry args={[0.022, 0.007, 4, 8]} /></mesh>)}
  </group>;

  return <group ref={field} visible={false} name="hardware-components-field">
    {[capacitor, chip, resistor, pcb, resistor, capacitor].map((part, index) => <group key={index} name={HARDWARE_PASSES[index]!.name} ref={(group) => { parts.current[index] = group; }}>{part}</group>)}
  </group>;
}
