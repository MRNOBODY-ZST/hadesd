import { useEffect, useMemo } from "react";
import {
  CanvasTexture,
  BoxGeometry,
  CatmullRomCurve3,
  ExtrudeGeometry,
  LinearFilter,
  Path,
  Shape,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Stable local geometry contract used by the camera's screen-entry animation. */
export const RETRO_MAC_SCREEN = {
  center: [0, 0.65, 1.06] as const,
  width: 2.7,
  height: 2.05,
  bounds: { left: -1.35, right: 1.35, bottom: -0.375, top: 1.675 },
};

function roundedPath<T extends Path>(path: T, x: number, y: number, w: number, h: number, r: number): T {
  return path.moveTo(x + r, y)
    .lineTo(x + w - r, y).quadraticCurveTo(x + w, y, x + w, y + r)
    .lineTo(x + w, y + h - r).quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    .lineTo(x + r, y + h).quadraticCurveTo(x, y + h, x, y + h - r)
    .lineTo(x, y + r).quadraticCurveTo(x, y, x + r, y) as T;
}

function chassisGeometry() {
  const front = roundedPath(new Shape(), -1.75, -2.15, 3.5, 4.3, 0.16);
  // An actual open frame all the way through the chassis, never a solid front box.
  front.holes.push(roundedPath(new Path(), -1.565, -0.605, 3.13, 2.51, 0.17));
  const geometry = new ExtrudeGeometry(front, { depth: 1.9, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.05, bevelThickness: 0.05, curveSegments: 8 });
  geometry.translate(0, 0, -0.96);
  return geometry;
}

function bezelGeometry() {
  const ring = roundedPath(new Shape(), -1.555, -0.595, 3.11, 2.49, 0.15);
  ring.holes.push(roundedPath(new Path(), -1.35, -0.375, 2.7, 2.05, 0.115));
  const geometry = new ExtrudeGeometry(ring, { depth: 0.125, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.012, bevelThickness: 0.012, curveSegments: 8 });
  geometry.translate(0, 0, 0.968);
  return geometry;
}

function frontMark() {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, 512, 128);
    context.fillStyle = "#5c5b4d";
    context.font = "600 46px monospace";
    context.fillText("HADESD", 0, 48);
    context.font = "20px monospace";
    context.fillText("PERSONAL COMPUTER / 01", 1, 88);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function keyboardGeometry(modifier: boolean) {
  const key = new RoundedBoxGeometry(1, 1, 1, 1, 0.09);
  const pieces: RoundedBoxGeometry[] = [];
  for (let row = 0; row < 4; row += 1) {
    const centers = row === 3 ? [-1.23, -1.02, -0.81, -0.15, 0.54, 0.75, 0.96, 1.17] : Array.from({ length: 13 }, (_, i) => -1.25 + i * 0.207);
    centers.forEach((x, column) => {
      if ((row === 3 || column === 0 || column === 12) !== modifier) return;
      const geometry = key.clone();
      geometry.scale(row === 3 && column === 3 ? 1.12 : 0.174, 0.105, 0.174);
      geometry.translate(x, 0.173, -0.34 + row * 0.215);
      pieces.push(geometry);
    });
  }
  const geometry = mergeGeometries(pieces, false)!;
  for (const piece of pieces) piece.dispose();
  key.dispose();
  return geometry;
}

function keyboardMark() {
  const canvas = document.createElement("canvas");
  canvas.width = 768; canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#666453"; context.textAlign = "center";
    const rows = [
      ["esc", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "−", "←"],
      ["tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]"],
      ["ctrl", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "↵"],
      ["cmd", "alt", "⇧", "", "←", "↓", "↑", "→"],
    ];
    rows.forEach((row, rowIndex) => row.forEach((legend, column) => {
      const x = rowIndex === 3 ? [-1.23, -1.02, -0.81, -0.15, 0.54, 0.75, 0.96, 1.17][column]! : -1.25 + column * 0.207;
      const z = -0.34 + rowIndex * 0.215;
      context.font = `${legend.length > 1 ? 12 : 20}px monospace`;
      context.fillText(legend, (x / 2.85 + 0.5) * canvas.width, ((z + 0.032) / 0.83 + 0.5) * canvas.height + 6);
    }));
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function ventGeometry() {
  const pieces: BoxGeometry[] = [];
  for (let i = 0; i < 8; i += 1) {
    const front = new BoxGeometry(0.035, 0.24, 0.012);
    front.translate(-1.36 + i * 0.091, -1.64, 0.995); pieces.push(front);
    for (const side of [-1, 1]) {
      const slit = new BoxGeometry(0.01, 0.032, 0.67);
      slit.translate(side * 1.795, -0.66 + i * 0.15, -0.36); pieces.push(slit);
    }
  }
  const geometry = mergeGeometries(pieces, false)!;
  for (const piece of pieces) piece.dispose();
  return geometry;
}

/** An original compact beige computer, with a recessed CRT and its own six-color mark. */
export function RetroMac({ screenMaterial }: { screenMaterial: Material }) {
  const resources = useMemo(() => ({
    chassis: chassisGeometry(),
    bezel: bezelGeometry(),
    rounded: new RoundedBoxGeometry(1, 1, 1, 3, 0.065),
    keyboardLight: keyboardGeometry(false),
    keyboardDark: keyboardGeometry(true),
    vents: ventGeometry(),
    mark: frontMark(),
    keyMark: keyboardMark(),
    keyboardCable: new TubeGeometry(new CatmullRomCurve3([
      new Vector3(-0.95, -2.48, 1.05), new Vector3(-1.67, -2.48, 0.74),
      new Vector3(-1.9, -2.27, 0.1), new Vector3(-1.79, -1.77, -0.23),
    ]), 30, 0.018, 6, false),
    mouseCable: new TubeGeometry(new CatmullRomCurve3([
      new Vector3(1.84, -2.47, 1.07), new Vector3(1.89, -2.40, 0.60),
      new Vector3(1.53, -2.39, 0.29), new Vector3(0.93, -2.43, 0.78),
    ]), 24, 0.014, 6, false),
  }), []);
  useEffect(() => () => { for (const resource of Object.values(resources)) resource.dispose(); }, [resources]);

  return <group name="hadesd-compact-computer">
    <mesh geometry={resources.chassis}>
      <meshStandardMaterial color="#c9c3ab" roughness={0.68} metalness={0.045} />
    </mesh>
    {/* Rear cover closes the open chassis behind the CRT, without covering its face. */}
    <mesh geometry={resources.rounded} position={[0, 0, -0.93]} scale={[3.45, 4.21, 0.16]}>
      <meshStandardMaterial color="#aaa691" roughness={0.72} metalness={0.025} />
    </mesh>
    <mesh geometry={resources.bezel}>
      <meshStandardMaterial color="#272d29" roughness={0.30} metalness={0.16} />
    </mesh>
    <mesh position={RETRO_MAC_SCREEN.center} material={screenMaterial} name="retro-mac-crt-visible-plane">
      <planeGeometry args={[RETRO_MAC_SCREEN.width, RETRO_MAC_SCREEN.height, 32, 24]} />
    </mesh>
    {/* The disk mouth and its lower recess are split to read as a real slot. */}
    <mesh position={[0.51, -0.99, 0.996]}><boxGeometry args={[1.55, 0.085, 0.015]} /><meshStandardMaterial color="#30342e" roughness={0.8} /></mesh>
    <mesh position={[0.51, -1.03, 1.004]}><boxGeometry args={[1.41, 0.016, 0.011]} /><meshStandardMaterial color="#827d6b" roughness={0.6} /></mesh>
    <mesh position={[1.24, -1.155, 1.006]} geometry={resources.rounded} scale={[0.18, 0.055, 0.029]}><meshStandardMaterial color="#7c7c6c" roughness={0.58} /></mesh>
    <mesh position={[0.40, -1.18, 0.997]}><planeGeometry args={[1.08, 0.003]} /><meshBasicMaterial color="#aba58f" /></mesh>
    {/* Original six-color rectangular insignia, deliberately not an Apple silhouette. */}
    {["#77a066", "#cfb762", "#d89654", "#be6d61", "#89768a", "#679398"].map((color, index) => (
      <mesh key={color} position={[-1.26, -0.872 - index * 0.034, 0.998]}>
        <boxGeometry args={[index === 0 || index === 5 ? 0.20 : 0.23, 0.031, 0.008]} />
        <meshStandardMaterial color={color} roughness={0.52} />
      </mesh>
    ))}
    <mesh position={[-0.56, -1.02, 0.998]}>
      <planeGeometry args={[0.89, 0.223]} />
      <meshBasicMaterial map={resources.mark} transparent depthWrite={false} />
    </mesh>
    <mesh geometry={resources.vents}><meshStandardMaterial color="#666d5b" roughness={0.83} /></mesh>
    {/* Side vents and the cover seam remain visible in the initial oblique view. */}
    {[-1, 1].map(side => <group key={`side-${side}`}>
      <mesh position={[side * 1.792, -0.17, -0.77]}><boxGeometry args={[0.009, 3.40, 0.013]} /><meshStandardMaterial color="#8e8c79" roughness={0.8} /></mesh>
    </group>)}
    <mesh geometry={resources.rounded} position={[0, -2.22, -0.04]} scale={[3.31, 0.16, 1.68]}><meshStandardMaterial color="#8c8c7a" roughness={0.8} /></mesh>
    {[-1.22, 1.22].map(x => <mesh key={x} geometry={resources.rounded} position={[x, -2.31, -0.03]} scale={[0.37, 0.13, 1.15]}><meshStandardMaterial color="#42463d" roughness={0.93} /></mesh>)}
    <mesh geometry={resources.keyboardCable}><meshStandardMaterial color="#716e5e" roughness={0.74} /></mesh>
    <mesh geometry={resources.mouseCable}><meshStandardMaterial color="#716e5e" roughness={0.74} /></mesh>
    <group position={[-0.34, -2.59, 1.51]} rotation={[0.035, 0, 0]} name="detached-keyboard">
      <mesh geometry={resources.rounded} scale={[3.03, 0.22, 1.10]}><meshStandardMaterial color="#b9b39c" roughness={0.69} /></mesh>
      <mesh position={[0, 0.121, -0.032]}><boxGeometry args={[2.85, 0.015, 0.83]} /><meshStandardMaterial color="#585d50" roughness={0.85} /></mesh>
      <mesh geometry={resources.keyboardLight}><meshStandardMaterial color="#e0d9bf" roughness={0.59} metalness={0.01} /></mesh>
      <mesh geometry={resources.keyboardDark}><meshStandardMaterial color="#bab39b" roughness={0.59} metalness={0.01} /></mesh>
      <mesh position={[0, 0.228, -0.032]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.85, 0.83]} /><meshBasicMaterial map={resources.keyMark} transparent depthWrite={false} />
      </mesh>
      <mesh position={[1.33, 0.132, 0.36]}><boxGeometry args={[0.036, 0.02, 0.036]} /><meshStandardMaterial color="#d2aa65" emissive="#9a6c2e" emissiveIntensity={0.13} roughness={0.5} /></mesh>
    </group>
    <group position={[1.86, -2.57, 1.53]} rotation={[0, -0.12, 0]} name="single-button-mouse">
      <mesh geometry={resources.rounded} scale={[0.63, 0.28, 0.97]}><meshStandardMaterial color="#c2bca5" roughness={0.62} /></mesh>
      <mesh geometry={resources.rounded} position={[0, 0.14, -0.15]} scale={[0.49, 0.072, 0.48]}><meshStandardMaterial color="#dcd4b8" roughness={0.56} /></mesh>
      <mesh position={[0, 0.147, 0.13]}><boxGeometry args={[0.48, 0.006, 0.012]} /><meshStandardMaterial color="#757866" roughness={0.8} /></mesh>
    </group>
  </group>;
}
