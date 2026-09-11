import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Group, Mesh } from "three/webgpu";
import type { CrtLevel } from "@hadesd/contracts";
import { createAtmosphereResources, type ComputerGround } from "./atmosphereResources";
import { fogVolumeLayout } from "./atmosphereVolume";

export function Atmosphere({ floorY, floorOpacity, computerGround, level, reducedMotion }: {
  floorY: MutableRefObject<number>;
  floorOpacity: MutableRefObject<number>;
  computerGround?: MutableRefObject<ComputerGround>;
  level: CrtLevel; reducedMotion: boolean;
}) {
  const floor = useRef<Mesh>(null);
  const volumes = useRef<Group>(null);
  const { size } = useThree();
  const resources = useMemo(createAtmosphereResources, []);
  const layout = useMemo(() => fogVolumeLayout(level, size.width < 700), [level, size.width]);
  const { clock, opacity, computer, heading, floorHeight, steps } = resources.uniforms;
  useEffect(() => {
    steps.value = layout.steps;
    resources.reflection.reflector.resolutionScale = level === "full" ? (size.width >= 700 ? .4 : .3) : .25;
  }, [size.width, level, resources, layout, steps]);
  useEffect(() => () => resources.dispose(), [resources]);
  useFrame(({ clock: frameClock }) => {
    clock.value = reducedMotion ? 1 : frameClock.elapsedTime;
    opacity.value = floorOpacity.current;
    floorHeight.value = floorY.current;
    const anchor = computerGround?.current;
    if (anchor) {
      computer.value.set(anchor.x, anchor.z, anchor.scale);
      heading.value.set(Math.cos(anchor.yaw ?? 0), Math.sin(anchor.yaw ?? 0));
    }
    if (floor.current) { floor.current.position.y = floorY.current; floor.current.visible = opacity.value > .001; }
    if (volumes.current) {
      volumes.current.position.set(computer.value.x, floorY.current, computer.value.y);
      volumes.current.scale.setScalar(Math.max(.05, computer.value.z));
      volumes.current.rotation.y = anchor?.yaw ?? 0;
      volumes.current.visible = opacity.value > .001;
    }
  }, -.4);
  return <>
    <mesh position={[0, 0, -95]} material={resources.background} name="atmospheric-background"><planeGeometry args={[440, 290]} /></mesh>
    {/* Opaque computer geometry writes depth first. This floor respects that
        depth and precedes transparent CRT/labels.
        floorY must be below the transformed model's lowest support point. */}
    <mesh ref={floor} renderOrder={-20} rotation={[-Math.PI / 2, 0, 0]} material={resources.ground} name="reflective-floor" position={[0, -3, -15]}>
      <planeGeometry args={[180, 180]} />
      <primitive object={resources.reflection.target} />
    </mesh>
    {/* Back faces depth-test against the opaque computer, so a volume never
        uses a nearer box front face to wash out the casing. The low box stays
        below keys; the rear box is completely behind the computer bounds. */}
    <group ref={volumes} name="world-fog-volumes">
      <mesh material={resources.rearFog} position={layout.rear.center} scale={layout.rear.size} renderOrder={-12} name="rear-fog-volume">
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <mesh material={resources.lowFog} position={layout.low.center} scale={layout.low.size} renderOrder={-11} name="low-fog-volume">
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
    </group>
  </>;
}
