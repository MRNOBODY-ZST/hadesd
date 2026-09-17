import { useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, MathUtils } from "three/webgpu";

export type ForegroundMode = "binary" | "assembly" | "circuit" | "paper" | "macos";
export type ForegroundProps = {
  progress: MutableRefObject<number>;
  pointer: MutableRefObject<{ x: number; y: number }>;
  reducedMotion: boolean;
};
export type ForegroundFrame = {
  /** Scroll-controlled travel, independent of elapsed time and pointer position. */
  travel: number;
  alpha: number;
  width: number;
  height: number;
  mobile: boolean;
};

export function foregroundTravel(progress: number) {
  const p = Number.isFinite(progress) ? MathUtils.clamp(progress, 0, 1) : 0;
  return {
    travel: MathUtils.clamp((p - .3) / .53, 0, 1),
    alpha: MathUtils.smoothstep(p, .285, .335) * (1 - MathUtils.smoothstep(p, .8, .875)),
  };
}

/** A six-unit-high foreground stage, always ahead of the curved screen wall. */
export function useForegroundFrame(props: ForegroundProps, update: (frame: ForegroundFrame) => void) {
  const root = useRef<Group>(null);
  useFrame(({ camera, size }) => {
    const group = root.current;
    if (!group) return;
    const { travel, alpha } = foregroundTravel(props.progress.current);
    group.visible = !props.reducedMotion && alpha > .001;
    group.userData.travel = travel;
    if (!group.visible) return;
    const distance = 9;
    const height = 2 * distance / camera.projectionMatrix.elements[5]!;
    group.position.set(0, 0, camera.position.z - distance);
    group.scale.setScalar(height / 6);
    update({ travel, alpha, width: 6 * size.width / size.height, height: 6, mobile: size.width < 700 });
  }, -.2);
  return root;
}
