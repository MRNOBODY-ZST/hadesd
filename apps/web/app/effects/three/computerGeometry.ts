import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, Color, ExtrudeGeometry,
  Float32BufferAttribute, Path, PlaneGeometry, Shape, TubeGeometry, Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Local coordinates before the scene applies the computer's scale and yaw. */
export const RETRO_COMPUTER_FLOOR_Y = -2.375;
export const RETRO_COMPUTER_BOUNDS = {
  min: [-1.9170264, RETRO_COMPUTER_FLOOR_Y, -1.01] as const,
  max: [2.22354794, 2.20, 2.06301213] as const,
};
export const KEYBOARD_ANGLE = .035;
// Derived from the lowest vertex of the original .22-high rounded case after
// its .035rad pitch. Keeping the tilt must not lower its front edge into the floor.
export const KEYBOARD_POSITION = [-.34, -2.2482654750347137, 1.51] as const;
export const MOUSE_POSITION = [1.86, -2.235, 1.53] as const;
export const MOUSE_YAW = -.12;
export const KEYBOARD_LEGEND_RECT = { width: 2.85, depth: .83 };

/** Oriented XZ envelopes of the real parts, shared by fog clearance and contact shadows. */
export const RETRO_GROUND_FOOTPRINTS = [
  { name: "chassis", center: [0, .0475], halfSize: [1.8, 1.0575], yaw: 0 },
  { name: "keyboard", center: [KEYBOARD_POSITION[0], KEYBOARD_POSITION[2]], halfSize: [1.515, .553012014], yaw: 0 },
  { name: "mouse", center: [MOUSE_POSITION[0], MOUSE_POSITION[2]], halfSize: [.315, .485], yaw: MOUSE_YAW },
] as const;

const keyRows = [
  ["esc", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "−", "←"],
  ["tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]"],
  ["ctrl", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "↵"],
  ["cmd", "alt", "⇧", "", "←", "↓", "↑", "→"],
];
export const RETRO_KEY_LAYOUT = keyRows.flatMap((row, rowIndex) => row.map((legend, column) => ({
  legend, x: rowIndex === 3 ? [-1.23, -1.02, -.81, -.15, .54, .75, .96, 1.17][column]! : -1.25 + column * .207,
  z: -.34 + rowIndex * .215, width: rowIndex === 3 && column === 3 ? 1.12 : .174,
  modifier: rowIndex === 3 || column === 0 || column === 12,
})));

function roundedPath<T extends Path>(path: T, x: number, y: number, w: number, h: number, r: number): T {
  return path.moveTo(x + r, y).lineTo(x + w - r, y).quadraticCurveTo(x + w, y, x + w, y + r)
    .lineTo(x + w, y + h - r).quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    .lineTo(x + r, y + h).quadraticCurveTo(x, y + h, x, y + h - r)
    .lineTo(x, y + r).quadraticCurveTo(x, y, x + r, y) as T;
}

function chassisGeometry() {
  const front = roundedPath(new Shape(), -1.75, -2.15, 3.5, 4.3, .16);
  front.holes.push(roundedPath(new Path(), -1.565, -.605, 3.13, 2.51, .17));
  return new ExtrudeGeometry(front, { depth: 1.9, bevelEnabled: true, bevelSegments: 3, steps: 1,
    bevelSize: .05, bevelThickness: .05, curveSegments: 8 }).translate(0, 0, -.96);
}

function bezelGeometry() {
  const ring = roundedPath(new Shape(), -1.555, -.595, 3.11, 2.49, .15);
  ring.holes.push(roundedPath(new Path(), -1.35, -.375, 2.7, 2.05, .115));
  return new ExtrudeGeometry(ring, { depth: .125, bevelEnabled: true, bevelSegments: 2, steps: 1,
    bevelSize: .012, bevelThickness: .012, curveSegments: 8 }).translate(0, 0, .968);
}

function join(parts: BufferGeometry[]) {
  const unpacked = parts.map(part => part.index ? part.toNonIndexed() : part);
  for (const part of unpacked) part.deleteAttribute("uv");
  const geometry = mergeGeometries(unpacked, false)!;
  for (const part of new Set([...parts, ...unpacked])) part.dispose();
  return geometry;
}

