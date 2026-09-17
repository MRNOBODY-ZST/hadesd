import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, type MeshBasicNodeMaterial } from "three/webgpu";
import { createSignalPortalResources } from "./signalPortalResources";
import { signalPortalMotion } from "./signalPortalMotion";
import type { ForegroundProps } from "./shared";
import type { PortalShape } from "./portalShapes";

/** Hollow contacts on one flight path. The lead opening looks into the live terminal. */
export function CircuitSignals({ progress, reducedMotion, portalMaterial, shape }: ForegroundProps & { portalMaterial: MeshBasicNodeMaterial; shape: PortalShape }) {
  const root = useRef<Group>(null), rings = useRef<(Group | null)[]>([]);
  const resources = useMemo(() => {
    const geometry = createSignalPortalResources(shape);
    const contacts = Array.from({ length: 5 }, (_, index) => geometry.parts.map(part => {
      const material = index === 0 ? part.material : part.material.clone();
      material.transparent = true;
      return { ...part, material };
    }));
    return { ...geometry, contacts, owners: 0 };
  }, [shape]);
  useEffect(() => {
    resources.owners++;
    return () => {
      resources.owners--;
      // StrictMode reattaches this same resource set immediately. Defer disposal
      // until that replay finishes so it cannot re-upload an already disposed set.
      queueMicrotask(() => {
        if (resources.owners !== 0) return;
        resources.contacts.slice(1).flat().forEach(part => part.material.dispose());
        resources.dispose();
      });
    };
  }, [resources]);

  useFrame(({ camera, size }) => {
    const group = root.current;
    if (!group) return;
    const state = signalPortalMotion(progress.current, size.width / size.height, resources.apertureInradius);
    group.visible = !reducedMotion && state.alpha > .001 && !state.completed;
    group.position.copy(camera.position);
    group.quaternion.copy(camera.quaternion);
    group.userData.apertureCoversViewport = state.apertureCoversViewport;
    group.userData.crossedCamera = state.crossedCamera;
    group.userData.leaderZ = state.leader.z;
    group.userData.leaderRotation = state.leader.rotateZ;
    group.userData.apertureInradius = resources.apertureInradius;
    group.userData.itemCount = 0;
    [state.leader, ...state.trailing].forEach((pose, index) => {
      const ring = rings.current[index];
      if (!ring) return;
      ring.visible = pose.alpha > .001;
      ring.position.set(pose.x, pose.y, pose.z);
      ring.rotation.set(pose.rotateX, pose.rotateY, pose.rotateZ);
      ring.scale.setScalar(pose.scale);
      resources.contacts[index]!.forEach(part => { part.material.opacity = pose.alpha; });
      if (ring.visible) group.userData.itemCount++;
    });
  }, -.2);

  return <group ref={root} name="foreground-circuit" visible={false} dispose={null}>
    {resources.contacts.map((parts, index) => <group key={index} ref={node => { rings.current[index] = node; }} name={index === 0 ? "signal-portal-leader" : `signal-arc-contact-${index}`}>
      {parts.map(part => <mesh key={part.name} name={part.name} geometry={part.geometry} material={part.material} />)}
      {index === 0 && <mesh name="signal-live-terminal-aperture" geometry={resources.apertureGeometry} material={portalMaterial} position={[0, 0, resources.apertureZ]} />}
    </group>)}
  </group>;
}
