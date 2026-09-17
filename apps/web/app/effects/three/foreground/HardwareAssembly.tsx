import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, Group,
  LinearFilter, MathUtils, MeshBasicNodeMaterial, MeshStandardNodeMaterial,
  PlaneGeometry, SRGBColorSpace, TorusGeometry, type Material,
} from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { useForegroundFrame, type ForegroundProps } from "./shared";

type Part = { geometry: BufferGeometry; material: Material };
function merge(parts: BufferGeometry[]) {
  const geometry = mergeGeometries(parts, false)!;
  parts.forEach(part => part.dispose());
  return geometry;
}
function box(w: number, h: number, d: number, x = 0, y = 0, z = 0) {
  return new BoxGeometry(w, h, d).translate(x, y, z);
}
function label(text: string[], color = "#d4d9c0", size = 512) {
  const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color; ctx.textAlign = "center";
  text.forEach((line, i) => { ctx.font = `${i === 0 ? "bold " : ""}${i === 0 ? 55 : 35}px monospace`; ctx.fillText(line, size / 2, size * .34 + i * 68); });
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter; texture.generateMipmaps = false;
  return texture;
}
function trace(points: number[][], width: number, z: number) {
  return points.slice(1).map((point, i) => {
    const a = points[i], dx = point[0] - a[0], dy = point[1] - a[1];
    return box(Math.hypot(dx, dy), width, .009).rotateZ(Math.atan2(dy, dx))
      .translate((point[0] + a[0]) / 2, (point[1] + a[1]) / 2, z);
  });
}

