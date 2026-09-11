import { useEffect, useMemo } from "react";
import { CanvasTexture, LinearFilter, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Material } from "three";
import { createComputerGeometry, KEYBOARD_ANGLE, KEYBOARD_POSITION, RETRO_KEY_LAYOUT, KEYBOARD_LEGEND_RECT } from "./computerGeometry";

export { RETRO_COMPUTER_BOUNDS, RETRO_COMPUTER_FLOOR_Y, RETRO_GROUND_FOOTPRINTS } from "./computerGeometry";

/** Stable local geometry contract used by the camera's screen-entry animation. */
export const RETRO_MAC_SCREEN = {
  center: [0, .65, 1.06] as const, width: 2.7, height: 2.05,
  bounds: { left: -1.35, right: 1.35, bottom: -.375, top: 1.675 },
};

function canvasTexture(width: number, height: number, paint: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) paint(context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function nameplateTexture() {
  return canvasTexture(512, 128, context => {
    context.fillStyle = "#5c5b4d";
    context.font = "600 46px monospace";
    context.fillText("HADESD", 0, 48);
  });
}

function keyLegendTexture() {
  const width = 768, height = 256;
  return canvasTexture(width, height, context => {
    context.fillStyle = "#666453"; context.textAlign = "center";
    for (const key of RETRO_KEY_LAYOUT) {
      context.font = `${key.legend.length > 1 ? 12 : 20}px monospace`;
      context.fillText(key.legend, (key.x / 2.85 + .5) * width, ((key.z + .032) / .83 + .5) * height + 6);
    }
  });
}

/** Classic upright beige computer with its original detached keyboard and single-button mouse. */
export function RetroMac({ screenMaterial }: { screenMaterial: Material }) {
  const resources = useMemo(() => {
    const geometries = createComputerGeometry();
    const nameplate = nameplateTexture(), legends = keyLegendTexture();
    const materials = {
      chassis: new MeshStandardMaterial({ color: "#c9c3ab", roughness: .68, metalness: .045 }),
      rear: new MeshStandardMaterial({ color: "#aaa691", roughness: .72, metalness: .025 }),
      bezel: new MeshStandardMaterial({ color: "#272d29", roughness: .30, metalness: .16 }),
      diskMouth: new MeshStandardMaterial({ color: "#30342e", roughness: .8 }),
      diskLip: new MeshStandardMaterial({ color: "#827d6b", roughness: .6 }),
      diskButton: new MeshStandardMaterial({ color: "#7c7c6c", roughness: .58 }),
      frontLine: new MeshBasicMaterial({ color: "#aba58f" }),
      insignia: new MeshStandardMaterial({ vertexColors: true, roughness: .52 }),
      vents: new MeshStandardMaterial({ color: "#666d5b", roughness: .83 }),
      seams: new MeshStandardMaterial({ color: "#8e8c79", roughness: .8 }),
      base: new MeshStandardMaterial({ color: "#8c8c7a", roughness: .8 }),
      feet: new MeshStandardMaterial({ color: "#42463d", roughness: .93 }),
      cables: new MeshStandardMaterial({ color: "#716e5e", roughness: .74 }),
      keyboardCase: new MeshStandardMaterial({ color: "#b9b39c", roughness: .69 }),
      keywell: new MeshStandardMaterial({ color: "#585d50", roughness: .85 }),
      keys: new MeshStandardMaterial({ vertexColors: true, roughness: .59, metalness: .01 }),
      keyboardLed: new MeshStandardMaterial({ color: "#d2aa65", emissive: "#9a6c2e", emissiveIntensity: .13, roughness: .5 }),
      mouseCase: new MeshStandardMaterial({ color: "#c2bca5", roughness: .62 }),
      mouseButton: new MeshStandardMaterial({ color: "#dcd4b8", roughness: .56 }),
      mouseSeam: new MeshStandardMaterial({ color: "#757866", roughness: .8 }),
      nameplate: new MeshBasicMaterial({ map: nameplate, transparent: true, depthWrite: false }),
      legends: new MeshBasicMaterial({ map: legends, transparent: true, depthWrite: false }),
    };
    return { geometries, materials, nameplate, legends,
      screen: new PlaneGeometry(RETRO_MAC_SCREEN.width, RETRO_MAC_SCREEN.height, 32, 24),
      nameplatePlane: new PlaneGeometry(.89, .223),
      legendPlane: new PlaneGeometry(KEYBOARD_LEGEND_RECT.width, KEYBOARD_LEGEND_RECT.depth),
    };
  }, []);
  useEffect(() => () => {
    Object.values(resources.geometries).forEach(geometry => geometry.dispose());
    Object.values(resources.materials).forEach(material => material.dispose());
    resources.nameplate.dispose(); resources.legends.dispose();
    resources.screen.dispose(); resources.nameplatePlane.dispose(); resources.legendPlane.dispose();
    // The scene owns screenMaterial, shared with the carousel and reflection.
  }, [resources]);

  return <group name="hadesd-compact-computer" dispose={null}>
    {Object.entries(resources.geometries).map(([name, geometry]) => <mesh key={name}
      name={`retro-computer-${name}`} geometry={geometry}
      material={resources.materials[name as keyof typeof resources.geometries]} />)}
    <mesh position={RETRO_MAC_SCREEN.center} geometry={resources.screen} material={screenMaterial} name="retro-mac-crt-visible-plane" />
    <mesh name="hadesd-nameplate" position={[-.56, -1.02, .998]} geometry={resources.nameplatePlane} material={resources.materials.nameplate} />
    <group name="detached-keyboard-legends" position={KEYBOARD_POSITION} rotation={[KEYBOARD_ANGLE, 0, 0]}>
      <mesh name="keyboard-legends" position={[0, .228, -.032]} rotation={[-Math.PI / 2, 0, 0]}
        geometry={resources.legendPlane} material={resources.materials.legends} />
    </group>
  </group>;
}