function tint(geometry: BufferGeometry, hex: string) {
  const color = new Color(hex), count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  return new BoxGeometry(w, h, d).translate(x, y, z);
}

function keyboardTransform(geometry: BufferGeometry) {
  return geometry.rotateX(KEYBOARD_ANGLE).translate(...KEYBOARD_POSITION);
}
function mouseTransform(geometry: BufferGeometry) {
  return geometry.rotateY(MOUSE_YAW).translate(...MOUSE_POSITION);
}

/** Original classic geometry, baked into one coordinate system for grounding tests.
 * Repeated keys, vents, feet, cable material and the six-color mark each use one draw. */
export function createComputerGeometry() {
  const rounded = new RoundedBoxGeometry(1, 1, 1, 3, .065);
  const round = (w: number, h: number, d: number, x = 0, y = 0, z = 0) =>
    rounded.clone().scale(w, h, d).translate(x, y, z);
  const key = new RoundedBoxGeometry(1, 1, 1, 1, .09);
  const keys = keyboardTransform(join(RETRO_KEY_LAYOUT.map(layout => tint(
    key.clone().scale(layout.width, .105, .174).translate(layout.x, .173, layout.z),
    layout.modifier ? "#bab39b" : "#e0d9bf",
  ))));
  key.dispose();
  const vents = Array.from({ length: 8 }, (_, i) => [
    box(.035, .24, .012, -1.36 + i * .091, -1.64, .995),
    ...[-1, 1].map(side => box(.01, .032, .67, side * 1.795, -.66 + i * .15, -.36)),
  ]).flat();
  const geometries = {
    chassis: chassisGeometry(),
    rear: round(3.45, 4.21, .16, 0, 0, -.93),
    bezel: bezelGeometry(),
    diskMouth: box(1.55, .085, .015, .51, -.99, .996),
    diskLip: box(1.41, .016, .011, .51, -1.03, 1.004),
    diskButton: round(.18, .055, .029, 1.24, -1.155, 1.006),
    frontLine: new PlaneGeometry(1.08, .003).translate(.40, -1.18, .997),
    insignia: join(["#77a066", "#cfb762", "#d89654", "#be6d61", "#89768a", "#679398"].map((color, i) =>
      tint(box(i === 0 || i === 5 ? .20 : .23, .031, .008, -1.26, -.872 - i * .034, .998), color))),
    vents: join(vents),
    seams: join([-1, 1].map(side => box(.009, 3.40, .013, side * 1.792, -.17, -.77))),
    base: round(3.31, .16, 1.68, 0, -2.22, -.04),
    feet: join([-1.22, 1.22].map(x => round(.37, .13, 1.15, x, -2.31, -.03))),
    cables: join([
      new TubeGeometry(new CatmullRomCurve3([
        new Vector3(-.95, -2.22, 1.05), new Vector3(-1.67, -2.33, .74),
        new Vector3(-1.9, -2.20, .1), new Vector3(-1.79, -1.77, -.23),
      ]), 30, .018, 6, false),
      new TubeGeometry(new CatmullRomCurve3([
        new Vector3(1.84, -2.21, 1.07), new Vector3(1.89, -2.32, .60),
        new Vector3(1.53, -2.32, .29), new Vector3(.93, -2.20, .78),
      ]), 24, .014, 6, false),
    ]),
    keyboardCase: keyboardTransform(round(3.03, .22, 1.10)),
    keywell: keyboardTransform(box(2.85, .015, .83, 0, .121, -.032)),
    keys,
    keyboardLed: keyboardTransform(box(.036, .02, .036, 1.33, .132, .36)),
    mouseCase: mouseTransform(round(.63, .28, .97)),
    mouseButton: mouseTransform(round(.49, .072, .48, 0, .14, -.15)),
    mouseSeam: mouseTransform(box(.48, .006, .012, 0, .147, .13)),
  };
  rounded.dispose();
  return geometries;
}