/** Six physical parts follow an exploded-view assembly, with no clock-driven drift. */
export function HardwareAssembly(props: ForegroundProps) {
  const assembly = useRef<Group>(null);
  const pieces = useRef<(Group | null)[]>([]);
  const resources = useMemo(() => {
    const geometries: BufferGeometry[] = [], materials: Material[] = [], textures: CanvasTexture[] = [];
    const material = (color: string, metalness = 0, roughness = .5) => {
      const value = new MeshStandardNodeMaterial({ color, metalness, roughness, transparent: true });
      materials.push(value); return value;
    };
    const resin = material("#163d34", .13, .38), edge = material("#10241f", .14, .58);
    const silicon = material("#242929", .22, .52), silver = material("#c5d2cc", .82, .24);
    const copper = material("#bba46b", .73, .34), ceramic = material("#42474a", .08, .56);
    const blue = material("#2f5467", .36, .35), capTop = material("#d4ded7", .77, .27);
    const register = (geometry: BufferGeometry, mat: Material): Part => { geometries.push(geometry); return { geometry, material: mat }; };
    const decal = (lines: string[], width: number, height: number, z: number, color?: string): Part => {
      const map = label(lines, color); textures.push(map);
      const mat = new MeshBasicNodeMaterial({ map, transparent: true, depthWrite: false, color: new Color("#e2e2cb") }); materials.push(mat);
      return register(new PlaneGeometry(width, height).translate(0, 0, z), mat);
    };
    const board: Part[] = [register(new RoundedBoxGeometry(2.23, 1.79, .085, 2, .065), resin), register(box(2.17, 1.73, .045, 0, 0, -.055), edge)];
    const tracks: BufferGeometry[] = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 6; i++) {
        const y = (i - 2.5) * .113;
        tracks.push(...trace([[side * .43, y], [side * (.51 + i * .035), y], [side * (.61 + i * .035), y + side * .13], [side * .97, y + side * .13]], .013, .049));
      }
    }
    tracks.push(...trace([[-.79, .59], [-.38, .59], [-.27, .48], [.55, .48], [.72, .65]], .027, .05));
    tracks.push(...trace([[-.88, -.58], [-.53, -.58], [-.33, -.38], [.35, -.38], [.48, -.54], [.89, -.54]], .025, .05));
    board.push(register(merge(tracks), copper));
    const pads: BufferGeometry[] = [], holes: BufferGeometry[] = [];
    for (let i = 0; i < 13; i++) pads.push(box(.088, .13, .016, (i - 6) * .144, -.775, .052));
    for (const x of [-.94, .94]) for (const y of [-.7, .7]) {
      holes.push(new TorusGeometry(.057, .015, 6, 16).translate(x, y, .057));
    }
    board.push(register(merge(pads.concat(holes)), copper));
    const silkscreen = decal(["HADESD", "LOGIC BOARD / REV. 01"], 1.02, .58, .057, "#d6e0b9");
    silkscreen.geometry.translate(-.31, .61, 0); board.push(silkscreen);
    // The microcontroller has distinct gull-wing legs and a pin-one marker.
    const pins: BufferGeometry[] = [];
    for (let side = 0; side < 4; side++) for (let i = 0; i < 8; i++) {
      const offset = (i - 3.5) * .088;
      pins.push(box(.047, .12, .027, offset, .437, -.042).rotateZ(side * Math.PI / 2));
      pins.push(box(.047, .038, .069, offset, .4, -.014).rotateZ(side * Math.PI / 2));
    }
    const mcu: Part[] = [register(new RoundedBoxGeometry(.77, .77, .115, 2, .022), silicon), register(merge(pins), silver),
      decal(["HADESD", "MCU / 32", "ARM CORE"], .64, .64, .06)];
    mcu.push(register(new CylinderGeometry(.029, .029, .005, 14).rotateX(Math.PI / 2).translate(-.278, .276, .062), capTop));
    const capacitor: Part[] = [register(new CylinderGeometry(.178, .178, .38, 28).rotateX(Math.PI / 2), blue),
      register(new CylinderGeometry(.167, .167, .026, 28).rotateX(Math.PI / 2).translate(0, 0, .192), capTop),
      register(new TorusGeometry(.173, .012, 6, 28).translate(0, 0, -.182), silver),
      register(merge([box(.21, .008, .009, 0, 0, .209), box(.008, .21, .009, 0, 0, .209)]), ceramic),
      register(merge([box(.044, .05, .11, -.078, 0, -.221), box(.044, .05, .11, .078, 0, -.221)]), silver),
      decal(["220", "16 V"], .22, .22, .212, "#455458")];
    const resistor: Part[] = [register(new RoundedBoxGeometry(.33, .17, .115, 1, .018), ceramic),
      register(merge([box(.075, .178, .12, -.14), box(.075, .178, .12, .14)]), silver),
      decal(["102"], .25, .25, .062)];
    const crystal: Part[] = [register(new RoundedBoxGeometry(.47, .24, .14, 2, .047), silver),
      register(box(.49, .255, .025, 0, 0, -.08), silicon), decal(["12.000"], .4, .25, .073, "#324344")];
    return { geometries, materials, textures, board, models: [mcu, capacitor, resistor, resistor, crystal] };
  }, []);
  useEffect(() => () => {
    resources.geometries.forEach(value => value.dispose()); resources.materials.forEach(value => value.dispose()); resources.textures.forEach(value => value.dispose());
  }, [resources]);
  const root = useForegroundFrame(props, ({ travel: t, alpha, width, mobile }) => {
    if (!assembly.current) return;
    resources.materials.forEach(material => { material.opacity = alpha; });
    const scale = mobile ? .68 : 1;
    const exit = MathUtils.smoothstep(t, .89, 1);
    assembly.current.scale.setScalar(scale);
    assembly.current.position.set(mobile ? width * .17 : width * .28, mobile ? -1.18 : -.48, .15 + exit * .7);
    assembly.current.rotation.set(-.19 + t * .19, -.32 + t * .18, -.14 + t * .13);
    const starts = mobile ? [[-1.9, 3.8, 1.1], [1.05, 3.4, .45], [-1.8, 1.5, .5], [.8, -1.1, .8], [-1.5, -.9, .7]]
      : [[-4.3, 1.8, 1], [.45, 2.75, .75], [-4.15, -.7, .7], [-.4, -1.8, .8], [-2.3, 2.8, .5]];
    const targets = [[-.13, .06, .13], [.68, .48, .275], [-.75, .45, .118], [.66, -.39, .118], [-.57, -.51, .16]];
    pieces.current.forEach((piece, i) => {
      if (!piece) return;
      const dock = MathUtils.smoothstep(t, .18 + i * .064, .66 + i * .054);
      const start = starts[i], target = targets[i];
      piece.position.set(MathUtils.lerp(start[0], target[0], dock), MathUtils.lerp(start[1], target[1], dock) + Math.sin(dock * Math.PI) * (i % 2 ? .32 : -.2), MathUtils.lerp(start[2], target[2], dock) + Math.sin(dock * Math.PI) * .5);
      piece.rotation.set((1 - dock) * [.38, -.65, .5, -.7, .2][i], (1 - dock) * [-.45, .55, -.3, .4, -.5][i], (1 - dock) * [-.18, .38, -.4, .55, .18][i]);
    });
    if (root.current) {
      root.current.userData.itemCount = 6;
      root.current.userData.pose = pieces.current.map(piece => piece?.position.toArray());
    }
  });
  return <group ref={root} name="foreground-assembly" visible={false} dispose={null}>
    <group ref={assembly}>
      {resources.board.map((part, i) => <mesh key={i} {...part} />)}
      {resources.models.map((model, i) => <group key={i} ref={value => { pieces.current[i] = value; }} name={`assembly-part-${i}`}>
        {model.map((part, j) => <mesh key={j} {...part} />)}
      </group>)}
    </group>
  </group>;
}
